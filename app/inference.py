import os
import threading
import time
from dataclasses import dataclass
from typing import Any, Dict, List

import cv2
import numpy as np
import requests
from ultralytics import YOLO


APP_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_SEG_MODEL_PATH = os.path.join(APP_DIR, "yolo11x-seg.pt")
DEFAULT_MODEL_PATH = (
    DEFAULT_SEG_MODEL_PATH
    if os.path.exists(DEFAULT_SEG_MODEL_PATH)
    else os.path.join(APP_DIR, "yolo26n.pt")
)
MODEL_PATH = os.getenv("MODEL_PATH", DEFAULT_MODEL_PATH)
LATEST_FRAME_PATH = os.path.join(APP_DIR, "latest_frame.jpg")
DETECTION_FRAME_DIR = os.path.join(APP_DIR, "detection_frames")

API_BASE = os.getenv("API_BASE", "http://127.0.0.1:8080").rstrip("/")
VEHICLE_LABELS = {"car", "truck", "bus"}
MIN_SPOT_OVERLAP_RATIO = float(os.getenv("MIN_SPOT_OVERLAP_RATIO", "0.05"))
MIN_VEHICLE_OVERLAP_RATIO = float(os.getenv("MIN_VEHICLE_OVERLAP_RATIO", "0.12"))
MIN_OVERLAP_PIXELS = int(os.getenv("MIN_OVERLAP_PIXELS", "60"))
BOX_THICKNESS = int(os.getenv("BOX_THICKNESS", "1"))
SPOT_THICKNESS = int(os.getenv("SPOT_THICKNESS", "1"))
TEXT_SCALE_SMALL = float(os.getenv("TEXT_SCALE_SMALL", "0.45"))
TEXT_SCALE_MEDIUM = float(os.getenv("TEXT_SCALE_MEDIUM", "0.6"))
TEXT_THICKNESS = int(os.getenv("TEXT_THICKNESS", "1"))
MODEL_CONFIDENCE = float(os.getenv("MODEL_CONFIDENCE", "0.2"))
FRAME_FETCH_TIMEOUT = float(os.getenv("FRAME_FETCH_TIMEOUT", "8"))
CONFIG_REFRESH_SECONDS = float(os.getenv("CONFIG_REFRESH_SECONDS", "5"))
WORKER_LOOP_DELAY_SECONDS = float(os.getenv("WORKER_LOOP_DELAY_SECONDS", "0.2"))
FRAME_WIDTH = int(os.getenv("FRAME_WIDTH", "640"))
OCCUPIED_HOLD_SECONDS = float(os.getenv("OCCUPIED_HOLD_SECONDS", "0.8"))


@dataclass
class LotConfig:
    lot_id: int
    name: str
    camera_url: str
    is_default: bool
    spaces: List[Dict[str, Any]]

    @property
    def signature(self):
        return (
            self.name,
            self.camera_url,
            self.is_default,
            tuple(
                (
                    space["space_id"],
                    space["label"],
                    tuple((point["x"], point["y"]) for point in space["polygon"]),
                )
                for space in self.spaces
            ),
        )


def normalize_polygon_point(point: Any):
    if isinstance(point, dict):
        x = point.get("x")
        y = point.get("y")
    elif isinstance(point, (list, tuple)) and len(point) >= 2:
        x, y = point[0], point[1]
    else:
        raise ValueError("Polygon points must be {x, y} objects or [x, y] pairs.")

    return {"x": int(round(float(x))), "y": int(round(float(y)))}


def normalize_polygon(raw_polygon: Any):
    if not isinstance(raw_polygon, list) or len(raw_polygon) < 3:
        raise ValueError("Polygon must contain at least 3 points.")

    return [normalize_polygon_point(point) for point in raw_polygon]


def get_detection_frame_path(lot_id: int):
    return os.path.join(DETECTION_FRAME_DIR, f"lot-{lot_id}.jpg")


def write_frame(path: str, frame):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    cv2.imwrite(path, frame)


class OccupancySmoother:
    def __init__(self, hold_seconds: float):
        self.hold_seconds = max(0.0, float(hold_seconds))
        self.space_state: Dict[int, Dict[str, Any]] = {}

    def apply(self, space_ids: List[int], raw_occupancy: Dict[int, bool]):
        now = time.time()
        active_space_ids = set(space_ids)
        self.space_state = {
            space_id: self.space_state.get(
                space_id,
                {"occupied": False, "last_seen_ts": 0.0},
            )
            for space_id in active_space_ids
        }

        smoothed_occupancy: Dict[int, bool] = {}
        for space_id in space_ids:
            state = self.space_state[space_id]
            is_occupied = bool(raw_occupancy.get(space_id, False))

            if is_occupied:
                state["occupied"] = True
                state["last_seen_ts"] = now
            elif state["occupied"] and now - state["last_seen_ts"] < self.hold_seconds:
                is_occupied = True
            else:
                state["occupied"] = False

            smoothed_occupancy[space_id] = is_occupied

        return smoothed_occupancy


