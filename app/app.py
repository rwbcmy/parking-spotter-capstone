import atexit
import io
import json
import os
import sqlite3
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, List

import cv2
from flask_cors import CORS

from flask import Flask, jsonify, request, send_file

app = Flask(__name__)
CORS(app)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATABASE_PATH = os.getenv("DATABASE_PATH", os.path.join(BASE_DIR, "database", "parking.db"))
SCHEMA_PATH = os.path.join(BASE_DIR, "database", "schema.sql")
PARKING_SPOTS_PATH = os.path.join(BASE_DIR, "app", "parking_spots.json")
LATEST_FRAME_PATH = os.path.join(BASE_DIR, "app", "latest_frame.jpg")
DETECTION_FRAME_DIR = os.path.join(BASE_DIR, "app", "detection_frames")
RTSP_URL = os.getenv("RTSP_URL", "rtsp://capstone:4970wcapstoneit!@10.10.10.127:8554/CH001.sdp")
INFERENCE_SCRIPT_PATH = os.path.join(BASE_DIR, "app", "inference.py")
AUTO_START_INFERENCE = os.getenv("AUTO_START_INFERENCE", "1") == "1"
INFERENCE_PROCESS = None
CAMERA_STREAM_RETRY_SECONDS = float(os.getenv("CAMERA_STREAM_RETRY_SECONDS", "1.0"))
CAMERA_STREAM_BOOT_WAIT_SECONDS = float(os.getenv("CAMERA_STREAM_BOOT_WAIT_SECONDS", "2.0"))
CAMERA_STREAMS: Dict[str, "CameraStreamWorker"] = {}
CAMERA_STREAMS_LOCK = threading.Lock()

LOT_EXTRA_COLUMNS = {
    "description": "TEXT",
    "status": "TEXT",
    "region": "TEXT",
    "location": "TEXT",
    "background_image": "TEXT",
    "canvas": "TEXT",
    "camera_url": "TEXT",
    "is_default": "INTEGER DEFAULT 0",
}

SPACE_EDITOR_COLUMNS = {
    "editor_x": "REAL",
    "editor_y": "REAL",
    "editor_width": "REAL",
    "editor_height": "REAL",
    "editor_rotation": "REAL",
}


def get_conn():
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def utc_now_iso():
    return datetime.now(timezone.utc).isoformat()


def safe_json_loads(value: Any, fallback: Any):
    if value in (None, ""):
        return fallback

    if isinstance(value, (dict, list)):
        return value

    try:
        return json.loads(value)
    except Exception:
        return fallback


def frame_looks_invalid(frame) -> bool:
    try:
        grayscale = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        return float(grayscale.std()) < 6.0
    except Exception:
        return False


class CameraStreamWorker:
    def __init__(self, camera_url: str):
        self.camera_url = camera_url
        self.stop_event = threading.Event()
        self.frame_lock = threading.Lock()
        self.latest_frame_bytes: bytes | None = None
        self.latest_frame_ts = 0.0
        self.connected = False
        self.last_error = ""
        self.thread = threading.Thread(
            target=self._run,
            daemon=True,
            name=f"camera-stream-{abs(hash(camera_url)) % 100000}",
        )

    def start(self):
        if not self.thread.is_alive():
            self.thread.start()

    def stop(self):
        self.stop_event.set()
        if self.thread.is_alive():
            self.thread.join(timeout=2.0)

    def snapshot(self):
        with self.frame_lock:
            return {
                "bytes": self.latest_frame_bytes,
                "timestamp": self.latest_frame_ts,
                "connected": self.connected,
                "last_error": self.last_error,
            }

    def get_frame_bytes(self, max_wait_seconds: float = 0.0):
        deadline = time.time() + max_wait_seconds
        snapshot = self.snapshot()
        while snapshot["bytes"] is None and time.time() < deadline and not self.stop_event.is_set():
            time.sleep(0.05)
            snapshot = self.snapshot()

        return snapshot["bytes"]

    def _store_frame(self, frame):
        encoded_bytes = encode_frame_bytes(frame)
        with self.frame_lock:
            self.latest_frame_bytes = encoded_bytes
            self.latest_frame_ts = time.time()
            self.connected = True
            self.last_error = ""

    def _set_disconnected(self, error_message: str):
        with self.frame_lock:
            self.connected = False
            self.last_error = error_message

    def _run(self):
        while not self.stop_event.is_set():
            cap = cv2.VideoCapture(self.camera_url)
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

            if not cap.isOpened():
                self._set_disconnected(f"Could not open RTSP stream: {self.camera_url}")
                cap.release()
                time.sleep(CAMERA_STREAM_RETRY_SECONDS)
                continue

            fallback_frame = None

            while not self.stop_event.is_set():
                ret, frame = cap.read()
                if not ret or frame is None:
                    self._set_disconnected(f"Camera read failed: {self.camera_url}")
                    break

                fallback_frame = frame
                if frame_looks_invalid(frame):
                    if self.latest_frame_bytes is None and fallback_frame is not None:
                        try:
                            self._store_frame(fallback_frame)
                        except Exception:
                            pass
                    continue

                try:
                    self._store_frame(frame)
                except Exception as exc:
                    self._set_disconnected(str(exc))

            cap.release()
            if not self.stop_event.is_set():
                time.sleep(CAMERA_STREAM_RETRY_SECONDS)


