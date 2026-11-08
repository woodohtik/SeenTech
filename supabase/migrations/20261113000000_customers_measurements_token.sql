ALTER TABLE customers ADD COLUMN IF NOT EXISTS measurements_token UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_measurements_token ON customers (measurements_token);
