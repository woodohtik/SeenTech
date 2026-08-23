-- =============================================================================
--  متجر دائم لوسيط الطباعة السحابي (print-relay)
--  ------------------------------------------------------------------------
--  كان src/server/printRelay.ts يخزّن المحطات والمهام في Map داخل ذاكرة
--  العملية — يعمل على سيرفر Express واحد طويل العمر لكنه ينهار على Vercel
--  Functions (تُوزَّع الطلبات على نسخ متعددة لا ذاكرة مشتركة بينها):
--  تسجيل الوسيط قد يصل نسخة، ومحاولة الاقتران من المتصفح تصل نسخة أخرى لا
--  تعرف رمز الاقتران إطلاقاً ⇒ «رمز اقتران غير صحيح» رغم صحة الرمز.
--  ثُبت هذا فعلياً: 8 محطات مسجَّلة بالتوازي، 7 من 8 محاولات اقتران فشلت.
--
--  هذه الهجرة تنقل الحالة إلى Supabase (مشتركة بين كل نسخ الدالة).
--  الوصول حصراً عبر عميل السيرفر بمفتاح service_role (supabaseAdmin) —
--  لا سياسات RLS ممنوحة لـ anon/authenticated، ولا وصول مباشر من المتصفح
--  أو من وسيط الطباعة (كلاهما يمر عبر مسارات /api/print/* فقط).
-- =============================================================================

CREATE TABLE IF NOT EXISTS print_stations (
  id            text PRIMARY KEY,
  agent_token   text NOT NULL,
  client_token  text NOT NULL,
  pair_code     text NOT NULL,
  hostname      text NOT NULL DEFAULT '',
  platform      text NOT NULL DEFAULT '',
  agent_version text NOT NULL DEFAULT '',
  printers      jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS print_stations_pair_code_key ON print_stations (pair_code);
CREATE INDEX IF NOT EXISTS print_stations_last_seen_idx ON print_stations (last_seen_at);

CREATE TABLE IF NOT EXISTS print_jobs (
  id           text PRIMARY KEY,
  station_id   text NOT NULL REFERENCES print_stations(id) ON DELETE CASCADE,
  target       text NOT NULL DEFAULT 'spooler',
  printer      text,
  host         text,
  port         integer,
  data_base64  text NOT NULL,
  doc_name     text NOT NULL DEFAULT 'SEEN POS Receipt',
  copies       integer NOT NULL DEFAULT 1,
  status       text NOT NULL DEFAULT 'queued',
  error        text,
  bytes        integer,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- الاستقصاء المتكرر في /agent/poll يبحث عن أقدم مهمة queued لمحطة بعينها
CREATE INDEX IF NOT EXISTS print_jobs_station_status_idx ON print_jobs (station_id, status, created_at);
CREATE INDEX IF NOT EXISTS print_jobs_status_updated_idx ON print_jobs (status, updated_at);

-- تحديد معدّل محاولات الاقتران الخاطئة لكل عنوان IP — كانت في الذاكرة أيضاً
-- وتعاني من نفس مشكلة عدم مشاركة الحالة بين نسخ الدالة.
CREATE TABLE IF NOT EXISTS print_pair_attempts (
  ip        text PRIMARY KEY,
  count     integer NOT NULL DEFAULT 1,
  reset_at  timestamptz NOT NULL
);

ALTER TABLE print_stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE print_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE print_pair_attempts ENABLE ROW LEVEL SECURITY;
-- عمداً بلا أي سياسة: الوصول حصراً عبر مفتاح service_role من السيرفر
-- (supabaseAdmin في src/server/supabase-admin.ts)، الذي يتجاوز RLS أصلاً.
