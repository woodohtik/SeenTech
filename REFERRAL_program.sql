-- =============================================================================
--  سين — برنامج الإحالة (Referral Program)
--  رابط إحالة لكل عميل · 300 ر.س عند اشتراك المُحال (لا مجرد تسجيله)
--  شرط الأهلية: يشترك المُحال خلال 30 يوماً من تسجيله (≈ 14 تجربة + 14 بعدها). بعدها = لا عمولة.
--  السحب عند الرصيد فوق 1000 ر.س → مراجعة يدوية في داشبورد سين + تحويل خلال 3–5 أيام عمل.
-- =============================================================================

-- 1) كود الإحالة على الـ tenant -------------------------------------------------
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS referral_code text UNIQUE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS referred_by uuid REFERENCES tenants(id) ON DELETE SET NULL;

-- 2) المحفظة ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS referral_wallets (
  tenant_id    uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  balance      numeric(12,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  total_earned numeric(12,2) NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- 3) سجل الإحالات (pending حتى يشترك المُحال) -------------------------------------
CREATE TABLE IF NOT EXISTS referrals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  referred_tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reward_amount      numeric(12,2) NOT NULL DEFAULT 300,
  status             text NOT NULL DEFAULT 'pending',   -- pending | credited | expired | rejected
  qualified_until    timestamptz NOT NULL,              -- آخر موعد لاشتراك المُحال (تسجيله + 30 يوم)
  created_at         timestamptz NOT NULL DEFAULT now(),
  credited_at        timestamptz,
  UNIQUE (referred_tenant_id)   -- كل محل يُحال مرة واحدة فقط
);

-- 4) طلبات السحب ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  amount       numeric(12,2) NOT NULL CHECK (amount > 0),
  iban         text,
  beneficiary  text,
  status       text NOT NULL DEFAULT 'pending',  -- pending | approved | paid | rejected
  admin_note   text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

-- 5) توليد كود إحالة فريد ---------------------------------------------------------
CREATE OR REPLACE FUNCTION ensure_referral_code(p_tenant uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE code text;
BEGIN
  SELECT referral_code INTO code FROM tenants WHERE id = p_tenant;
  IF code IS NOT NULL THEN RETURN code; END IF;
  LOOP
    code := 'S' || upper(substr(encode(gen_random_bytes(4),'hex'),1,6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE referral_code = code);
  END LOOP;
  UPDATE tenants SET referral_code = code WHERE id = p_tenant;
  INSERT INTO referral_wallets(tenant_id) VALUES (p_tenant) ON CONFLICT DO NOTHING;
  RETURN code;
END; $$;

-- 6) تسجيل إحالة «معلّقة» عند تسجيل محل جديد عبر رابط (بلا مكافأة بعد) -------------
CREATE OR REPLACE FUNCTION record_referral(p_ref_code text, p_referred_tenant uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_referrer uuid;
BEGIN
  IF p_ref_code IS NULL OR p_ref_code = '' THEN RETURN; END IF;
  SELECT id INTO v_referrer FROM tenants WHERE referral_code = p_ref_code;
  IF v_referrer IS NULL OR v_referrer = p_referred_tenant THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM referrals WHERE referred_tenant_id = p_referred_tenant) THEN RETURN; END IF;
  INSERT INTO referrals(referrer_tenant_id, referred_tenant_id, reward_amount, status, qualified_until)
    VALUES (v_referrer, p_referred_tenant, 300, 'pending', now() + interval '30 days');
  UPDATE tenants SET referred_by = v_referrer WHERE id = p_referred_tenant;
END; $$;

-- 7) احتساب المكافأة عند اشتراك المُحال (إن كان ضمن المهلة) -----------------------
CREATE OR REPLACE FUNCTION confirm_referral(p_referred_tenant uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r referrals%ROWTYPE;
BEGIN
  SELECT * INTO r FROM referrals WHERE referred_tenant_id = p_referred_tenant AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF now() <= r.qualified_until THEN
    -- ضمن الشهر → امنح المكافأة
    UPDATE referrals SET status='credited', credited_at=now() WHERE id = r.id;
    INSERT INTO referral_wallets(tenant_id, balance, total_earned, updated_at)
      VALUES (r.referrer_tenant_id, r.reward_amount, r.reward_amount, now())
      ON CONFLICT (tenant_id) DO UPDATE
        SET balance = referral_wallets.balance + r.reward_amount,
            total_earned = referral_wallets.total_earned + r.reward_amount, updated_at = now();
  ELSE
    -- اشترك بعد أكثر من شهر → لا عمولة
    UPDATE referrals SET status='expired' WHERE id = r.id;
  END IF;
END; $$;

-- 8) Trigger: عند تحوّل المحل إلى «مشترك» يُحتسب الإحالة تلقائياً -----------------
CREATE OR REPLACE FUNCTION trg_confirm_referral()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.subscription_status = 'active' AND COALESCE(OLD.subscription_status,'') <> 'active' THEN
    PERFORM confirm_referral(NEW.id);
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS tenants_confirm_referral ON tenants;
CREATE TRIGGER tenants_confirm_referral AFTER UPDATE OF subscription_status ON tenants
  FOR EACH ROW EXECUTE FUNCTION trg_confirm_referral();