def normalize_camera_url(camera_url: str | None = None):
    return (camera_url or RTSP_URL).strip() or RTSP_URL


def ensure_camera_stream(camera_url: str | None = None):
    normalized_url = normalize_camera_url(camera_url)

    with CAMERA_STREAMS_LOCK:
        worker = CAMERA_STREAMS.get(normalized_url)
        if worker is None:
            worker = CameraStreamWorker(normalized_url)
            CAMERA_STREAMS[normalized_url] = worker
            worker.start()

    return worker


def stop_camera_streams():
    with CAMERA_STREAMS_LOCK:
        workers = list(CAMERA_STREAMS.values())
        CAMERA_STREAMS.clear()

    for worker in workers:
        worker.stop()


def preload_configured_camera_streams():
    ensure_camera_stream(RTSP_URL)

    with get_conn() as conn:
        rows = conn.execute(
            "SELECT DISTINCT camera_url FROM lots WHERE TRIM(COALESCE(camera_url, '')) <> ''"
        ).fetchall()

    for row in rows:
        ensure_camera_stream(row["camera_url"])


def stop_inference_process():
    global INFERENCE_PROCESS

    if INFERENCE_PROCESS is None:
        return

    if INFERENCE_PROCESS.poll() is None:
        INFERENCE_PROCESS.terminate()

    INFERENCE_PROCESS = None


def maybe_start_inference():
    global INFERENCE_PROCESS

    if not AUTO_START_INFERENCE or INFERENCE_PROCESS is not None:
        return

    if not os.path.exists(INFERENCE_SCRIPT_PATH):
        print(f"[WARN] Inference script not found: {INFERENCE_SCRIPT_PATH}")
        return

    env = os.environ.copy()
    env.setdefault("API_BASE", f"http://127.0.0.1:{env.get('PORT', '8080')}")

    try:
        INFERENCE_PROCESS = subprocess.Popen(
            [sys.executable, INFERENCE_SCRIPT_PATH],
            cwd=os.path.join(BASE_DIR, "app"),
            env=env,
        )
        print(f"[INFO] Started inference process with PID {INFERENCE_PROCESS.pid}")
    except Exception as exc:
        print(f"[WARN] Failed to start inference process: {exc}")


def ensure_column(conn: sqlite3.Connection, table_name: str, column_name: str, column_type: str):
    existing_columns = {
        row["name"]
        for row in conn.execute(f"PRAGMA table_info({table_name})").fetchall()
    }
    if column_name not in existing_columns:
        conn.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}")


