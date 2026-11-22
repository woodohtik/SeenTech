-- Rollback of 20270105000005_measurement_links.sql (the expiry column and the change log are kept).
DROP FUNCTION IF EXISTS public.issue_measurements_link(uuid);
DROP FUNCTION IF EXISTS public.revoke_measurements_link(uuid);
DROP FUNCTION IF EXISTS public.save_public_measurements(uuid, jsonb);
