-- Stage 2 (Firebase Auth -> Supabase Auth) data migration helper.
--
-- Re-points every TEXT-uid column that references a user (Firebase uid
-- string, historically) to the equivalent Supabase Auth user id, for one
-- user at a time, as a single atomic operation (a Postgres function body is
-- one implicit transaction).
--
-- users.id is the only genuine PRIMARY KEY among these columns, with real
-- FOREIGN KEY dependents (saas_users.uid ON DELETE CASCADE; tenants.owner_uid,
-- tailor_requests.uid/approved_by, user_permission_overrides.updated_by,
-- order_history.updated_by_uid, audit_logs.performed_by, security_logs.uid,
-- saas_settings.updated_by all ON DELETE SET NULL). Swapping a referenced PK
-- value directly isn't safe with NOT DEFERRABLE constraints (the default), so
-- this instead: (1) inserts a parallel `users` row under the new id,
-- (2) repoints every referencing column to the new id, then (3) deletes the
-- old `users` row -- by which point nothing references it anymore, so no
-- CASCADE/SET NULL trigger fires and no data is lost.
--
-- staff.uid, buyers.uid, supplier_accounts.uid have no FK constraint at all
-- (buyers/supplier_accounts come from the optional marketplace extension,
-- hence the to_regclass guards), so they're just plain UPDATEs.
--
-- Safe to call multiple times for the same user: a no-op once p_old_uid no
-- longer exists in `users` (i.e. already migrated).
CREATE OR REPLACE FUNCTION remap_user_uid(p_old_uid TEXT, p_new_uid TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_row users%ROWTYPE;
BEGIN
  SELECT * INTO old_row FROM users WHERE id = p_old_uid;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF p_old_uid = p_new_uid THEN
    RETURN;
  END IF;

  -- 1. Parallel `users` row under the new id (so every FK below has
  -- something valid to point at before the old row is touched).
  -- users.email is UNIQUE, so the old row (not deleted until step 3) would
  -- collide with its own email on the new row otherwise -- park it under a
  -- throwaway value first; the old row is gone by the end of this txn.
  UPDATE users SET email = p_old_uid || '+remapped@invalid.local' WHERE id = p_old_uid;

  INSERT INTO users (id, email, display_name, phone, photo_url, email_verified, disabled, last_sign_in_at, created_at, updated_at)
  VALUES (p_new_uid, old_row.email, old_row.display_name, old_row.phone, old_row.photo_url, old_row.email_verified, old_row.disabled, old_row.last_sign_in_at, old_row.created_at, old_row.updated_at)
  ON CONFLICT (id) DO NOTHING;

  -- 2. Repoint every referencing/soft-reference column.
  UPDATE tenants SET owner_uid = p_new_uid WHERE owner_uid = p_old_uid;
  UPDATE saas_users SET uid = p_new_uid WHERE uid = p_old_uid;
  UPDATE saas_settings SET updated_by = p_new_uid WHERE updated_by = p_old_uid;
  UPDATE saas_security_logs SET user_id = p_new_uid WHERE user_id = p_old_uid;
  UPDATE tailor_requests SET uid = p_new_uid WHERE uid = p_old_uid;
  UPDATE tailor_requests SET approved_by = p_new_uid WHERE approved_by = p_old_uid;
  UPDATE staff SET uid = p_new_uid WHERE uid = p_old_uid;
  UPDATE user_permission_overrides SET updated_by = p_new_uid WHERE updated_by = p_old_uid;
  UPDATE order_history SET updated_by_uid = p_new_uid WHERE updated_by_uid = p_old_uid;
  UPDATE audit_logs SET performed_by = p_new_uid WHERE performed_by = p_old_uid;
  UPDATE security_logs SET uid = p_new_uid WHERE uid = p_old_uid;

  IF to_regclass('public.buyers') IS NOT NULL THEN
    EXECUTE 'UPDATE buyers SET uid = $1 WHERE uid = $2' USING p_new_uid, p_old_uid;
  END IF;
  IF to_regclass('public.supplier_accounts') IS NOT NULL THEN
    EXECUTE 'UPDATE supplier_accounts SET uid = $1 WHERE uid = $2' USING p_new_uid, p_old_uid;
  END IF;

  -- 3. Now safe to remove the old row -- nothing references it anymore.
  DELETE FROM users WHERE id = p_old_uid;
END;
$$;

-- Only the service-role (migration script) may call this -- never expose to
-- anon/authenticated clients, since it lets the caller reassign any user's
-- identity across every tenant-scoped table.
REVOKE ALL ON FUNCTION remap_user_uid(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION remap_user_uid(TEXT, TEXT) TO service_role;