def normalize_polygon_point(point: Any) -> Dict[str, int]:
    if isinstance(point, dict):
        x = point.get("x")
        y = point.get("y")
    elif isinstance(point, (list, tuple)) and len(point) >= 2:
        x, y = point[0], point[1]
    else:
        raise ValueError("Polygon points must be {x, y} objects or [x, y] pairs.")

    if x is None or y is None:
        raise ValueError("Polygon points must include x and y values.")

    return {"x": int(round(float(x))), "y": int(round(float(y)))}


def normalize_polygon(polygon: Any) -> List[Dict[str, int]]:
    if not isinstance(polygon, list) or len(polygon) < 3:
        raise ValueError("Polygon must be a list with at least 3 points.")

    return [normalize_polygon_point(point) for point in polygon]


def parse_polygon(raw_polygon: Any):
    if not raw_polygon:
        return raw_polygon

    if isinstance(raw_polygon, str):
        raw_polygon = json.loads(raw_polygon)

    return normalize_polygon(raw_polygon)


def serialize_polygon(polygon: Any) -> str:
    return json.dumps(normalize_polygon(polygon))


def normalize_space_row(row: sqlite3.Row):
    space = dict(row)
    if space.get("polygon"):
        try:
            space["polygon"] = parse_polygon(space["polygon"])
        except Exception:
            pass

    if "occupied" in space:
        space["occupied"] = bool(space["occupied"])

    return space


def normalize_lot_row(row: sqlite3.Row):
    lot = dict(row)
    lot["description"] = lot.get("description") or ""
    lot["status"] = lot.get("status") or "active"
    lot["region"] = lot.get("region") or "Main Campus"
    lot["location"] = safe_json_loads(lot.get("location"), {"x": 38, "y": 58})
    lot["background_image"] = lot.get("background_image") or ""
    lot["canvas"] = safe_json_loads(lot.get("canvas"), {"width": 1000, "height": 600})
    lot["camera_url"] = lot.get("camera_url") or ""
    lot["is_default"] = bool(lot.get("is_default"))
    return lot


def enrich_lot_for_frontend(lot: Dict[str, Any]):
    return dict(lot)


def lot_exists(conn: sqlite3.Connection, lot_id: int) -> bool:
    row = conn.execute("SELECT 1 FROM lots WHERE lot_id = ?", (lot_id,)).fetchone()
    return row is not None


def maybe_set_default_lot(conn: sqlite3.Connection, lot_id: int, is_default: bool):
    if not is_default:
        return

    conn.execute("UPDATE lots SET is_default = 0")
    conn.execute("UPDATE lots SET is_default = 1 WHERE lot_id = ?", (lot_id,))


def fetch_lot_spaces(conn: sqlite3.Connection, lot_id: int):
    rows = conn.execute(
        """
        SELECT s.space_id, s.label, s.polygon,
               s.editor_x, s.editor_y, s.editor_width, s.editor_height, s.editor_rotation,
               COALESCE(st.occupied, 0) AS occupied,
               st.confidence, st.last_updated
        FROM spaces s
        LEFT JOIN space_status st ON st.space_id = s.space_id
        WHERE s.lot_id = ?
        ORDER BY s.space_id;
        """,
        (lot_id,),
    ).fetchall()
    return [normalize_space_row(row) for row in rows]


def fetch_lot_detail(conn: sqlite3.Connection, lot_id: int):
    lot_row = conn.execute("SELECT * FROM lots WHERE lot_id = ?", (lot_id,)).fetchone()
    if lot_row is None:
        return None

    return {
        "lot": enrich_lot_for_frontend(normalize_lot_row(lot_row)),
        "spaces": fetch_lot_spaces(conn, lot_id),
    }


