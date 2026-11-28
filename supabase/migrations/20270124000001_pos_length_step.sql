-- seen-open-verticals-task.md, wave 1 (fabric stores): the POS ± step for
-- items sold by length, per shop. NULL = a quarter metre (the old fixed step).
-- Written only through /api/tenant/pos-length-step (service role), like the
-- shop's other settings -- not in the owner self-edit allow-list.
-- Rollback: supabase/rollbacks/20270124_pos_length_step.down.sql
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS pos_length_step numeric(4,2);
ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_pos_length_step_allowed;
ALTER TABLE public.tenants ADD CONSTRAINT tenants_pos_length_step_allowed
  CHECK (pos_length_step IS NULL OR pos_length_step IN (0.05, 0.1, 0.25, 0.5, 1));
