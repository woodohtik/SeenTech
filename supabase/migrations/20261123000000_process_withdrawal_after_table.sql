-- seen-cto-sprint4-design-quality-task.md item 4: process_withdrawal was
-- originally defined in 20260816_referral_program_authz_fixes.sql, almost
-- a month before withdrawal_requests existed (created in
-- 20260910050000_backfill_referral_program.sql). Its `r
-- withdrawal_requests%ROWTYPE` DECLARE is resolved eagerly at CREATE
-- FUNCTION time, so a fresh from-scratch migration replay (supabase test
-- db, confirmed failing in CI before this fix: "relation
-- withdrawal_requests does not exist") always failed on that earlier
-- migration, even though it had run fine against staging/production
-- (where the table already existed by the time that file was first
-- pushed, out of file-timestamp order). Moved here, after the table
-- actually exists -- identical body, so this is a no-op on any
-- environment that already has it (CREATE OR REPLACE).

-- process_withdrawal: super-admin only (this is SaaS-side approval, never a tenant action).
CREATE OR REPLACE FUNCTION process_withdrawal(p_request uuid, p_approve boolean, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r withdrawal_requests%ROWTYPE;
BEGIN
  IF NOT app_is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden: only a super admin may process withdrawals';
  END IF;
  SELECT * INTO r FROM withdrawal_requests WHERE id = p_request FOR UPDATE;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'الطلب مُعالَج مسبقاً'; END IF;
  IF p_approve THEN
    UPDATE withdrawal_requests SET status='paid', admin_note=p_note, processed_at=now() WHERE id=p_request;
  ELSE
    UPDATE withdrawal_requests SET status='rejected', admin_note=p_note, processed_at=now() WHERE id=p_request;
    UPDATE referral_wallets SET balance = balance + r.amount, updated_at=now() WHERE tenant_id = r.tenant_id;
  END IF;
END; $$;
