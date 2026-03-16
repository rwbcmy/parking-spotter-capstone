import json
from pathlib import Path

import cv2
import numpy as np


BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parent

INPUT_PATH = PROJECT_DIR / "videos" / "Car-Parking.mp4"

OUTPUT_JSON = BASE_DIR / "parking_spots.json"

DISPLAY_WIDTH = 1280
WINDOW_NAME = "Parking Spot Annotator"


current_polygon = []
polygons = []
base_frame = None
scale_x = 1.0
scale_y = 1.0


def is_video_file(path: Path) -> bool:
    return path.suffix.lower() in {".mp4", ".avi", ".mov", ".mkv", ".webm", ".m4v"}


def load_source_frame(path: Path):
    if not path.exists():
        raise FileNotFoundError(f"Input path does not exist: {path}")

    if is_video_file(path):
        cap = cv2.VideoCapture(str(path))
        if not cap.isOpened():
            raise RuntimeError(f"Could not open video: {path}")

        ret, frame = cap.read()
        cap.release()

        if not ret or frame is None:
            raise RuntimeError(f"Could not read first frame from video: {path}")

        return frame, "video"

    frame = cv2.imread(str(path))
    if frame is None:
        raise RuntimeError(f"Could not open image: {path}")
    return frame, "image"


def resize_for_display(frame):
    global scale_x, scale_y

    h, w = frame.shape[:2]
    if w <= DISPLAY_WIDTH:
        scale_x = 1.0
        scale_y = 1.0
        return frame.copy()

    display_w = DISPLAY_WIDTH
    display_h = int(h * (display_w / w))
    resized = cv2.resize(frame, (display_w, display_h))

    scale_x = w / display_w
    scale_y = h / display_h
    return resized


def to_original_coords(points):
    converted = []
    for x, y in points:
        ox = int(round(x * scale_x))
        oy = int(round(y * scale_y))
        converted.append([ox, oy])
    return converted


def draw_overlay():
    canvas = base_frame.copy()

    for idx, poly in enumerate(polygons, start=1):
        pts = np.array(poly, dtype=np.int32)
        cv2.polylines(canvas, [pts], isClosed=True, color=(0, 255, 0), thickness=2)

        if len(poly) > 0:
            label_x, label_y = poly[0]
            cv2.putText(
                canvas,
                f"{idx}",
                (label_x + 5, label_y - 5),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.7,
                (0, 255, 0),
                2,
            )

    if len(current_polygon) > 0:
        pts = np.array(current_polygon, dtype=np.int32)
        for x, y in current_polygon:
            cv2.circle(canvas, (x, y), 4, (0, 255, 255), -1)

        if len(current_polygon) > 1:
            cv2.polylines(canvas, [pts], isClosed=False, color=(0, 255, 255), thickness=2)

    instructions = [
        "Left click: add point",
        "C: close/save polygon (min 3 points)",
        "U: undo last point",
        "R: remove last saved polygon",
        "S: save JSON",
        "Q or ESC: quit",
    ]

    y = 25
    for line in instructions:
        cv2.putText(
            canvas,
            line,
            (10, y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            (255, 255, 255),
            2,
        )
        y += 28

    cv2.putText(
        canvas,
        f"Saved spots: {len(polygons)} | Current points: {len(current_polygon)}",
        (10, y + 10),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.7,
        (255, 255, 255),
        2,
    )

    return canvas


def save_json():
    data = {
        "spots": [],
    }

    for idx, poly in enumerate(polygons, start=1):
        data["spots"].append(
            {
                "id": idx,
                "label": f"spot_{idx}",
                "polygon": to_original_coords(poly),
            }
        )

    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

    print(f"Saved {len(polygons)} parking spot polygons to: {OUTPUT_JSON}")


def mouse_callback(event, x, y, flags, param):
    global current_polygon

    if event == cv2.EVENT_LBUTTONDOWN:
        current_polygon.append((x, y))


def main():
    global base_frame, current_polygon, polygons

    frame, _ = load_source_frame(INPUT_PATH)
    base_frame = resize_for_display(frame)

    print(f"Loaded: {INPUT_PATH}")
    print("Controls:")
    print("  Left click -> add polygon point")
    print("  C          -> close and save current polygon")
    print("  U          -> undo last point in current polygon")
    print("  R          -> remove last saved polygon")
    print("  S          -> save polygons to JSON")
    print("  Q / ESC    -> quit")

    cv2.namedWindow(WINDOW_NAME)
    cv2.setMouseCallback(WINDOW_NAME, mouse_callback)

    while True:
        canvas = draw_overlay()
        cv2.imshow(WINDOW_NAME, canvas)

        key = cv2.waitKey(20) & 0xFF

        if key == ord("c"):
            if len(current_polygon) >= 3:
                polygons.append(current_polygon.copy())
                print(f"Saved polygon #{len(polygons)} with {len(current_polygon)} points")
                current_polygon = []
            else:
                print("Need at least 3 points to save a polygon")

        elif key == ord("u"):
            if current_polygon:
                removed = current_polygon.pop()
                print(f"Removed point: {removed}")

        elif key == ord("r"):
            if polygons:
                polygons.pop()
                print(f"Removed last saved polygon. Remaining: {len(polygons)}")

        elif key == ord("s"):
            save_json()

        elif key == ord("q") or key == 27:
            break

    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()