ALTER TABLE tenants
  ADD COLUMN measurement_unit TEXT NOT NULL DEFAULT 'inch'
  CHECK (measurement_unit IN ('cm', 'inch'));
