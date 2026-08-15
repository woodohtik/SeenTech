-- Security fixes for REFERRAL_program.sql — every one of these functions is
-- SECURITY DEFINER and reachable directly via supabase.rpc(...) from any
-- authenticated (and in some cases anon) client, but none of them verified
-- that the tenant/caller acting on a wallet or withdrawal was actually the
-- owner of that tenant, and process_withdrawal had no admin check at all.
-- Net effect before this fix: any authenticated user could drain another
-- tenant's referral wallet to an attacker-supplied IBAN and self-approve the
-- payout. Signatures are kept identical to avoid touching call sites in
-- src/services/referralService.ts — the checks are added inside the bodies.

-- record_referral: the referred tenant must be the caller's own tenant.
CREATE OR REPLACE FUNCTION record_referral(p_ref_code text, p_referred_tenant uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_referrer uuid;
BEGIN
  IF p_referred_tenant IS DISTINCT FROM app_current_tenant_id() THEN
    RAISE EXCEPTION 'Forbidden: can only record a referral for your own tenant';
  END IF;
  IF p_ref_code IS NULL OR p_ref_code = '' THEN RETURN; END IF;
  SELECT id INTO v_referrer FROM tenants WHERE referral_code = p_ref_code;
  IF v_referrer IS NULL OR v_referrer = p_referred_tenant THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM referrals WHERE referred_tenant_id = p_referred_tenant) THEN RETURN; END IF;
  INSERT INTO referrals(referrer_tenant_id, referred_tenant_id, reward_amount, status, qualified_until)
    VALUES (v_referrer, p_referred_tenant, 300, 'pending', now() + interval '30 days');
  UPDATE tenants SET referred_by = v_referrer WHERE id = p_referred_tenant;
END; $$;

-- request_withdrawal: p_tenant must be the caller's own tenant.
CREATE OR REPLACE FUNCTION request_withdrawal(p_tenant uuid, p_amount numeric, p_iban text, p_beneficiary text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_balance numeric; v_id uuid;
BEGIN
  IF p_tenant IS DISTINCT FROM app_current_tenant_id() THEN
    RAISE EXCEPTION 'Forbidden: can only withdraw from your own tenant''s wallet';
  END IF;
  SELECT balance INTO v_balance FROM referral_wallets WHERE tenant_id = p_tenant FOR UPDATE;
  IF v_balance IS NULL OR v_balance <= 1000 THEN RAISE EXCEPTION 'الحد الأدنى للسحب أكثر من 1000 ر.س'; END IF;
  IF p_amount <= 1000 OR p_amount > v_balance THEN RAISE EXCEPTION 'مبلغ غير صالح'; END IF;
  UPDATE referral_wallets SET balance = balance - p_amount, updated_at = now() WHERE tenant_id = p_tenant;
  INSERT INTO withdrawal_requests(tenant_id, amount, iban, beneficiary, status)
    VALUES (p_tenant, p_amount, p_iban, p_beneficiary, 'pending') RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

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

-- confirm_referral: internal only (fired by the tenants trigger after a real
-- subscription activation) — never callable directly by a client, since
-- calling it early/directly would credit a referral before any real
-- subscription/payment occurred. Make the trigger SECURITY DEFINER so it
-- keeps working (as the function owner) regardless of which role performs
-- the tenants.subscription_status UPDATE that fires it.
CREATE OR REPLACE FUNCTION trg_confirm_referral()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.subscription_status = 'active' AND COALESCE(OLD.subscription_status,'') <> 'active' THEN
    PERFORM confirm_referral(NEW.id);
  END IF;
  RETURN NEW;
END; $$;

REVOKE EXECUTE ON FUNCTION confirm_referral(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION record_referral(text, uuid) FROM anon;
