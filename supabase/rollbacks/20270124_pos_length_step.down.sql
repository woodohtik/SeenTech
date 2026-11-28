-- Rollback of 20270124000001_pos_length_step.sql.
ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_pos_length_step_allowed;
ALTER TABLE public.tenants DROP COLUMN IF EXISTS pos_length_step;
