import os
from datetime import datetime, timezone
from typing import Any, Dict, List

from flask import Flask, jsonify, request
import psycopg2
import psycopg2.extras

app = Flask(__name__)

# Example:
# export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/parking"
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/parking")


def get_conn():
    return psycopg2.connect(DATABASE_URL)


@app.get("/health")
def health():
    """Simple health check: verifies DB connectivity and returns component flags."""
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT 1;")
        return jsonify(
            {
                "ok": True,
                "db": True,
                # These can be toggled later when camera + inference loop exist:
                "camera_connected": False,
                "inference_running": False,
                "ts": datetime.now(timezone.utc).isoformat(),
            }
        )
    except Exception as e:
        return jsonify({"ok": False, "db": False, "error": str(e)}), 500


@app.get("/lots/<int:lot_id>/occupancy")
def lot_occupancy(lot_id: int):
    """Current occupancy by lot: each space + occupied + last_updated."""
    with get_conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT s.space_id, s.label, s.polygon,
                   COALESCE(st.occupied, FALSE) AS occupied,
                   st.confidence, st.last_updated
            FROM spaces s
            LEFT JOIN space_status st ON st.space_id = s.space_id
            WHERE s.lot_id = %s
            ORDER BY s.label;
            """,
            (lot_id,),
        )
        rows = cur.fetchall()
    return jsonify({"lot_id": lot_id, "spaces": rows})


@app.get("/lots/<int:lot_id>/summary")
def lot_summary(lot_id: int):
    """Summary stats for the lot: total/open/occupied."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              COUNT(*) AS total,
              SUM(CASE WHEN COALESCE(st.occupied, FALSE) THEN 1 ELSE 0 END) AS occupied,
              SUM(CASE WHEN NOT COALESCE(st.occupied, FALSE) THEN 1 ELSE 0 END) AS open
            FROM spaces s
            LEFT JOIN space_status st ON st.space_id = s.space_id
            WHERE s.lot_id = %s;
            """,
            (lot_id,),
        )
        total, occupied, open_ = cur.fetchone()
    return jsonify({"lot_id": lot_id, "total": total, "occupied": occupied, "open": open_})


@app.post("/spaces/<int:space_id>/status")
def update_space_status(space_id: int):
    """Single-space update. Useful for testing + later for YOLO writes."""
    body = request.get_json(force=True) or {}
    occupied = bool(body.get("occupied", False))
    confidence = body.get("confidence", None)

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO space_status(space_id, occupied, confidence, last_updated)
            VALUES (%s, %s, %s, NOW())
            ON CONFLICT (space_id)
            DO UPDATE SET occupied = EXCLUDED.occupied,
                          confidence = EXCLUDED.confidence,
                          last_updated = NOW();
            """,
            (space_id, occupied, confidence),
        )
        conn.commit()

    return jsonify({"ok": True, "space_id": space_id, "occupied": occupied, "confidence": confidence})


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

    # Optional safety: ensure spaces belong to lot_id (skip heavy checks for now).
    rows = []
    for u in updates:
        try:
            sid = int(u["space_id"])
            occ = bool(u.get("occupied", False))
            conf = u.get("confidence", None)
            rows.append((sid, occ, conf))
        except Exception:
            return jsonify({"ok": False, "error": "Each update must include integer 'space_id'."}), 400

    with get_conn() as conn, conn.cursor() as cur:
        psycopg2.extras.execute_values(
            cur,
            """
            INSERT INTO space_status(space_id, occupied, confidence, last_updated)
            VALUES %s
            ON CONFLICT (space_id)
            DO UPDATE SET occupied = EXCLUDED.occupied,
                          confidence = EXCLUDED.confidence,
                          last_updated = NOW();
            """,
            rows,
        )
        conn.commit()

    return jsonify({"ok": True, "lot_id": lot_id, "updated": len(rows)})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=True)
