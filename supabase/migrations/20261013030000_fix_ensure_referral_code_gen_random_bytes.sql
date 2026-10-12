-- =============================================================================
--  إصلاح: gen_random_bytes تعيش في مخطط extensions لا public -- اكتُشف
--  حياً مباشرة بعد إصلاح SECURITY DEFINER السابق (20261013020000): تقييد
--  search_path إلى public فقط (لأسباب أمنية -- منع هجمات search_path) كسر
--  استدعاء gen_random_bytes غير المؤهَّل بالمخطط. التأهيل الصريح
--  (extensions.gen_random_bytes) أدق من توسيع search_path نفسه.
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
    code := 'S' || upper(substr(encode(extensions.gen_random_bytes(4),'hex'),1,6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE referral_code = code);
  END LOOP;
  UPDATE tenants SET referral_code = code WHERE id = p_tenant;
  INSERT INTO referral_wallets(tenant_id) VALUES (p_tenant) ON CONFLICT DO NOTHING;
  RETURN code;
END;
$$;