def write_parking_spots_json(spaces: List[Dict[str, Any]]):
    data = {
        "spots": [
            {
                "id": index,
                "label": space["label"],
                "polygon": [[point["x"], point["y"]] for point in space["polygon"]],
            }
            for index, space in enumerate(spaces, start=1)
        ]
    }

    with open(PARKING_SPOTS_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def encode_frame_bytes(frame) -> bytes:
    ok, encoded = cv2.imencode(".jpg", frame)
    if not ok:
        raise RuntimeError("Could not encode camera frame.")
    return encoded.tobytes()


def get_detection_frame_path(lot_id: int):
    return os.path.join(DETECTION_FRAME_DIR, f"lot-{lot_id}.jpg")


def wants_detection_overlay():
    overlay = (request.args.get("overlay") or "").strip().lower()
    return overlay in {"1", "true", "yes", "detections", "detection", "vehicles", "cars"}


def init_db():
    os.makedirs(os.path.dirname(DATABASE_PATH), exist_ok=True)

    with get_conn() as conn:
        with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
            conn.executescript(f.read())

        for column_name, column_type in LOT_EXTRA_COLUMNS.items():
            ensure_column(conn, "lots", column_name, column_type)

        for column_name, column_type in SPACE_EDITOR_COLUMNS.items():
            ensure_column(conn, "spaces", column_name, column_type)

        conn.commit()


@app.get("/")
def home():
    return jsonify({"message": "Parking API is running. Frontend using port 5173."})


@app.get("/health")
def health():
    """Simple health check: verifies DB connectivity and returns component flags."""
    try:
        with get_conn() as conn:
            conn.execute("SELECT 1;")

        reference_stream = ensure_camera_stream(RTSP_URL)
        reference_snapshot = reference_stream.snapshot()
        camera_connected = bool(reference_snapshot["connected"] or reference_snapshot["bytes"] is not None)

        return jsonify(
            {
                "ok": True,
                "db": True,
                "camera_connected": camera_connected,
                "inference_running": INFERENCE_PROCESS is not None and INFERENCE_PROCESS.poll() is None,
                "inference": {
                    "camera_connected": camera_connected,
                    "running": INFERENCE_PROCESS is not None and INFERENCE_PROCESS.poll() is None,
                },
                "ts": utc_now_iso(),
            }
        )
    except Exception as e:
        return jsonify({"ok": False, "db": False, "error": str(e)}), 500


@app.get("/lots")
def list_lots():
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM lots ORDER BY is_default DESC, name").fetchall()

    lots = [enrich_lot_for_frontend(normalize_lot_row(row)) for row in rows]
    return jsonify({"lots": lots})


@app.post("/lots")
def create_lot():
    body = request.get_json(force=True) or {}
    lot_payload = body.get("lot") or {}
    spaces = body.get("spaces") or []

    if not isinstance(spaces, list):
        return jsonify({"ok": False, "error": "Body must include a 'spaces' list."}), 400

    lot_name = str(lot_payload.get("name") or "").strip()
    if not lot_name:
        return jsonify({"ok": False, "error": "Lot name is required."}), 400

    normalized_spaces = []
    seen_labels = set()

    for index, space in enumerate(spaces, start=1):
        label = str(space.get("label") or f"spot_{index}").strip()
        if not label:
            return jsonify({"ok": False, "error": "Each space must include a label."}), 400
        if label in seen_labels:
            return jsonify({"ok": False, "error": f"Duplicate space label '{label}'."}), 400

        try:
            polygon = normalize_polygon(space.get("polygon"))
        except Exception as exc:
            return jsonify({"ok": False, "error": str(exc)}), 400

        editor = space.get("editor") or {}
        normalized_spaces.append(
            {
                "label": label,
                "polygon": polygon,
                "editor_x": editor.get("x"),
                "editor_y": editor.get("y"),
                "editor_width": editor.get("width"),
                "editor_height": editor.get("height"),
                "editor_rotation": editor.get("rotation"),
            }
        )
        seen_labels.add(label)

    try:
        with get_conn() as conn:
            cursor = conn.execute(
                """
                INSERT INTO lots(name, description, status, region, location, background_image, canvas, camera_url, is_default)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    lot_name,
                    lot_payload.get("description") or "",
                    lot_payload.get("status") or "active",
                    lot_payload.get("region") or "Main Campus",
                    json.dumps(lot_payload.get("location") or {"lat": 38.9404, "lng": -92.3276}),
                    lot_payload.get("background_image") or "",
                    json.dumps(lot_payload.get("canvas") or {"width": 1000, "height": 600}),
                    lot_payload.get("camera_url") or "",
                    1 if bool(lot_payload.get("is_default")) else 0,
                ),
            )
            lot_id = cursor.lastrowid
            maybe_set_default_lot(conn, lot_id, bool(lot_payload.get("is_default")))

            for space in normalized_spaces:
                conn.execute(
                    """
                    INSERT INTO spaces(lot_id, label, polygon, editor_x, editor_y, editor_width, editor_height, editor_rotation)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        lot_id,
                        space["label"],
                        json.dumps(space["polygon"]),
                        space["editor_x"],
                        space["editor_y"],
                        space["editor_width"],
                        space["editor_height"],
                        space["editor_rotation"],
                    ),
                )

            conn.commit()
            detail = fetch_lot_detail(conn, lot_id)
    except sqlite3.IntegrityError:
        return jsonify({"ok": False, "error": "A lot with that name already exists."}), 409

    if lot_payload.get("camera_url"):
        ensure_camera_stream(str(lot_payload["camera_url"]))

    return jsonify(detail), 201


