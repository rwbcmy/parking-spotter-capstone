-- Seed data (optional): creates one lot and a few spaces with dummy polygons.
INSERT INTO lots(name) VALUES ('Demo Lot') ON CONFLICT DO NOTHING;

-- If you run multiple times, you may want to clear spaces first:
-- DELETE FROM space_status;
-- DELETE FROM spaces;
-- DELETE FROM lots;

INSERT INTO spaces(lot_id, label, polygon)
SELECT l.lot_id, v.label, v.polygon::jsonb
FROM lots l
JOIN (VALUES
  ('A1', '[{"x":10,"y":10},{"x":110,"y":10},{"x":110,"y":60},{"x":10,"y":60}]'),
  ('A2', '[{"x":120,"y":10},{"x":220,"y":10},{"x":220,"y":60},{"x":120,"y":60}]'),
  ('A3', '[{"x":230,"y":10},{"x":330,"y":10},{"x":330,"y":60},{"x":230,"y":60}]')
) AS v(label, polygon) ON TRUE
WHERE l.name = 'Demo Lot';
