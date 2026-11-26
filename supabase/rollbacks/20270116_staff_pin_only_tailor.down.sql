-- Rollback of 20270116000000_staff_pin_only_tailor.sql: email required for
-- every employee again. A PIN-only tailor (email IS NULL) would block the
-- NOT NULL -- they are listed first and must get an email (or be removed)
-- by the shop before this runs; the DO block refuses rather than guessing.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.staff WHERE email IS NULL) THEN
    RAISE EXCEPTION 'PIN-only tailors exist (staff.email IS NULL) -- give them an email first';
  END IF;
END $$;

ALTER TABLE public.staff DROP CONSTRAINT IF EXISTS staff_email_required_unless_tailor;
ALTER TABLE public.staff ALTER COLUMN email SET NOT NULL;
