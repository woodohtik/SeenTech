-- =============================================================================
--  إصلاح: ensure_partner_referral_code كانت تستدعي gen_random_bytes(4) (من
--  امتداد pgcrypto)، وهو غير متوفر على قاعدة بيانات staging (التأكد عبر خطأ
--  حقيقي أثناء الاختبار المباشر: "function gen_random_bytes(integer) does not
--  exist") -- يمنع توليد كود الإحالة بالكامل، فيبقى حقل الرابط فارغاً دوماً.
--  الإصلاح: استبدال المصدر العشوائي بـgen_random_uuid() المدمج في Postgres
--  نفسه (core builtin منذ PG13، مُستخدَم فعلاً كقيمة افتراضية لعمود id في كل
--  جدول في هذا المشروع) بدل الاعتماد على امتداد قد لا يكون مُفعَّلاً.
-- =============================================================================

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
    code := 'P' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM referral_partners WHERE referral_code = code);
  END LOOP;
  UPDATE referral_partners SET referral_code = code WHERE id = p_partner;
  INSERT INTO partner_wallets(partner_id) VALUES (p_partner) ON CONFLICT DO NOTHING;
  RETURN code;
END; $$;