def score_vehicle_spot(spot: np.ndarray, spot_mask: np.ndarray, vehicle: dict):
    overlap = int(np.logical_and(spot_mask > 0, vehicle["mask"] > 0).sum())
    if overlap < MIN_OVERLAP_PIXELS:
        return None

    spot_area = max(1, int((spot_mask > 0).sum()))
    vehicle_area = max(1, vehicle["area"])
    overlap_vs_spot = overlap / spot_area
    overlap_vs_vehicle = overlap / vehicle_area
    anchor_inside = cv2.pointPolygonTest(
        spot.astype(np.float32),
        vehicle["anchor_point"],
        False,
    ) >= 0

    if not (
        overlap_vs_spot >= MIN_SPOT_OVERLAP_RATIO
        or overlap_vs_vehicle >= MIN_VEHICLE_OVERLAP_RATIO
        or anchor_inside
    ):
        return None

    score = overlap_vs_vehicle * 1000 + overlap_vs_spot * 100 + (25 if anchor_inside else 0)
    return {
        "score": score,
        "overlap": overlap,
        "overlap_vs_spot": overlap_vs_spot,
        "overlap_vs_vehicle": overlap_vs_vehicle,
        "anchor_inside": anchor_inside,
    }


def build_detected_vehicles(model, frame, results):
    annotated_frame = frame.copy()
    boxes = results[0].boxes
    masks = results[0].masks
    detected_vehicles = []
    vehicle_count = 0
    frame_h, frame_w = frame.shape[:2]

    if boxes is None:
        return detected_vehicles, annotated_frame, vehicle_count

    for i, box in enumerate(boxes):
        cls = int(box.cls[0])
        label = model.names[cls]
        if label not in VEHICLE_LABELS:
            continue

        vehicle_count += 1
        x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
        conf = float(box.conf[0])
        anchor_point = (int((x1 + x2) / 2), max(0, y2 - 5))

        if masks is not None and i < len(masks.data):
            mask = masks.data[i].cpu().numpy()
            mask = cv2.resize(mask, (frame_w, frame_h), interpolation=cv2.INTER_NEAREST)
            mask = mask > 0.5
            vehicle_mask = mask.astype(np.uint8)
            has_segmentation = True
        else:
            vehicle_mask = np.zeros((frame_h, frame_w), dtype=np.uint8)
            cv2.rectangle(vehicle_mask, (x1, y1), (x2, y2), 1, thickness=-1)
            mask = vehicle_mask > 0
            has_segmentation = False

        detected_vehicles.append(
            {
                "label": label,
                "mask": vehicle_mask,
                "area": int((vehicle_mask > 0).sum()),
                "anchor_point": anchor_point,
                "box": (x1, y1, x2, y2),
                "confidence": conf,
                "has_segmentation": has_segmentation,
            }
        )

        if has_segmentation:
            color_mask = np.zeros_like(annotated_frame)
            color_mask[mask] = (0, 255, 0)
            annotated_frame = cv2.addWeighted(annotated_frame, 1.0, color_mask, 0.22, 0)

        cv2.rectangle(annotated_frame, (x1, y1), (x2, y2), (0, 255, 0), BOX_THICKNESS)
        cv2.putText(
            annotated_frame,
            f"{label} {conf:.2f}",
            (x1, max(20, y1 - 8)),
            cv2.FONT_HERSHEY_SIMPLEX,
            TEXT_SCALE_SMALL,
            (0, 255, 0),
            TEXT_THICKNESS,
        )

    return detected_vehicles, annotated_frame, vehicle_count


