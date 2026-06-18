-- =============================================================================
--  SEEN — نظام التجربة المجانية PLG (14 يوم) + متابعة السيلز
--  دورة الحياة: تجربة 14 يوم → (24h بلا دفع → SLG) → انتهاء → قفل → (30 يوم) → حذف الداتا
--  هوية العميل (الجوال+الإيميل) تبقى محفوظة دائماً لمنع إعادة استغلال التجربة المجانية
--  شغّله في Supabase SQL Editor. يتطلّب امتداد pg_cron (مفعّل افتراضياً في Supabase).
-- =============================================================================

-- 1) حقول التجربة على الـ tenants -------------------------------------------------
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS subscription_status text NOT NULL DEFAULT 'trial';
-- القيم: 'trial' | 'active' | 'locked' | 'purge_pending'
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_started_at timestamptz;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_ends_at    timestamptz;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS locked_at        timestamptz;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS purge_at         timestamptz;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS is_trial         boolean NOT NULL DEFAULT true;

-- 2) ربط الـ leads بالـ tenant + دورة حالة المبيعات ------------------------------
-- (جدول leads أُنشئ في LANDING_leads.sql)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS email text;
-- leads.status: 'new' | 'trial' | 'slg' | 'paid' | 'lost'

-- 3) تنبيهات السيلز (SLG) ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales_notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     uuid REFERENCES leads(id) ON DELETE CASCADE,
  tenant_id   uuid REFERENCES tenants(id) ON DELETE SET NULL,
  type        text NOT NULL DEFAULT 'slg_handoff',
  message     text,
  handled     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sales_notifications ENABLE ROW LEVEL SECURITY; -- سياسات القراءة للسيلز حسب نموذجكم

-- 4) بدء التجربة (تُستدعى عند التسجيل/التزويد) -----------------------------------
CREATE OR REPLACE FUNCTION start_tenant_trial(p_tenant_id uuid, p_days int DEFAULT 14)
RETURNS void LANGUAGE sql AS $$
  UPDATE tenants SET
    is_trial=true, subscription_status='trial',
    trial_started_at=now(), trial_ends_at=now() + (p_days || ' days')::interval,
    locked_at=NULL, purge_at=NULL
  WHERE id = p_tenant_id;
$$;

-- 5) عند الدفع/الاشتراك → تفعيل دائم ---------------------------------------------
CREATE OR REPLACE FUNCTION activate_tenant_subscription(p_tenant_id uuid)
RETURNS void LANGUAGE sql AS $$
  UPDATE tenants SET is_trial=false, subscription_status='active',
    locked_at=NULL, purge_at=NULL WHERE id=p_tenant_id;
  UPDATE leads SET status='paid' WHERE tenant_id=p_tenant_id;
$$;

-- 6) كنس SLG: 24 ساعة بلا دفع → السيلز --------------------------------------------
CREATE OR REPLACE FUNCTION slg_sweep()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  WITH due AS (
    SELECT l.id AS lead_id, l.tenant_id
    FROM leads l
    WHERE l.status IN ('new','trial')
      AND l.created_at < now() - interval '24 hours'
      AND NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id=l.tenant_id AND t.subscription_status='active')
  ), upd AS (
    UPDATE leads SET status='slg' WHERE id IN (SELECT lead_id FROM due) RETURNING id, tenant_id
  )
  INSERT INTO sales_notifications(lead_id, tenant_id, type, message)
  SELECT id, tenant_id, 'slg_handoff', 'لم يتم الدفع خلال 24 ساعة — تواصل مع العميل'
  FROM upd;
END; $$;

-- 7) كنس القفل: انتهت التجربة → قفل + ضبط موعد الحذف (+7 أيام) --------------------
CREATE OR REPLACE FUNCTION trial_lock_sweep()
RETURNS void LANGUAGE sql AS $$
  UPDATE tenants SET subscription_status='locked', locked_at=now(), purge_at=now() + interval '30 days'
  WHERE subscription_status='trial' AND trial_ends_at IS NOT NULL AND trial_ends_at < now();
$$;

