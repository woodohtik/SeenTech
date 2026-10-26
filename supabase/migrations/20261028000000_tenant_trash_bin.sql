-- Super admin "delete a subscriber" feature: every FK referencing
-- tenants.id across the whole schema is ON DELETE CASCADE (46 of them) or
-- ON DELETE SET NULL (4) -- a real DELETE FROM tenants today would succeed
-- immediately and wipe that business's entire history with nothing to stop
-- it. A trash bin in front of it is the safety layer: "delete" moves a
-- tenant to a recoverable trashed state; only a second, explicit action on
-- an already-trashed tenant performs the real, irreversible DELETE.
--
-- Deliberately a separate column from the existing PLG trial lifecycle
-- (subscription_status/locked_at/purge_at, 20260910040000) -- that
-- pipeline already owns automated lock/purge semantics; trashed_at is a
-- distinct, manually-triggered super-admin action and must not collide
-- with or be swept by trial_purge_sweep.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS trashed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trashed_by TEXT;

-- -----------------------------------------------------------------------------
-- app_current_tenant_id(): a trashed tenant must lose all data access exactly
-- like an inactive one -- same defense-in-depth reasoning as
-- 20261013050000_app_current_tenant_id_blocks_inactive_tenant.sql, extended
-- with one more condition.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_current_tenant_id()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    t_id UUID;
    cur_uid TEXT;
    t_status TEXT;
    t_trashed_at TIMESTAMPTZ;
BEGIN
    cur_uid := app_current_uid();
    IF cur_uid IS NULL THEN RETURN NULL; END IF;

    -- 1. Check if user is staff (Owner is often also staff)
    SELECT tenant_id INTO t_id FROM staff WHERE uid = cur_uid AND status = 'active' LIMIT 1;

    -- 2. Check if user is owner directly from tenants table
    IF t_id IS NULL THEN
        SELECT id INTO t_id FROM tenants WHERE owner_uid = cur_uid LIMIT 1;
    END IF;

    IF t_id IS NULL THEN RETURN NULL; END IF;

    -- 3. A suspended or trashed tenant has no active tenant scope at all --
    -- every RLS policy keyed on this function stops matching any row for them.
    SELECT status, trashed_at INTO t_status, t_trashed_at FROM tenants WHERE id = t_id;
    IF t_status = 'inactive' OR t_trashed_at IS NOT NULL THEN
        RETURN NULL;
    END IF;

    RETURN t_id;
END;
$$;

-- -----------------------------------------------------------------------------
-- trash_tenant: moves a tenant into the trash bin. Requires the caller to
-- type the tenant's exact current name, re-validated server-side (never
-- trust a client-side confirmation alone for something this destructive).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trash_tenant(
  p_tenant_id   UUID,
  p_confirm_name TEXT
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name TEXT;
BEGIN
  IF NOT public.app_is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT name INTO v_name FROM public.tenants WHERE id = p_tenant_id FOR UPDATE;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'التاجر غير موجود' USING ERRCODE = '42501';
  END IF;
  IF v_name IS DISTINCT FROM p_confirm_name THEN
    RAISE EXCEPTION 'الاسم المُدخل لا يطابق اسم التاجر' USING ERRCODE = '22023';
  END IF;

  UPDATE public.tenants
     SET trashed_at = now(), trashed_by = app_current_uid()
   WHERE id = p_tenant_id AND trashed_at IS NULL;
END $$;

REVOKE ALL ON FUNCTION public.trash_tenant(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trash_tenant(UUID, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- restore_tenant: pulls a tenant back out of the trash bin. No typed
-- confirmation required -- restoring is the safe, reversible direction.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.restore_tenant(p_tenant_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.app_is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.tenants
     SET trashed_at = NULL, trashed_by = NULL
   WHERE id = p_tenant_id;
END $$;

REVOKE ALL ON FUNCTION public.restore_tenant(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_tenant(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- permanently_delete_tenant: the real, irreversible DELETE. Only reachable
-- from the trash bin (tenant must already be trashed) and requires typing
-- the tenant's exact name again -- a second, independent confirmation from
-- the one that put it in the trash in the first place.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.permanently_delete_tenant(
  p_tenant_id    UUID,
  p_confirm_name TEXT
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name       TEXT;
  v_trashed_at TIMESTAMPTZ;
BEGIN
  IF NOT public.app_is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT name, trashed_at INTO v_name, v_trashed_at FROM public.tenants WHERE id = p_tenant_id;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'التاجر غير موجود' USING ERRCODE = '42501';
  END IF;
  IF v_trashed_at IS NULL THEN
    RAISE EXCEPTION 'يجب نقل التاجر لسلة المهملات أولاً قبل الحذف النهائي' USING ERRCODE = '22023';
  END IF;
  IF v_name IS DISTINCT FROM p_confirm_name THEN
    RAISE EXCEPTION 'الاسم المُدخل لا يطابق اسم التاجر' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.tenants WHERE id = p_tenant_id;
END $$;

REVOKE ALL ON FUNCTION public.permanently_delete_tenant(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.permanently_delete_tenant(UUID, TEXT) TO authenticated;
