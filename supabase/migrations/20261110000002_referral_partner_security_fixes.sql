-- =============================================================================
--  إصلاحات أمنية على 20261110000001_referral_partner_accounts.sql، وُجدت في
--  مراجعة كود مستقلة قبل الدفع للإنتاج:
--  1) لا كان هناك أي طريقة لإنشاء صف referral_partners أصلاً (RLS تمنع
--     الإدراج المباشر من العميل عمداً، ولا سياسة INSERT موجودة) -- التسجيل
--     كان معطَّلاً بالكامل. يضيف register_referral_partner RPC.
--  2) confirm_partner_referral كانت قابلة للاستدعاء مباشرة من أي عميل مصادَق
--     (لا REVOKE)، يسمح باحتساب مكافأة قبل أي اشتراك حقيقي -- نفس الثغرة التي
--     أُصلِحت لنظام إحالة التجار في 20260816_referral_program_authz_fixes.sql.
--  3) hardening إضافي: تعليق حسابات شركاء معلَّقين (status != 'active') فعلياً
--     من توليد الكود/تسجيل إحالات/طلب سحب، لا فقط ظاهرياً في الواجهة.
--  4) trg_confirm_referral أُعيد تعريفها في المايجريشن السابق من نسخة غير
--     SECURITY DEFINER (نسخة قديمة من 20260910050000) بدل النسخة الحيّة
--     المُحصَّنة (20260816_referral_program_authz_fixes.sql:69-70) -- تُستعاد
--     هنا، مع عزل استدعاء confirm_partner_referral بحيث لا يُسقِط أي خطأ فيها
--     تفعيل اشتراك التاجر نفسه.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.register_referral_partner(p_name text, p_email text, p_phone text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Forbidden: must be authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM referral_partners WHERE uid = auth.uid()) THEN
    RAISE EXCEPTION 'Referral partner account already exists for this user';
  END IF;
  -- status دوماً 'active' ولا referral_code عند الإنشاء (يُولَّد فقط عبر
  -- ensure_partner_referral_code) -- لا يُسمح للعميل باختيار أي منهما.
  INSERT INTO referral_partners(uid, name, email, phone, status)
    VALUES (auth.uid(), p_name, p_email, p_phone, 'active')
    RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.register_referral_partner(text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.ensure_partner_referral_code(p_partner uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE code text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM referral_partners WHERE id = p_partner AND uid = auth.uid() AND status = 'active') THEN
    RAISE EXCEPTION 'Forbidden: can only manage your own active referral partner account';
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
  -- شريك معلَّق (status != 'active') لا يُحسَب له إحالات جديدة عبر رابطه.
  SELECT id INTO v_partner FROM referral_partners WHERE referral_code = p_ref_code AND status = 'active';
  IF v_partner IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM referrals WHERE referred_tenant_id = p_referred_tenant) THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM partner_referrals WHERE referred_tenant_id = p_referred_tenant) THEN RETURN; END IF;
  INSERT INTO partner_referrals(partner_id, referred_tenant_id, reward_amount, status, qualified_until)
    VALUES (v_partner, p_referred_tenant, 300, 'pending', now() + interval '30 days');
END; $$;

CREATE OR REPLACE FUNCTION public.request_partner_withdrawal(p_partner uuid, p_amount numeric, p_iban text, p_beneficiary text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_balance numeric; v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM referral_partners WHERE id = p_partner AND uid = auth.uid() AND status = 'active') THEN
    RAISE EXCEPTION 'Forbidden: can only withdraw from your own active partner wallet';
  END IF;
  SELECT balance INTO v_balance FROM partner_wallets WHERE partner_id = p_partner FOR UPDATE;
  IF v_balance IS NULL OR v_balance <= 1000 THEN RAISE EXCEPTION 'الحد الأدنى للسحب أكثر من 1000 ر.س'; END IF;
  IF p_amount <= 1000 OR p_amount > v_balance THEN RAISE EXCEPTION 'مبلغ غير صالح'; END IF;
  UPDATE partner_wallets SET balance = balance - p_amount, updated_at = now() WHERE partner_id = p_partner;
  INSERT INTO partner_withdrawal_requests(partner_id, amount, iban, beneficiary, status)
    VALUES (p_partner, p_amount, p_iban, p_beneficiary, 'pending') RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

-- confirm_partner_referral: داخلية فقط (يفجّرها نفس مُشغِّل tenants الحالي بعد
-- اشتراك حقيقي) -- لا يجوز استدعاؤها مباشرة من عميل، نفس سبب تحصين
-- confirm_referral الأصلية (20260816_referral_program_authz_fixes.sql:63-68):
-- استدعاء مباشر يُحسِّب مكافأة قبل أي اشتراك/دفع فعلي.
REVOKE EXECUTE ON FUNCTION public.confirm_partner_referral(uuid) FROM PUBLIC, anon, authenticated;

-- يستعيد SECURITY DEFINER (كانت فُقدت في 20261110000001 بنسخ نص غير مُحصَّن
-- من 20260910050000 بدل النسخة الحيّة في 20260816)، ويعزل استدعاء
-- confirm_partner_referral بحيث لا يُسقِط أي خطأ فيها تفعيل اشتراك التاجر.
CREATE OR REPLACE FUNCTION public.trg_confirm_referral()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.subscription_status = 'active' AND COALESCE(OLD.subscription_status,'') <> 'active' THEN
    PERFORM confirm_referral(NEW.id);
    BEGIN
      PERFORM confirm_partner_referral(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'confirm_partner_referral failed for tenant %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END; $$;
