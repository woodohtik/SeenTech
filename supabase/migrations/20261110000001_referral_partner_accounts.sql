-- =============================================================================
--  حسابات شركاء الإحالة (Referral Partners) -- مجموعة موازية تماماً لبرنامج
--  إحالة التجار القائم (referrals/referral_wallets/withdrawal_requests)، بلا
--  أي تعديل عليه. انظر docs/superpowers/specs/2026-11-10-referral-partner-accounts-design.md
-- =============================================================================

CREATE TABLE public.referral_partners (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uid           uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  name          text NOT NULL,
  email         text UNIQUE,
  phone         text UNIQUE,
  referral_code text UNIQUE,
  status        text NOT NULL DEFAULT 'active',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.partner_wallets (
  partner_id   uuid PRIMARY KEY REFERENCES public.referral_partners(id) ON DELETE CASCADE,
  balance      numeric(12,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  total_earned numeric(12,2) NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.partner_referrals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id         uuid NOT NULL REFERENCES public.referral_partners(id) ON DELETE CASCADE,
  referred_tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  reward_amount      numeric(12,2) NOT NULL DEFAULT 300,
  status             text NOT NULL DEFAULT 'pending',
  qualified_until    timestamptz NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  credited_at        timestamptz,
  UNIQUE (referred_tenant_id)
);

CREATE TABLE public.partner_withdrawal_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id   uuid NOT NULL REFERENCES public.referral_partners(id) ON DELETE CASCADE,
  amount       numeric(12,2) NOT NULL CHECK (amount > 0),
  iban         text,
  beneficiary  text,
  status       text NOT NULL DEFAULT 'pending',
  admin_note   text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

-- بادئة الكود 'P' (بدل 'S' المستخدَمة لأكواد التجار) تضمن عدم تطابق كود شريك
-- مع كود تاجر إطلاقاً -- فضاءا الأكواد منفصلان بنيوياً، لا حاجة لقيد فريد
-- مشترك بين الجدولين.
CREATE OR REPLACE FUNCTION public.ensure_partner_referral_code(p_partner uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE code text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM referral_partners WHERE id = p_partner AND uid = auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden: can only manage your own referral partner account';
  END IF;
  SELECT referral_code INTO code FROM referral_partners WHERE id = p_partner;
  IF code IS NOT NULL THEN RETURN code; END IF;
  LOOP
    code := 'P' || upper(substr(encode(gen_random_bytes(4),'hex'),1,6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM referral_partners WHERE referral_code = code);
  END LOOP;
  UPDATE referral_partners SET referral_code = code WHERE id = p_partner;
  INSERT INTO partner_wallets(partner_id) VALUES (p_partner) ON CONFLICT DO NOTHING;
  RETURN code;
END; $$;

CREATE OR REPLACE FUNCTION public.record_partner_referral(p_ref_code text, p_referred_tenant uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_partner uuid;
BEGIN
  IF p_referred_tenant IS DISTINCT FROM app_current_tenant_id() THEN
    RAISE EXCEPTION 'Forbidden: can only record a referral for your own tenant';
  END IF;
  IF p_ref_code IS NULL OR p_ref_code = '' THEN RETURN; END IF;
  SELECT id INTO v_partner FROM referral_partners WHERE referral_code = p_ref_code;
  IF v_partner IS NULL THEN RETURN; END IF;
  -- تاجر مُحال فعلاً عبر نظام إحالة التجار الأصلي لا يُحتسَب مجدداً هنا.
  IF EXISTS (SELECT 1 FROM referrals WHERE referred_tenant_id = p_referred_tenant) THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM partner_referrals WHERE referred_tenant_id = p_referred_tenant) THEN RETURN; END IF;
  INSERT INTO partner_referrals(partner_id, referred_tenant_id, reward_amount, status, qualified_until)
    VALUES (v_partner, p_referred_tenant, 300, 'pending', now() + interval '30 days');
END; $$;

CREATE OR REPLACE FUNCTION public.confirm_partner_referral(p_referred_tenant uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r partner_referrals%ROWTYPE;
BEGIN
  SELECT * INTO r FROM partner_referrals WHERE referred_tenant_id = p_referred_tenant AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF now() <= r.qualified_until THEN
    UPDATE partner_referrals SET status='credited', credited_at=now() WHERE id = r.id;
    INSERT INTO partner_wallets(partner_id, balance, total_earned, updated_at)
      VALUES (r.partner_id, r.reward_amount, r.reward_amount, now())
      ON CONFLICT (partner_id) DO UPDATE
        SET balance = partner_wallets.balance + r.reward_amount,
            total_earned = partner_wallets.total_earned + r.reward_amount, updated_at = now();
  ELSE
    UPDATE partner_referrals SET status='expired' WHERE id = r.id;
  END IF;
END; $$;

-- يُضاف لجسم المُشغِّل الموجود فعلاً على tenants.subscription_status (لا
-- مُشغِّل جديد) -- كل دالة تفحص جدولها فقط فتُرجِع بصمت إن لم تجد صفاً.
CREATE OR REPLACE FUNCTION public.trg_confirm_referral()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.subscription_status = 'active' AND COALESCE(OLD.subscription_status,'') <> 'active' THEN
    PERFORM confirm_referral(NEW.id);
    PERFORM confirm_partner_referral(NEW.id);
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.request_partner_withdrawal(p_partner uuid, p_amount numeric, p_iban text, p_beneficiary text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_balance numeric; v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM referral_partners WHERE id = p_partner AND uid = auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden: can only withdraw from your own partner wallet';
  END IF;
  SELECT balance INTO v_balance FROM partner_wallets WHERE partner_id = p_partner FOR UPDATE;
  IF v_balance IS NULL OR v_balance <= 1000 THEN RAISE EXCEPTION 'الحد الأدنى للسحب أكثر من 1000 ر.س'; END IF;
  IF p_amount <= 1000 OR p_amount > v_balance THEN RAISE EXCEPTION 'مبلغ غير صالح'; END IF;
  UPDATE partner_wallets SET balance = balance - p_amount, updated_at = now() WHERE partner_id = p_partner;
  INSERT INTO partner_withdrawal_requests(partner_id, amount, iban, beneficiary, status)
    VALUES (p_partner, p_amount, p_iban, p_beneficiary, 'pending') RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.process_partner_withdrawal(p_request uuid, p_approve boolean, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r partner_withdrawal_requests%ROWTYPE;
BEGIN
  IF NOT app_is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden: only a super admin may process withdrawals';
  END IF;
  SELECT * INTO r FROM partner_withdrawal_requests WHERE id = p_request FOR UPDATE;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'الطلب مُعالَج مسبقاً'; END IF;
  IF p_approve THEN
    UPDATE partner_withdrawal_requests SET status='paid', admin_note=p_note, processed_at=now() WHERE id=p_request;
  ELSE
    UPDATE partner_withdrawal_requests SET status='rejected', admin_note=p_note, processed_at=now() WHERE id=p_request;
    UPDATE partner_wallets SET balance = balance + r.amount, updated_at=now() WHERE partner_id = r.partner_id;
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.list_pending_partner_withdrawals()
RETURNS SETOF partner_withdrawal_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT app_is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden: only a super admin may list pending withdrawals';
  END IF;
  RETURN QUERY SELECT * FROM partner_withdrawal_requests WHERE status='pending' ORDER BY requested_at ASC;
END; $$;

ALTER TABLE public.referral_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_withdrawal_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS partner_own ON public.referral_partners;
CREATE POLICY partner_own ON public.referral_partners FOR SELECT TO authenticated
  USING (uid = auth.uid() OR app_is_super_admin());

DROP POLICY IF EXISTS partner_wallet_own ON public.partner_wallets;
CREATE POLICY partner_wallet_own ON public.partner_wallets FOR SELECT TO authenticated
  USING (partner_id IN (SELECT id FROM referral_partners WHERE uid = auth.uid()) OR app_is_super_admin());

DROP POLICY IF EXISTS partner_ref_own ON public.partner_referrals;
CREATE POLICY partner_ref_own ON public.partner_referrals FOR SELECT TO authenticated
  USING (partner_id IN (SELECT id FROM referral_partners WHERE uid = auth.uid()) OR app_is_super_admin());

DROP POLICY IF EXISTS partner_wr_own ON public.partner_withdrawal_requests;
CREATE POLICY partner_wr_own ON public.partner_withdrawal_requests FOR SELECT TO authenticated
  USING (partner_id IN (SELECT id FROM referral_partners WHERE uid = auth.uid()) OR app_is_super_admin());

GRANT EXECUTE ON FUNCTION public.ensure_partner_referral_code(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_partner_referral(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_partner_withdrawal(uuid, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_partner_withdrawal(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_pending_partner_withdrawals() TO authenticated;
