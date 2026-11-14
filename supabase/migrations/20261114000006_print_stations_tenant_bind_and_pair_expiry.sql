-- seen-cto-sprint0-critical-fixes-task.md item 8 (PRT-01).
-- Read cto-review-2026-11-13/04-printing.md's full PRT-01 entry first:
-- print_stations had no tenant_id at all; any authenticated staff member
-- of ANY tenant (no role, no tenant link required) could guess another
-- merchant's permanent, never-expiring 6-char pairing code (~30 bits, no
-- rotation on success) and gain that merchant's clientToken -- queueing
-- arbitrary print jobs, listing their printers/hostname, or locking them
-- out via /unpair. /job, /job/:id, /station/:id, /unpair had no
-- `authenticate` and no tenant check at all.
--
-- No existing data links a station to a tenant (checked: /pair already
-- required `authenticate` but never recorded req.user anywhere), so
-- backfill is not possible -- every already-paired station's tenant_id
-- starts NULL and must re-pair once after this ships (the task's own
-- fallback: "وإلا اطلب إعادة الإقران").

ALTER TABLE public.print_stations ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS print_stations_tenant_idx ON public.print_stations (tenant_id);

-- pair_code becomes single-use (NULLed out right after a successful
-- /pair) and time-limited (10 minutes from issuance) -- previously it
-- never expired and was only ever rotated by /unpair. NULL is allowed to
-- repeat under the existing UNIQUE index (unlike empty string, which
-- would collide across every already-paired station), so no need to
-- drop that index.
ALTER TABLE public.print_stations ALTER COLUMN pair_code DROP NOT NULL;
ALTER TABLE public.print_stations ADD COLUMN IF NOT EXISTS pair_code_expires_at timestamptz;
