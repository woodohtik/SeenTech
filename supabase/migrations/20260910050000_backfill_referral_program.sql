-- =============================================================================
--  إعادة توثيق REFERRAL_program.sql ضمن سجل الـmigrations الفعلي
--  (seen-master-backlog-and-structure.md، خطوة 3)
--  ------------------------------------------------------------------------
--  تحذير اكتُشِف أثناء هذا التوثيق: النسخة الحيّة الفعلية لثلاث دوال هنا
--  (record_referral، request_withdrawal، process_withdrawal) مختلفة عن نص
--  REFERRAL_program.sql الأصلي في الجذر — شخص ما عدّلها مباشرة على القاعدة
--  فيما بعد ليضيف تحققاً حقيقياً من الملكية/الصلاحية (كان الملف الأصلي
--  بلا أي تحقق app_current_tenant_id()/app_is_super_admin() في الثلاثة!)،
--  بلا أي migration أو تحديث لهذا الملف يوثّق ذلك. النسخة أدناه هي النسخة
--  الحيّة المُحصَّنة فعلياً (تحقّقت منها مباشرة عبر pg_get_functiondef هذه
--  الجلسة)، لا نص الملف القديم -- نسخ الملف القديم حرفياً كان سيُراجِع
--  (regress) هذا التحصين.
-- =============================================================================

ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS referral_code text UNIQUE;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS referred_by uuid REFERENCES public.tenants(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.referral_wallets (
  tenant_id    uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  balance      numeric(12,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  total_earned numeric(12,2) NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.referrals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  referred_tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  reward_amount      numeric(12,2) NOT NULL DEFAULT 300,
  status             text NOT NULL DEFAULT 'pending',
  qualified_until    timestamptz NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  credited_at        timestamptz,
  UNIQUE (referred_tenant_id)
);

CREATE TABLE IF NOT EXISTS public.withdrawal_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  amount       numeric(12,2) NOT NULL CHECK (amount > 0),
  iban         text,
  beneficiary  text,
  status       text NOT NULL DEFAULT 'pending',
  admin_note   text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE OR REPLACE FUNCTION public.ensure_referral_code(p_tenant uuid)
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

-- النسخة الحيّة (وليست نسخة الملف الأصلي) -- تتحقق أن الفاعل لا يسجّل إحالة
-- إلا لمستأجره هو نفسه.
CREATE OR REPLACE FUNCTION public.record_referral(p_ref_code text, p_referred_tenant uuid)
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

CREATE OR REPLACE FUNCTION public.confirm_referral(p_referred_tenant uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r referrals%ROWTYPE;
BEGIN
  SELECT * INTO r FROM referrals WHERE referred_tenant_id = p_referred_tenant AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF now() <= r.qualified_until THEN
    UPDATE referrals SET status='credited', credited_at=now() WHERE id = r.id;
    INSERT INTO referral_wallets(tenant_id, balance, total_earned, updated_at)
      VALUES (r.referrer_tenant_id, r.reward_amount, r.reward_amount, now())
      ON CONFLICT (tenant_id) DO UPDATE
        SET balance = referral_wallets.balance + r.reward_amount,
            total_earned = referral_wallets.total_earned + r.reward_amount, updated_at = now();
  ELSE
    UPDATE referrals SET status='expired' WHERE id = r.id;
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.trg_confirm_referral()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.subscription_status = 'active' AND COALESCE(OLD.subscription_status,'') <> 'active' THEN
    PERFORM confirm_referral(NEW.id);
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS tenants_confirm_referral ON public.tenants;
CREATE TRIGGER tenants_confirm_referral AFTER UPDATE OF subscription_status ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.trg_confirm_referral();

-- النسخة الحيّة -- تتحقق أن الفاعل يسحب من محفظة مستأجره هو نفسه فقط.
CREATE OR REPLACE FUNCTION public.request_withdrawal(p_tenant uuid, p_amount numeric, p_iban text, p_beneficiary text)
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

-- النسخة الحيّة -- تتحقق أن الفاعل super_admin فعلياً قبل معالجة أي طلب سحب.
CREATE OR REPLACE FUNCTION public.process_withdrawal(p_request uuid, p_approve boolean, p_note text)
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

ALTER TABLE public.referral_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wallet_own ON public.referral_wallets;
CREATE POLICY wallet_own ON public.referral_wallets FOR SELECT TO authenticated
  USING (tenant_id = app_current_tenant_id() OR app_is_super_admin());
DROP POLICY IF EXISTS ref_own ON public.referrals;
CREATE POLICY ref_own ON public.referrals FOR SELECT TO authenticated
  USING (referrer_tenant_id = app_current_tenant_id() OR app_is_super_admin());
DROP POLICY IF EXISTS wr_own ON public.withdrawal_requests;
CREATE POLICY wr_own ON public.withdrawal_requests FOR SELECT TO authenticated
  USING (tenant_id = app_current_tenant_id() OR app_is_super_admin());

GRANT EXECUTE ON FUNCTION public.ensure_referral_code(uuid) TO authenticated;
-- record_referral: authenticated فقط (النسخة الحيّة الفعلية لا تمنح anon،
-- بعكس الملف الأصلي -- انظر التحذير أعلى الملف).
GRANT EXECUTE ON FUNCTION public.record_referral(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(uuid, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_withdrawal(uuid, boolean, text) TO authenticated;