def draw_vehicle_overlays(frame, detected_vehicles: List[Dict[str, Any]]):
    annotated_frame = frame.copy()
    target_h, target_w = frame.shape[:2]

    for vehicle in detected_vehicles:
        source_mask = vehicle["mask"]
        source_h, source_w = source_mask.shape[:2]
        scale_x = target_w / max(1, source_w)
        scale_y = target_h / max(1, source_h)
        scaled_mask = source_mask

        if (source_w, source_h) != (target_w, target_h):
            scaled_mask = cv2.resize(
                source_mask.astype(np.uint8),
                (target_w, target_h),
                interpolation=cv2.INTER_NEAREST,
            )

        if vehicle.get("has_segmentation"):
            color_mask = np.zeros_like(annotated_frame)
            color_mask[scaled_mask > 0] = (0, 255, 0)
            annotated_frame = cv2.addWeighted(annotated_frame, 1.0, color_mask, 0.22, 0)

        x1, y1, x2, y2 = vehicle["box"]
        scaled_x1 = int(round(x1 * scale_x))
        scaled_y1 = int(round(y1 * scale_y))
        scaled_x2 = int(round(x2 * scale_x))
        scaled_y2 = int(round(y2 * scale_y))

        cv2.rectangle(
            annotated_frame,
            (scaled_x1, scaled_y1),
            (scaled_x2, scaled_y2),
            (0, 255, 0),
            BOX_THICKNESS,
        )
        cv2.putText(
            annotated_frame,
            f"{vehicle['label']} {vehicle['confidence']:.2f}",
            (scaled_x1, max(20, scaled_y1 - 8)),
            cv2.FONT_HERSHEY_SIMPLEX,
            TEXT_SCALE_SMALL,
            (0, 255, 0),
            TEXT_THICKNESS,
        )

    return annotated_frame


def evaluate_spaces(spaces: List[Dict[str, Any]], detected_vehicles: List[Dict[str, Any]], frame_shape, original_shape):
    frame_h, frame_w = frame_shape[:2]
    original_h, original_w = original_shape[:2]
    scaled_spaces = []
    spot_masks = []

    for space in spaces:
        scaled_polygon = np.array(
            [
                [
                    int(round(point["x"] * (frame_w / original_w))),
                    int(round(point["y"] * (frame_h / original_h))),
                ]
                for point in space["polygon"]
            ],
            dtype=np.int32,
        )
        scaled_spaces.append((space, scaled_polygon))
        spot_mask = np.zeros((frame_h, frame_w), dtype=np.uint8)
        cv2.fillPoly(spot_mask, [scaled_polygon], 1)
        spot_masks.append(spot_mask)

    occupancy_by_space_id = {space["space_id"]: False for space in spaces}

    for vehicle in detected_vehicles:
        best_match = None

        for idx, (space, polygon) in enumerate(scaled_spaces):
            match = score_vehicle_spot(polygon, spot_masks[idx], vehicle)
            if match is None:
                continue

            if best_match is None or match["score"] > best_match["score"]:
                best_match = {"space_id": space["space_id"], **match}

        if best_match is not None:
            occupancy_by_space_id[best_match["space_id"]] = True

    return scaled_spaces, occupancy_by_space_id


def draw_space_overlays(annotated_frame, scaled_spaces, occupancy_by_space_id):
    occupied_spaces = 0

    for index, (space, polygon) in enumerate(scaled_spaces, start=1):
        is_occupied = occupancy_by_space_id.get(space["space_id"], False)
        color = (0, 0, 255) if is_occupied else (0, 255, 0)
        if is_occupied:
            occupied_spaces += 1

        cv2.polylines(
            annotated_frame,
            [polygon],
            isClosed=True,
            color=color,
            thickness=SPOT_THICKNESS,
        )

        label_x, label_y = polygon[0]
        label_text = space.get("label") or str(index)
        cv2.putText(
            annotated_frame,
            label_text,
            (label_x + 5, label_y - 5),
            cv2.FONT_HERSHEY_SIMPLEX,
            TEXT_SCALE_MEDIUM,
            color,
            TEXT_THICKNESS,
        )

    return occupied_spaces


def fetch_lot_configs():
    lots_resp = requests.get(f"{API_BASE}/lots", timeout=5)
    lots_resp.raise_for_status()
    lots = lots_resp.json().get("lots", [])
    configs: Dict[int, LotConfig] = {}

    for lot in lots:
        lot_id = int(lot["lot_id"])
        detail_resp = requests.get(f"{API_BASE}/lots/{lot_id}", timeout=5)
        detail_resp.raise_for_status()
        detail = detail_resp.json()
        spaces = []

        for raw_space in detail.get("spaces", []):
            polygon = raw_space.get("polygon")
            try:
                normalized_polygon = normalize_polygon(polygon)
            except Exception:
                continue

            spaces.append(
                {
                    "space_id": int(raw_space["space_id"]),
                    "label": str(raw_space.get("label") or ""),
                    "polygon": normalized_polygon,
                }
            )

        if not spaces:
            continue

        lot_payload = detail.get("lot") or {}
        configs[lot_id] = LotConfig(
            lot_id=lot_id,
            name=str(lot_payload.get("name") or f"Lot {lot_id}"),
            camera_url=str(lot_payload.get("camera_url") or ""),
            is_default=bool(lot_payload.get("is_default")),
            spaces=spaces,
        )

    return configs


