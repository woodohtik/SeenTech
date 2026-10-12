-- =============================================================================
--  برنامج الإحالة -- شاشة إعدادات إدارية (seen-fields-categories-referral-task.md #5)
--  ------------------------------------------------------------------------
--  قيمتا العمولة (300 ر.س) والحد الأدنى للسحب (1000 ر.س) كانتا ثابتتين
--  كـliterals مباشرة داخل record_referral/request_withdrawal، ولا يوجد
--  مفتاح تفعيل/تعطيل للبرنامج إطلاقاً. يعيد هذا الملف استخدام نمط
--  saas_settings الموجود فعلاً (نفس الجدول الذي يخزّن 'branding'/'platform'،
--  لا جدول جديد) بمفتاح جديد 'referral_program'.
--
--  التعطيل (enabled=false) يمنع فقط تسجيل إحالات جديدة (record_referral
--  تتجاهل الاستدعاء بصمت، بنفس أسلوبها الحالي مع p_ref_code الفارغ) -- لا
--  يُجمَّد سحب رصيد مكتسب فعلاً، تجنباً لمفاجأة تاجر برصيد مستحق بلا سبب.
-- =============================================================================

-- 1) توسيع قراءة saas_settings لتشمل المفتاح الجديد (قراءة عامة، مثل
--    'branding' تماماً -- مجرد "هل البرنامج مفعّل وبكم العمولة" وليس حساساً).
DROP POLICY IF EXISTS saas_settings_public_read ON public.saas_settings;
CREATE POLICY saas_settings_public_read ON public.saas_settings
  FOR SELECT TO authenticated
  USING (
    app_is_super_admin()
    OR key = 'branding'
    OR key = 'referral_program'
    OR (key = 'support_access_requests' AND app_current_role() IN ('owner', 'admin'))
  );

-- 2) قيمة افتراضية تحافظ على السلوك الحالي تماماً حتى يغيّرها سوبر أدمن.
INSERT INTO public.saas_settings (key, value)
VALUES ('referral_program', '{"enabled": true, "rewardPerReferral": 300, "minWithdrawal": 1000}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 3) record_referral -- تتوقف عن تسجيل إحالات جديدة عند التعطيل، وتقرأ
--    قيمة العمولة ديناميكياً بدل الـliteral 300 الثابت.
CREATE OR REPLACE FUNCTION public.record_referral(p_ref_code text, p_referred_tenant uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referrer uuid;
  v_settings jsonb;
  v_reward   numeric;
BEGIN
  IF p_referred_tenant IS DISTINCT FROM app_current_tenant_id() THEN
    RAISE EXCEPTION 'Forbidden: can only record a referral for your own tenant';
  END IF;
  IF p_ref_code IS NULL OR p_ref_code = '' THEN
    RETURN;
  END IF;

  SELECT value INTO v_settings FROM public.saas_settings WHERE key = 'referral_program';
  IF v_settings IS NOT NULL AND (v_settings->>'enabled') = 'false' THEN
    RETURN;
  END IF;
  v_reward := COALESCE((v_settings->>'rewardPerReferral')::numeric, 300);

  SELECT id INTO v_referrer FROM public.tenants WHERE referral_code = p_ref_code;
  IF v_referrer IS NULL OR v_referrer = p_referred_tenant THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.referrals WHERE referred_tenant_id = p_referred_tenant) THEN
    RETURN;
  END IF;

  INSERT INTO public.referrals (referrer_tenant_id, referred_tenant_id, reward_amount, status, qualified_until)
    VALUES (v_referrer, p_referred_tenant, v_reward, 'pending', now() + interval '30 days');
  UPDATE public.tenants SET referred_by = v_referrer WHERE id = p_referred_tenant;
END;
$$;

-- 4) request_withdrawal -- يقرأ الحد الأدنى ديناميكياً بدل الـliteral 1000
--    الثابت (المكرر مرتين) -- يبقى يعمل بغضّ النظر عن enabled (انظر الملاحظة
--    أعلاه: التعطيل لا يجمّد سحب رصيد مكتسب فعلاً).
CREATE OR REPLACE FUNCTION public.request_withdrawal(p_tenant uuid, p_amount numeric, p_iban text, p_beneficiary text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance  numeric;
  v_id       uuid;
  v_settings jsonb;
  v_min      numeric;
BEGIN
  IF p_tenant IS DISTINCT FROM app_current_tenant_id() THEN
    RAISE EXCEPTION 'Forbidden: can only withdraw from your own tenant''s wallet';
  END IF;

  SELECT value INTO v_settings FROM public.saas_settings WHERE key = 'referral_program';
  v_min := COALESCE((v_settings->>'minWithdrawal')::numeric, 1000);

  SELECT balance INTO v_balance FROM public.referral_wallets WHERE tenant_id = p_tenant FOR UPDATE;
  IF v_balance IS NULL OR v_balance <= v_min THEN
    RAISE EXCEPTION 'الحد الأدنى للسحب أكثر من % ر.س', v_min;
  END IF;
  IF p_amount <= v_min OR p_amount > v_balance THEN
    RAISE EXCEPTION 'مبلغ غير صالح';
  END IF;

  UPDATE public.referral_wallets SET balance = balance - p_amount, updated_at = now() WHERE tenant_id = p_tenant;
  INSERT INTO public.withdrawal_requests (tenant_id, amount, iban, beneficiary, status)
    VALUES (p_tenant, p_amount, p_iban, p_beneficiary, 'pending') RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
