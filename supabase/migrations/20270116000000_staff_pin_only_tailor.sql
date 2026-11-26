-- seen-merchant-trial-test-2026-11-26.md, phase 2 item 1 (question 1's
-- default): a tailor may be a PIN-only employee -- no email, no sign-in
-- account; they sign in with their PIN on the shop's device
-- (/api/staff/verify-pin looks staff up by tenant, not by email or uid).
-- Every other role still needs an email.
--
-- Test: supabase/tests/staff_pin_only_tailor_test.sql
-- Rollback: supabase/rollbacks/20270116_staff_pin_only_tailor.down.sql

ALTER TABLE public.staff ALTER COLUMN email DROP NOT NULL;

ALTER TABLE public.staff DROP CONSTRAINT IF EXISTS staff_email_required_unless_tailor;
ALTER TABLE public.staff ADD CONSTRAINT staff_email_required_unless_tailor
  CHECK (email IS NOT NULL OR role::text = 'tailor');