@app.get("/lots/<int:lot_id>")
def lot_detail(lot_id: int):
    with get_conn() as conn:
        detail = fetch_lot_detail(conn, lot_id)

    if detail is None:
        return jsonify({"ok": False, "error": f"Lot {lot_id} not found."}), 404

    return jsonify(detail)


@app.delete("/lots/<int:lot_id>")
def delete_lot(lot_id: int):
    with get_conn() as conn:
        detail = fetch_lot_detail(conn, lot_id)
        if detail is None:
            return jsonify({"ok": False, "error": f"Lot {lot_id} not found."}), 404

        was_default = bool(detail["lot"].get("is_default"))
        conn.execute("DELETE FROM lots WHERE lot_id = ?", (lot_id,))

        if was_default:
            replacement = conn.execute(
                "SELECT lot_id FROM lots ORDER BY name LIMIT 1"
            ).fetchone()
            if replacement is not None:
                conn.execute("UPDATE lots SET is_default = 1 WHERE lot_id = ?", (replacement["lot_id"],))

        conn.commit()

        remaining_spaces = conn.execute(
            """
            SELECT s.label, s.polygon
            FROM spaces s
            JOIN lots l ON l.lot_id = s.lot_id
            WHERE l.name = 'Demo Lot'
            ORDER BY s.space_id
            """
        ).fetchall()

    if remaining_spaces:
        write_parking_spots_json([normalize_space_row(row) for row in remaining_spaces])

    return jsonify({"ok": True, "lot_id": lot_id})


@app.get("/lots/<int:lot_id>/occupancy")
def lot_occupancy(lot_id: int):
    """Current occupancy by lot: each space + occupied + last_updated."""
    with get_conn() as conn:
        spaces = fetch_lot_spaces(conn, lot_id)

    return jsonify({"lot_id": lot_id, "spaces": spaces})


@app.get("/lots/<int:lot_id>/summary")
def lot_summary(lot_id: int):
    """Summary stats for the lot: total/open/occupied."""
    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT
              COUNT(*) AS total,
              SUM(CASE WHEN COALESCE(st.occupied, 0) THEN 1 ELSE 0 END) AS occupied,
              SUM(CASE WHEN NOT COALESCE(st.occupied, 0) THEN 1 ELSE 0 END) AS open
            FROM spaces s
            LEFT JOIN space_status st ON st.space_id = s.space_id
            WHERE s.lot_id = ?;
            """,
            (lot_id,),
        ).fetchone()

    total = row["total"] or 0
    occupied = row["occupied"] or 0
    open_ = row["open"] or 0

    return jsonify({"lot_id": lot_id, "total": total, "occupied": occupied, "open": open_})


@app.post("/spaces/<int:space_id>/status")
def update_space_status(space_id: int):
    """Single-space update. Useful for testing + later for YOLO writes."""
    body = request.get_json(force=True) or {}
    occupied = 1 if bool(body.get("occupied", False)) else 0
    confidence = body.get("confidence", None)
    last_updated = utc_now_iso()

    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO space_status(space_id, occupied, confidence, last_updated)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(space_id)
            DO UPDATE SET occupied = excluded.occupied,
                          confidence = excluded.confidence,
                          last_updated = excluded.last_updated;
            """,
            (space_id, occupied, confidence, last_updated),
        )
        conn.commit()

    return jsonify(
        {
            "ok": True,
            "space_id": space_id,
            "occupied": bool(occupied),
            "confidence": confidence,
        }
    )


