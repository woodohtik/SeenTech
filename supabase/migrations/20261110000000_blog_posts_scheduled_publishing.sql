-- جدولة نشر التدوينات: حالة 'scheduled' جديدة + عمود scheduled_for، ومسح
-- دوري عبر pg_cron (نفس نمط seen_slg_sweep/trial_lock في
-- 20260910040000_backfill_plg_trial_lifecycle.sql) يحوّل التدوينات المستحقة
-- تلقائياً إلى 'published' بدقة ~15 دقيقة. لا تغيير على RLS: سياسة القراءة
-- العامة الحالية (status = 'published') تترك 'scheduled' غير مرئية تلقائياً.

ALTER TABLE blog_posts DROP CONSTRAINT IF EXISTS blog_posts_status_check;
ALTER TABLE blog_posts ADD CONSTRAINT blog_posts_status_check
  CHECK (status IN ('draft', 'scheduled', 'published'));

ALTER TABLE blog_posts ADD COLUMN scheduled_for timestamptz;

CREATE INDEX blog_posts_scheduled_idx ON blog_posts (scheduled_for)
  WHERE status = 'scheduled';

CREATE OR REPLACE FUNCTION blog_publish_due_posts()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE blog_posts
  SET status = 'published', published_at = now()
  WHERE status = 'scheduled' AND scheduled_for <= now();
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('seen_blog_publish_sweep', '*/15 * * * *', $cron$SELECT blog_publish_due_posts();$cron$);
  END IF;
END $$;