def fetch_frame_for_lot(lot_id: int):
    resp = requests.get(
        f"{API_BASE}/camera/frame",
        params={"lot_id": lot_id},
        timeout=FRAME_FETCH_TIMEOUT,
    )
    resp.raise_for_status()
    image_array = np.frombuffer(resp.content, dtype=np.uint8)
    frame = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
    if frame is None:
        raise RuntimeError("Could not decode camera frame.")
    return frame


def post_occupancy(lot_id: int, spaces: List[Dict[str, Any]], occupancy_by_space_id: Dict[int, bool]):
    updates = [
        {"space_id": space["space_id"], "occupied": bool(occupancy_by_space_id.get(space["space_id"], False))}
        for space in spaces
    ]

    requests.post(
        f"{API_BASE}/lots/{lot_id}/status_batch",
        json={"updates": updates},
        timeout=3,
    ).raise_for_status()


class LotDetectorWorker:
    def __init__(self, config: LotConfig):
        self.config = config
        self.config_lock = threading.Lock()
        self.stop_event = threading.Event()
        self.occupancy_smoother = OccupancySmoother(OCCUPIED_HOLD_SECONDS)
        self.thread = threading.Thread(
            target=self._run,
            daemon=True,
            name=f"lot-detector-{config.lot_id}",
        )
        self.last_signature = config.signature

    def start(self):
        if not self.thread.is_alive():
            self.thread.start()

    def stop(self):
        self.stop_event.set()
        if self.thread.is_alive():
            self.thread.join(timeout=2.0)

    def update_config(self, config: LotConfig):
        with self.config_lock:
            self.config = config
            self.last_signature = config.signature

    def get_config(self):
        with self.config_lock:
            return self.config

    def _run(self):
        model = YOLO(MODEL_PATH)
        print(f"[INFO] Lot {self.config.lot_id} detector started with model: {MODEL_PATH}")

        while not self.stop_event.is_set():
            config = self.get_config()

            try:
                original_frame = fetch_frame_for_lot(config.lot_id)
                original_h, original_w = original_frame.shape[:2]
                resized_h = int(original_h * (FRAME_WIDTH / original_w))
                frame = cv2.resize(original_frame, (FRAME_WIDTH, resized_h))
                results = model(frame, verbose=False, conf=MODEL_CONFIDENCE)
                detected_vehicles, annotated_frame, vehicle_count = build_detected_vehicles(model, frame, results)
                scaled_spaces, occupancy_by_space_id = evaluate_spaces(
                    config.spaces,
                    detected_vehicles,
                    frame.shape,
                    original_frame.shape,
                )
                smoothed_occupancy = self.occupancy_smoother.apply(
                    [space["space_id"] for space in config.spaces],
                    occupancy_by_space_id,
                )
                occupied_spaces = draw_space_overlays(annotated_frame, scaled_spaces, smoothed_occupancy)
                post_occupancy(config.lot_id, config.spaces, smoothed_occupancy)
                write_frame(
                    get_detection_frame_path(config.lot_id),
                    draw_vehicle_overlays(original_frame, detected_vehicles),
                )

                if config.is_default:
                    write_frame(LATEST_FRAME_PATH, annotated_frame)

                print(
                    f"[INFO] Lot {config.lot_id} ({config.name}): "
                    f"vehicles={vehicle_count}, occupied={occupied_spaces}/{len(config.spaces)}"
                )
            except Exception as exc:
                print(f"[WARN] Lot {config.lot_id} ({config.name}) detection failed: {exc}")
                time.sleep(1.0)
                continue

            time.sleep(WORKER_LOOP_DELAY_SECONDS)


def main():
    print(f"Using model: {MODEL_PATH}")
    workers: Dict[int, LotDetectorWorker] = {}

    try:
        while True:
            try:
                configs = fetch_lot_configs()
            except Exception as exc:
                print(f"[WARN] Could not refresh lot configs from API: {exc}")
                time.sleep(CONFIG_REFRESH_SECONDS)
                continue

            for lot_id in list(workers.keys()):
                if lot_id not in configs:
                    print(f"[INFO] Stopping detector for removed lot {lot_id}")
                    workers.pop(lot_id).stop()

            for lot_id, config in configs.items():
                worker = workers.get(lot_id)
                if worker is None:
                    worker = LotDetectorWorker(config)
                    workers[lot_id] = worker
                    worker.start()
                    print(f"[INFO] Started detector for lot {lot_id} ({config.name})")
                elif worker.last_signature != config.signature:
                    worker.update_config(config)
                    print(f"[INFO] Updated detector config for lot {lot_id} ({config.name})")

            if not configs:
                print("[INFO] No lots with saved spot polygons yet. Waiting for admin layout data...")

            time.sleep(CONFIG_REFRESH_SECONDS)
    except KeyboardInterrupt:
        pass
    finally:
        for worker in workers.values():
            worker.stop()


if __name__ == "__main__":
    main()
