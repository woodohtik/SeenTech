-- =============================================================================
--  إصلاح: ensure_referral_code كانت بلا SECURITY DEFINER -- تُكتشف أثناء
--  اختبار شاشة إعدادات برنامج الإحالة (20261013010000) حياً على staging.
--  ------------------------------------------------------------------------
--  record_referral/request_withdrawal/process_withdrawal الثلاثة SECURITY
--  DEFINER، لكن ensure_referral_code وحدها لم تكن كذلك -- فتُنفَّذ UPDATE
--  tenants وINSERT referral_wallets بصلاحيات المستخدم المستدعي نفسه. لا
--  توجد سياسة INSERT على referral_wallets للمستخدم العادي إطلاقاً (فقط
--  SELECT، كل الكتابة تمر عبر RPCs بـSECURITY DEFINER) -- فيفشل أي تاجر
--  يطلب رمز إحالة لأول مرة بخطأ 403 (تأكَّد حياً: طلب الصفحة لتاجر بلا
--  referral_code بعد كان يُرجِع 403 Forbidden من rpc/ensure_referral_code).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.ensure_referral_code(p_tenant uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE code text;
BEGIN
  IF p_tenant IS DISTINCT FROM app_current_tenant_id() AND NOT app_is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden: can only ensure a referral code for your own tenant';
  END IF;

  SELECT referral_code INTO code FROM tenants WHERE id = p_tenant;
  IF code IS NOT NULL THEN RETURN code; END IF;
  LOOP
    code := 'S' || upper(substr(encode(gen_random_bytes(4),'hex'),1,6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE referral_code = code);
  END LOOP;
  UPDATE tenants SET referral_code = code WHERE id = p_tenant;
  INSERT INTO referral_wallets(tenant_id) VALUES (p_tenant) ON CONFLICT DO NOTHING;
  RETURN code;
END;
$$;