@app.post("/lots/<int:lot_id>/status_batch")
def update_lot_status_batch(lot_id: int):
    """Batch status update for a lot (best for YOLO loop).

    Expected body:
      {"updates": [{"space_id": 1, "occupied": true, "confidence": 0.92}, ...]}
    """
    body = request.get_json(force=True) or {}
    updates: List[Dict[str, Any]] = body.get("updates") or []

    if not isinstance(updates, list) or len(updates) == 0:
        return jsonify({"ok": False, "error": "Body must include non-empty 'updates' list."}), 400

    rows = []
    last_updated = utc_now_iso()

    for u in updates:
        try:
            sid = int(u["space_id"])
            occ = 1 if bool(u.get("occupied", False)) else 0
            conf = u.get("confidence", None)
            rows.append((sid, occ, conf, last_updated))
        except Exception:
            return jsonify({"ok": False, "error": "Each update must include integer 'space_id'."}), 400

    with get_conn() as conn:
        conn.executemany(
            """
            INSERT INTO space_status(space_id, occupied, confidence, last_updated)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(space_id)
            DO UPDATE SET occupied = excluded.occupied,
                          confidence = excluded.confidence,
                          last_updated = excluded.last_updated;
            """,
            rows,
        )
        conn.commit()

    return jsonify({"ok": True, "lot_id": lot_id, "updated": len(rows)})


@app.put("/lots/<int:lot_id>/spaces")
def replace_lot_spaces(lot_id: int):
    body = request.get_json(force=True) or {}
    spaces = body.get("spaces") or []

    if not isinstance(spaces, list):
        return jsonify({"ok": False, "error": "Body must include a 'spaces' list."}), 400

    normalized_spaces = []
    seen_labels = set()

    for index, space in enumerate(spaces, start=1):
        label = str(space.get("label") or f"spot_{index}").strip()
        if not label:
            return jsonify({"ok": False, "error": "Each space must include a label."}), 400
        if label in seen_labels:
            return jsonify({"ok": False, "error": f"Duplicate space label '{label}'."}), 400

        try:
            polygon = normalize_polygon(space.get("polygon"))
        except Exception as exc:
            return jsonify({"ok": False, "error": str(exc)}), 400

        seen_labels.add(label)
        normalized_space = {"label": label, "polygon": polygon}
        if space.get("space_id") is not None:
            normalized_space["space_id"] = int(space["space_id"])
        normalized_spaces.append(normalized_space)

    with get_conn() as conn:
        if not lot_exists(conn, lot_id):
            return jsonify({"ok": False, "error": f"Lot {lot_id} not found."}), 404

        existing_space_ids = {
            row["space_id"]
            for row in conn.execute("SELECT space_id FROM spaces WHERE lot_id = ?", (lot_id,)).fetchall()
        }
        kept_space_ids = set()
        pending_updates = []
        pending_inserts = []

        for space in normalized_spaces:
            if space.get("space_id") in existing_space_ids:
                pending_updates.append(space)
                kept_space_ids.add(space["space_id"])
            else:
                pending_inserts.append(space)

        delete_ids = existing_space_ids - kept_space_ids
        if delete_ids:
            conn.executemany("DELETE FROM spaces WHERE space_id = ?", [(space_id,) for space_id in delete_ids])

        # Move existing rows to temporary labels first so swaps/renames do not hit the lot_id+label unique index.
        for space in pending_updates:
            conn.execute(
                "UPDATE spaces SET label = ? WHERE lot_id = ? AND space_id = ?",
                (f"__tmp__{space['space_id']}__", lot_id, space["space_id"]),
            )

        for space in pending_updates:
            conn.execute(
                "UPDATE spaces SET label = ?, polygon = ? WHERE lot_id = ? AND space_id = ?",
                (space["label"], json.dumps(space["polygon"]), lot_id, space["space_id"]),
            )

        for space in pending_inserts:
            cursor = conn.execute(
                "INSERT INTO spaces(lot_id, label, polygon) VALUES (?, ?, ?)",
                (lot_id, space["label"], json.dumps(space["polygon"])),
            )
            kept_space_ids.add(cursor.lastrowid)

        conn.commit()

        saved_spaces = fetch_lot_spaces(conn, lot_id)

    write_parking_spots_json(saved_spaces)

    return jsonify({"ok": True, "lot_id": lot_id, "spaces": saved_spaces})


