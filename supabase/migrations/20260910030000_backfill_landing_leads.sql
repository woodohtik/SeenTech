-- =============================================================================
--  إعادة توثيق LANDING_leads.sql ضمن سجل الـmigrations الفعلي
--  (seen-master-backlog-and-structure.md، خطوة 3)
--  ------------------------------------------------------------------------
--  جدول leads حي فعلاً (يُستخدَم في trialService.ts لالتقاط عملاء التجربة
--  المجانية، وpg_cron sweeps في PLG_trial_lifecycle.sql تعتمد عليه) لكن
--  CREATE TABLE الخاص به لم يكن موجوداً في أي migration مُتتبَّع.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.leads (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  phone         text NOT NULL,
  business_type text,
  source        text DEFAULT 'landing',
  status        text DEFAULT 'new',
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leads_anon_insert ON public.leads;
CREATE POLICY leads_anon_insert ON public.leads
  FOR INSERT TO anon
  WITH CHECK (true);
