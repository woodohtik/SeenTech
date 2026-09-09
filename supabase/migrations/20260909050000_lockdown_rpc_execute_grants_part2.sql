-- تكملة 20260909040000 -- أضيفت لهذا الملف الجديد لأن التعديل اللاحق على
-- الملف السابق بعد تطبيقه فعلياً لم يُعَد تنفيذه (supabase db push يتتبّع
-- بالاسم/الطابع الزمني، لا بالمحتوى).
REVOKE EXECUTE ON FUNCTION public.increment_supplier_balance(uuid, numeric) FROM anon;
REVOKE EXECUTE ON FUNCTION public.approve_subscription_request(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reject_subscription_request(uuid, text) FROM anon;