@app.put("/lots/<int:lot_id>/layout")
def update_lot_layout(lot_id: int):
    body = request.get_json(force=True) or {}
    lot_payload = body.get("lot") or {}
    spaces = body.get("spaces") or []

    if not isinstance(spaces, list):
        return jsonify({"ok": False, "error": "Body must include a 'spaces' list."}), 400

    normalized_spaces = []
    seen_labels = set()

    for index, space in enumerate(spaces, start=1):
        label = str(space.get("label") or f"spot_{index}").strip()
        if not label:
            return jsonify({"ok": False, "error": "Each space must include a label."}), 400
        if label in seen_labels:
            return jsonify({"ok": False, "error": f"Duplicate space label '{label}'."}), 400

        try:
            polygon = normalize_polygon(space.get("polygon"))
        except Exception as exc:
            return jsonify({"ok": False, "error": str(exc)}), 400

        editor = space.get("editor") or {}
        normalized_space = {
            "label": label,
            "polygon": polygon,
            "backend_space_id": space.get("backend_space_id"),
            "editor_x": editor.get("x"),
            "editor_y": editor.get("y"),
            "editor_width": editor.get("width"),
            "editor_height": editor.get("height"),
            "editor_rotation": editor.get("rotation"),
        }
        seen_labels.add(label)
        normalized_spaces.append(normalized_space)

    with get_conn() as conn:
        if not lot_exists(conn, lot_id):
            return jsonify({"ok": False, "error": f"Lot {lot_id} not found."}), 404

        conn.execute(
            """
            UPDATE lots
            SET name = ?,
                description = ?,
                status = ?,
                region = ?,
                location = ?,
                background_image = ?,
                canvas = ?,
                camera_url = ?,
                is_default = ?
            WHERE lot_id = ?
            """,
            (
                lot_payload.get("name") or "Demo Lot",
                lot_payload.get("description") or "",
                lot_payload.get("status") or "active",
                lot_payload.get("region") or "Main Campus",
                json.dumps(lot_payload.get("location") or {"x": 38, "y": 58}),
                lot_payload.get("background_image") or "",
                json.dumps(lot_payload.get("canvas") or {"width": 1000, "height": 600}),
                lot_payload.get("camera_url") or "",
                1 if bool(lot_payload.get("is_default")) else 0,
                lot_id,
            ),
        )
        maybe_set_default_lot(conn, lot_id, bool(lot_payload.get("is_default")))

        existing_space_ids = {
            row["space_id"]
            for row in conn.execute("SELECT space_id FROM spaces WHERE lot_id = ?", (lot_id,)).fetchall()
        }
        kept_space_ids = set()
        pending_updates = []
        pending_inserts = []

        for space in normalized_spaces:
            backend_space_id = space.get("backend_space_id")
            if backend_space_id is not None:
                try:
                    backend_space_id = int(backend_space_id)
                except Exception:
                    backend_space_id = None

            if backend_space_id in existing_space_ids:
                space["backend_space_id"] = backend_space_id
                pending_updates.append(space)
                kept_space_ids.add(backend_space_id)
            else:
                pending_inserts.append(space)

        delete_ids = existing_space_ids - kept_space_ids
        if delete_ids:
            conn.executemany("DELETE FROM spaces WHERE space_id = ?", [(space_id,) for space_id in delete_ids])

        for space in pending_updates:
            conn.execute(
                "UPDATE spaces SET label = ? WHERE lot_id = ? AND space_id = ?",
                (f"__tmp__{space['backend_space_id']}__", lot_id, space["backend_space_id"]),
            )

        for space in pending_updates:
            conn.execute(
                """
                UPDATE spaces
                SET label = ?, polygon = ?, editor_x = ?, editor_y = ?, editor_width = ?, editor_height = ?, editor_rotation = ?
                WHERE lot_id = ? AND space_id = ?
                """,
                (
                    space["label"],
                    json.dumps(space["polygon"]),
                    space["editor_x"],
                    space["editor_y"],
                    space["editor_width"],
                    space["editor_height"],
                    space["editor_rotation"],
                    lot_id,
                    space["backend_space_id"],
                ),
            )

        for space in pending_inserts:
            cursor = conn.execute(
                """
                INSERT INTO spaces(lot_id, label, polygon, editor_x, editor_y, editor_width, editor_height, editor_rotation)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    lot_id,
                    space["label"],
                    json.dumps(space["polygon"]),
                    space["editor_x"],
                    space["editor_y"],
                    space["editor_width"],
                    space["editor_height"],
                    space["editor_rotation"],
                ),
            )
            kept_space_ids.add(cursor.lastrowid)

        conn.commit()
        detail = fetch_lot_detail(conn, lot_id)

    write_parking_spots_json(detail["spaces"])
    if lot_payload.get("camera_url"):
        ensure_camera_stream(str(lot_payload["camera_url"]))
    return jsonify(detail)


@app.get("/reference-frame")
def reference_frame():
    worker = ensure_camera_stream(RTSP_URL)
    encoded_bytes = worker.get_frame_bytes(max_wait_seconds=CAMERA_STREAM_BOOT_WAIT_SECONDS)
    if encoded_bytes is None:
        snapshot = worker.snapshot()
        return jsonify({"ok": False, "error": snapshot["last_error"] or "Reference camera frame unavailable."}), 503

    return send_file(
        io.BytesIO(encoded_bytes),
        mimetype="image/jpeg",
        download_name="reference-frame.jpg",
    )


@app.get("/live-frame")
def live_frame():
    if os.path.exists(LATEST_FRAME_PATH):
        return send_file(LATEST_FRAME_PATH, mimetype="image/jpeg", conditional=False)

    return reference_frame()


@app.get("/camera/frame")
def camera_frame():
    lot_id = request.args.get("lot_id", type=int)
    show_detections = wants_detection_overlay()
    if lot_id is None:
        return live_frame()

    if show_detections:
        detection_frame_path = get_detection_frame_path(lot_id)
        if os.path.exists(detection_frame_path):
            return send_file(detection_frame_path, mimetype="image/jpeg", conditional=False)

    with get_conn() as conn:
        lot_row = conn.execute("SELECT camera_url FROM lots WHERE lot_id = ?", (lot_id,)).fetchone()

    if lot_row is None:
        return jsonify({"ok": False, "error": f"Lot {lot_id} not found."}), 404

    camera_url = (lot_row["camera_url"] or "").strip()
    if not camera_url:
        return live_frame()

    worker = ensure_camera_stream(camera_url)
    encoded_bytes = worker.get_frame_bytes(max_wait_seconds=CAMERA_STREAM_BOOT_WAIT_SECONDS)
    if encoded_bytes is None:
        snapshot = worker.snapshot()
        return jsonify({"ok": False, "error": snapshot["last_error"] or "Lot camera frame unavailable."}), 503

    return send_file(
        io.BytesIO(encoded_bytes),
        mimetype="image/jpeg",
        download_name="camera-frame.jpg",
    )


if __name__ == "__main__":
    init_db()
    atexit.register(stop_inference_process)
    atexit.register(stop_camera_streams)

    debug_mode = True
    should_run_background_services = not debug_mode or os.environ.get("WERKZEUG_RUN_MAIN") == "true"
    if should_run_background_services:
        preload_configured_camera_streams()
        maybe_start_inference()

    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "8080")), debug=debug_mode)
