-- =============================================================================
--  إعدادات "مساعد سين الذكي" (Smart Assistant) — عامة على مستوى المنصة
--  ------------------------------------------------------------------------
--  صف واحد فقط (إعدادات عامة، ليست لكل Tenant): تفعيل/تعطيل المساعد كليًا،
--  اختيار مزوّد الذكاء الاصطناعي والنموذج، مفتاح API مشفّر، القالب النصي،
--  وحد الرسائل اليومي. تُدار حصراً من لوحة السوبر أدمن عبر مسارات
--  /api/super-admin/assistant-settings في server.ts باستخدام supabaseAdmin
--  (مفتاح service_role يتجاوز RLS) — لا وصول مباشر من المتصفح أو من أي
--  Tenant، لذا عمداً بلا أي سياسة RLS ممنوحة لـ anon/authenticated.
--
--  assistant_usage_daily: عدّاد الرسائل اليومي لكل Tenant، مخزّن في Postgres
--  بدل الذاكرة لأن Vercel Functions توزَّع على نسخ متعددة لا ذاكرة مشتركة
--  بينها (نفس السبب الموثّق في 20260824000000_print_relay_persistent_store.sql).
-- =============================================================================

CREATE TABLE IF NOT EXISTS assistant_settings (
  id                  text PRIMARY KEY DEFAULT 'global',
  is_enabled          boolean NOT NULL DEFAULT true,
  ai_provider         text NOT NULL DEFAULT 'openai',
  model_name          text NOT NULL DEFAULT 'gpt-4o-mini',
  api_key_encrypted   text,
  system_prompt       text NOT NULL DEFAULT 'أنت مساعد سين الذكي، نظام نقاط بيع لمحلات الخياطة. مهمتك مساعدة صاحب المحل أو الكاشير بأسلوب ودود ومهني، الإجابة باختصار، وتوجيههم لكيفية إنشاء فواتير أو جرد المخزون.',
  temperature         real NOT NULL DEFAULT 0.7,
  max_tokens          integer NOT NULL DEFAULT 500,
  daily_message_limit integer NOT NULL DEFAULT 200,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          text
);

-- صف الإعدادات الوحيد (id='global') — يُنشأ بالقيم الافتراضية إن لم يكن موجوداً
-- بعد، حتى يعمل GET /api/super-admin/assistant-settings من أول استدعاء.
INSERT INTO assistant_settings (id) VALUES ('global') ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS assistant_usage_daily (
  tenant_id      text NOT NULL,
  usage_date     date NOT NULL DEFAULT current_date,
  message_count  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, usage_date)
);

-- زيادة ذرّية لعدّاد اليوم الحالي لمستأجر معيّن، وإرجاع القيمة الجديدة —
-- تتجنب حالة السباق (race condition) بين طلبين متزامنين لنفس المستأجر.
CREATE OR REPLACE FUNCTION increment_assistant_usage(p_tenant_id text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_count integer;
BEGIN
  INSERT INTO assistant_usage_daily (tenant_id, usage_date, message_count)
  VALUES (p_tenant_id, current_date, 1)
  ON CONFLICT (tenant_id, usage_date)
  DO UPDATE SET message_count = assistant_usage_daily.message_count + 1
  RETURNING message_count INTO new_count;

  RETURN new_count;
END;
$function$;

ALTER TABLE assistant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_usage_daily ENABLE ROW LEVEL SECURITY;
-- عمداً بلا أي سياسة: الوصول حصراً عبر مفتاح service_role من السيرفر
-- (supabaseAdmin في src/server/supabase-admin.ts)، الذي يتجاوز RLS أصلاً.
