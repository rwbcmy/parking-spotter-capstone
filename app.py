-- Parking Detection Foundation Schema (PostgreSQL)
-- Tables: lots, spaces, space_status
-- Designed to support API endpoints for:
--   - current occupancy by lot
--   - summary stats by lot
--   - health check
--   - status updates (single + batch)

CREATE TABLE IF NOT EXISTS lots (
  lot_id SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS spaces (
  space_id SERIAL PRIMARY KEY,
  lot_id INT NOT NULL REFERENCES lots(lot_id) ON DELETE CASCADE,
  label TEXT NOT NULL,                -- e.g., "A1", "A2"
  polygon JSONB NOT NULL              -- store ROI polygon coordinates as JSON
);

CREATE TABLE IF NOT EXISTS space_status (
  space_id INT PRIMARY KEY REFERENCES spaces(space_id) ON DELETE CASCADE,
  occupied BOOLEAN NOT NULL DEFAULT FALSE,
  confidence REAL,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_spaces_lot_id ON spaces(lot_id);
