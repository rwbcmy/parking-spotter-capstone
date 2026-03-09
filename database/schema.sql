CREATE TABLE IF NOT EXISTS lots (
  lot_id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS spaces (
  space_id INTEGER PRIMARY KEY AUTOINCREMENT,
  lot_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  polygon TEXT NOT NULL,
  FOREIGN KEY (lot_id) REFERENCES lots(lot_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS space_status (
  space_id INTEGER PRIMARY KEY,
  occupied INTEGER NOT NULL DEFAULT 0,
  confidence REAL,
  last_updated TEXT,
  FOREIGN KEY (space_id) REFERENCES spaces(space_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_spaces_lot_id ON spaces(lot_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_spaces_lot_label ON spaces(lot_id, label);