-- 8) كنس الحذف: مرّ 30 يوم على القفل بلا اشتراك → حذف بيانات التجربة (تبقى الهوية) ------
CREATE OR REPLACE FUNCTION trial_purge_sweep()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM tenants
           WHERE subscription_status='locked' AND purge_at IS NOT NULL AND purge_at < now()
  LOOP
    -- احذف البيانات التشغيلية لهذا الـ tenant (وسّع القائمة حسب جداولكم)
    DELETE FROM orders            WHERE tenant_id = r.id;
    DELETE FROM customers         WHERE tenant_id = r.id;
    DELETE FROM inventory_items   WHERE tenant_id = r.id;
    DELETE FROM staff             WHERE tenant_id = r.id;
    DELETE FROM branches          WHERE tenant_id = r.id;
    -- علّم الـ tenant كمحذوف/منتهٍ (أو احذفه إن أردت إزالة كاملة)
    UPDATE tenants SET subscription_status='purge_pending', is_trial=false WHERE id = r.id;
    UPDATE leads SET status='lost' WHERE tenant_id = r.id AND status NOT IN ('paid');
  END LOOP;
END; $$;

-- 9) جدولة الكنّاسات عبر pg_cron --------------------------------------------------
-- (في Supabase: تأكد أن الامتداد مفعّل: create extension if not exists pg_cron;)
SELECT cron.schedule('seen_slg_sweep',    '*/30 * * * *', $$SELECT slg_sweep();$$);          -- كل 30 دقيقة
SELECT cron.schedule('seen_trial_lock',   '*/15 * * * *', $$SELECT trial_lock_sweep();$$);    -- كل 15 دقيقة
SELECT cron.schedule('seen_trial_purge',  '0 3 * * *',    $$SELECT trial_purge_sweep();$$);   -- يومياً 3 صباحاً
-- لإلغاء جدولة: SELECT cron.unschedule('seen_slg_sweep'); ... إلخ

-- ملاحظة: ربط تنبيهات sales_notifications بقناة فعلية (واتساب/سلاك/بريد) يتم عبر
-- Supabase Edge Function أو Webhook يستمع على إدراج الصف (انظر PLG_FLOW_README.md).

-- =============================================================================
-- 10) منع إعادة استغلال التجربة المجانية — هوية العميل الدائمة
--     جدول منفصل لا يُحذف أبداً في كنس الحذف (يحفظ الجوال/الإيميل لكل من جرّب).
-- =============================================================================
CREATE TABLE IF NOT EXISTS trial_identities (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone           text,
  email           text,
  first_tenant_id uuid,
  first_trial_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  trials_count    int NOT NULL DEFAULT 1
);
-- بحث سريع + منع التكرار (الجوال أو الإيميل)
CREATE UNIQUE INDEX IF NOT EXISTS trial_identities_phone_uniq ON trial_identities (phone) WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS trial_identities_email_uniq ON trial_identities (lower(email)) WHERE email IS NOT NULL;

-- تسجيل/تحديث الهوية عند كل التقاط lead لتجربة (Trigger على leads)
CREATE OR REPLACE FUNCTION trg_register_trial_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  IF NEW.phone IS NULL AND NEW.email IS NULL THEN RETURN NEW; END IF;
  SELECT id INTO v_id FROM trial_identities
   WHERE (NEW.phone IS NOT NULL AND phone = NEW.phone)
      OR (NEW.email IS NOT NULL AND lower(email) = lower(NEW.email))
   LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO trial_identities(phone, email, first_tenant_id) VALUES (NEW.phone, NEW.email, NEW.tenant_id);
  ELSE
    UPDATE trial_identities SET last_seen_at = now(), trials_count = trials_count + 1 WHERE id = v_id;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS leads_register_trial_identity ON leads;
CREATE TRIGGER leads_register_trial_identity AFTER INSERT ON leads
  FOR EACH ROW EXECUTE FUNCTION trg_register_trial_identity();

-- فحص قبل منح تجربة جديدة: هل سبق لهذا الجوال/الإيميل أخذ تجربة؟
CREATE OR REPLACE FUNCTION has_used_trial(p_phone text, p_email text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM trial_identities
    WHERE (p_phone IS NOT NULL AND phone = p_phone)
       OR (p_email IS NOT NULL AND lower(email) = lower(p_email))
  );
$$;
GRANT EXECUTE ON FUNCTION has_used_trial(text, text) TO authenticated, anon;

ALTER TABLE trial_identities ENABLE ROW LEVEL SECURITY;  -- لا سياسة SELECT للعملاء؛ الوصول عبر has_used_trial فقط (SECURITY DEFINER)