-- ملاحظة: يعتمد على عمود subscription_status (من PLG_trial_lifecycle.sql). إن لم تستخدموه،
-- نادِ confirm_referral(tenant_id) يدوياً من تدفّق تفعيل الاشتراك (activate_tenant_subscription).

-- 9) طلب سحب (يتحقق ≥1500 ويحجز المبلغ) -------------------------------------------
CREATE OR REPLACE FUNCTION request_withdrawal(p_tenant uuid, p_amount numeric, p_iban text, p_beneficiary text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_balance numeric; v_id uuid;
BEGIN
  SELECT balance INTO v_balance FROM referral_wallets WHERE tenant_id = p_tenant FOR UPDATE;
  IF v_balance IS NULL OR v_balance <= 1000 THEN RAISE EXCEPTION 'الحد الأدنى للسحب أكثر من 1000 ر.س'; END IF;
  IF p_amount <= 1000 OR p_amount > v_balance THEN RAISE EXCEPTION 'مبلغ غير صالح'; END IF;
  UPDATE referral_wallets SET balance = balance - p_amount, updated_at = now() WHERE tenant_id = p_tenant;
  INSERT INTO withdrawal_requests(tenant_id, amount, iban, beneficiary, status)
    VALUES (p_tenant, p_amount, p_iban, p_beneficiary, 'pending') RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

-- 10) معالجة السحب من داشبورد الإدارة --------------------------------------------
CREATE OR REPLACE FUNCTION process_withdrawal(p_request uuid, p_approve boolean, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r withdrawal_requests%ROWTYPE;
BEGIN
  SELECT * INTO r FROM withdrawal_requests WHERE id = p_request FOR UPDATE;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'الطلب مُعالَج مسبقاً'; END IF;
  IF p_approve THEN
    UPDATE withdrawal_requests SET status='paid', admin_note=p_note, processed_at=now() WHERE id=p_request;
  ELSE
    UPDATE withdrawal_requests SET status='rejected', admin_note=p_note, processed_at=now() WHERE id=p_request;
    UPDATE referral_wallets SET balance = balance + r.amount, updated_at=now() WHERE tenant_id = r.tenant_id;
  END IF;
END; $$;

-- 11) RLS ------------------------------------------------------------------------
ALTER TABLE referral_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE withdrawal_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wallet_own ON referral_wallets;
CREATE POLICY wallet_own ON referral_wallets FOR SELECT TO authenticated
  USING (tenant_id = app_current_tenant_id() OR app_is_super_admin());
DROP POLICY IF EXISTS ref_own ON referrals;
CREATE POLICY ref_own ON referrals FOR SELECT TO authenticated
  USING (referrer_tenant_id = app_current_tenant_id() OR app_is_super_admin());
DROP POLICY IF EXISTS wr_own ON withdrawal_requests;
CREATE POLICY wr_own ON withdrawal_requests FOR SELECT TO authenticated
  USING (tenant_id = app_current_tenant_id() OR app_is_super_admin());
GRANT EXECUTE ON FUNCTION ensure_referral_code(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION record_referral(text, uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION request_withdrawal(uuid, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION process_withdrawal(uuid, boolean, text) TO authenticated;
