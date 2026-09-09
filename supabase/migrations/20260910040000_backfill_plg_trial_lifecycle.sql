-- =============================================================================
--  إعادة توثيق PLG_trial_lifecycle.sql ضمن سجل الـmigrations الفعلي
--  (seen-master-backlog-and-structure.md، خطوة 3)
--  ------------------------------------------------------------------------
--  start_tenant_trial/activate_tenant_subscription/slg_sweep/trial_lock_sweep/
--  trial_purge_sweep/has_used_trial -- كلها حيّة، ومُستخدَمة فعلياً
--  (trialService.ts)، وسُحبت صلاحياتها اليوم (20260909090000) بعد اكتشاف
--  أنها كانت قابلة للاستدعاء من anon/authenticated بلا داعٍ -- لكن CREATE
--  الأصلي لهذه الدوال والجداول المرتبطة بها لم يكن مُتتبَّعاً بالكامل.
-- =============================================================================

ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS subscription_status text NOT NULL DEFAULT 'trial';
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS trial_started_at timestamptz;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS trial_ends_at    timestamptz;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS locked_at        timestamptz;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS purge_at         timestamptz;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS is_trial         boolean NOT NULL DEFAULT true;

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS email text;

CREATE TABLE IF NOT EXISTS public.sales_notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  tenant_id   uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  type        text NOT NULL DEFAULT 'slg_handoff',
  message     text,
  handled     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sales_notifications ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.start_tenant_trial(p_tenant_id uuid, p_days int DEFAULT 14)
RETURNS void LANGUAGE sql AS $$
  UPDATE tenants SET
    is_trial=true, subscription_status='trial',
    trial_started_at=now(), trial_ends_at=now() + (p_days || ' days')::interval,
    locked_at=NULL, purge_at=NULL
  WHERE id = p_tenant_id;
$$;

CREATE OR REPLACE FUNCTION public.activate_tenant_subscription(p_tenant_id uuid)
RETURNS void LANGUAGE sql AS $$
  UPDATE tenants SET is_trial=false, subscription_status='active',
    locked_at=NULL, purge_at=NULL WHERE id=p_tenant_id;
  UPDATE leads SET status='paid' WHERE tenant_id=p_tenant_id;
$$;

CREATE OR REPLACE FUNCTION public.slg_sweep()
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

CREATE OR REPLACE FUNCTION public.trial_lock_sweep()
RETURNS void LANGUAGE sql AS $$
  UPDATE tenants SET subscription_status='locked', locked_at=now(), purge_at=now() + interval '30 days'
  WHERE subscription_status='trial' AND trial_ends_at IS NOT NULL AND trial_ends_at < now();
$$;

CREATE OR REPLACE FUNCTION public.trial_purge_sweep()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM tenants
           WHERE subscription_status='locked' AND purge_at IS NOT NULL AND purge_at < now()
  LOOP
    DELETE FROM orders            WHERE tenant_id = r.id;
    DELETE FROM customers         WHERE tenant_id = r.id;
    DELETE FROM inventory_items   WHERE tenant_id = r.id;
    DELETE FROM staff             WHERE tenant_id = r.id;
    DELETE FROM branches          WHERE tenant_id = r.id;
    UPDATE tenants SET subscription_status='purge_pending', is_trial=false WHERE id = r.id;
    UPDATE leads SET status='lost' WHERE tenant_id = r.id AND status NOT IN ('paid');
  END LOOP;
END; $$;

DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('seen_slg_sweep',    '*/30 * * * *', $cron$SELECT slg_sweep();$cron$);
    PERFORM cron.schedule('seen_trial_lock',   '*/15 * * * *', $cron$SELECT trial_lock_sweep();$cron$);
    PERFORM cron.schedule('seen_trial_purge',  '0 3 * * *',    $cron$SELECT trial_purge_sweep();$cron$);
  END IF;
END $outer$;

CREATE TABLE IF NOT EXISTS public.trial_identities (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone           text,
  email           text,
  first_tenant_id uuid,
  first_trial_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  trials_count    int NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS trial_identities_phone_uniq ON public.trial_identities (phone) WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS trial_identities_email_uniq ON public.trial_identities (lower(email)) WHERE email IS NOT NULL;

CREATE OR REPLACE FUNCTION public.trg_register_trial_identity()
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
DROP TRIGGER IF EXISTS leads_register_trial_identity ON public.leads;
CREATE TRIGGER leads_register_trial_identity AFTER INSERT ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.trg_register_trial_identity();

CREATE OR REPLACE FUNCTION public.has_used_trial(p_phone text, p_email text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM trial_identities
    WHERE (p_phone IS NOT NULL AND phone = p_phone)
       OR (p_email IS NOT NULL AND lower(email) = lower(p_email))
  );
$$;
GRANT EXECUTE ON FUNCTION public.has_used_trial(text, text) TO authenticated, anon;

ALTER TABLE public.trial_identities ENABLE ROW LEVEL SECURITY;
