INSERT OR IGNORE INTO lots(name) VALUES ('Demo Lot');

-- If you run multiple times, you may want to clear spaces first:
-- DELETE FROM space_status;
-- DELETE FROM spaces;
-- DELETE FROM lots;

INSERT OR IGNORE INTO spaces(lot_id, label, polygon)
SELECT l.lot_id, 'A1', '[{"x":10,"y":10},{"x":110,"y":10},{"x":110,"y":60},{"x":10,"y":60}]'
FROM lots l
WHERE l.name = 'Demo Lot';

INSERT OR IGNORE INTO spaces(lot_id, label, polygon)
SELECT l.lot_id, 'A2', '[{"x":120,"y":10},{"x":220,"y":10},{"x":220,"y":60},{"x":120,"y":60}]'
FROM lots l
WHERE l.name = 'Demo Lot';

INSERT OR IGNORE INTO spaces(lot_id, label, polygon)
SELECT l.lot_id, 'A3', '[{"x":230,"y":10},{"x":330,"y":10},{"x":330,"y":60},{"x":230,"y":60}]'
FROM lots l
WHERE l.name = 'Demo Lot';