CREATE TABLE IF NOT EXISTS lots (
  lot_id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  status TEXT,
  region TEXT,
  location TEXT,
  background_image TEXT,
  canvas TEXT
);

CREATE TABLE IF NOT EXISTS spaces (
  space_id INTEGER PRIMARY KEY AUTOINCREMENT,
  lot_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  polygon TEXT NOT NULL,
  editor_x REAL,
  editor_y REAL,
  editor_width REAL,
  editor_height REAL,
  editor_rotation REAL,
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
