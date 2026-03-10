import json
import os
import sqlite3
from datetime import datetime, timezone
from typing import Any, Dict, List

from flask import Flask, jsonify, request

app = Flask(__name__)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATABASE_PATH = os.getenv("DATABASE_PATH", os.path.join(BASE_DIR, "database", "parking.db"))
SCHEMA_PATH = os.path.join(BASE_DIR, "database", "schema.sql")
SEED_PATH = os.path.join(BASE_DIR, "database", "seed.sql")


def get_conn():
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def utc_now_iso():
    return datetime.now(timezone.utc).isoformat()


def init_db():
    os.makedirs(os.path.dirname(DATABASE_PATH), exist_ok=True)

    with get_conn() as conn:
        with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
            conn.executescript(f.read())

        with open(SEED_PATH, "r", encoding="utf-8") as f:
            conn.executescript(f.read())

        conn.commit()


@app.get("/health")
def health():
    """Simple health check: verifies DB connectivity and returns component flags."""
    try:
        with get_conn() as conn:
            conn.execute("SELECT 1;")
        return jsonify(
            {
                "ok": True,
                "db": True,
                "camera_connected": False,
                "inference_running": False,
                "ts": utc_now_iso(),
            }
        )
    except Exception as e:
        return jsonify({"ok": False, "db": False, "error": str(e)}), 500


@app.get("/lots/<int:lot_id>/occupancy")
def lot_occupancy(lot_id: int):
    """Current occupancy by lot: each space + occupied + last_updated."""
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT s.space_id, s.label, s.polygon,
                   COALESCE(st.occupied, 0) AS occupied,
                   st.confidence, st.last_updated
            FROM spaces s
            LEFT JOIN space_status st ON st.space_id = s.space_id
            WHERE s.lot_id = ?
            ORDER BY s.label;
            """,
            (lot_id,),
        ).fetchall()

    spaces = [dict(row) for row in rows]

    for row in spaces:
        if row.get("polygon"):
            try:
                row["polygon"] = json.loads(row["polygon"])
            except Exception:
                pass
        row["occupied"] = bool(row["occupied"])

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


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "8080")), debug=True)
