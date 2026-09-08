-- =============================================================================
--  منع مالك المستأجر من تعديل حقول الاشتراك/الفوترة الخاصة بنفسه مباشرة
--  (اكتُشِف أثناء تنفيذ بند 2.4 من seen-comprehensive-review-fixes-task.md --
--  وُجِد بفحص حي لسياسات RLS على tenants أثناء تصميم الإصلاح المطلوب هناك)
--  ------------------------------------------------------------------------
--  pg_policies على tenants (فحص حي، هذه الجلسة) كشف أن "tenants_owner_update"
--  تسمح لمالك المستأجر (owner_uid = app_current_uid()) بتحديث **أي عمود** في
--  صف مستأجره، بلا استثناء لأعمدة الاشتراك/الفوترة. أي مالك حساب (عميل حقيقي
--  بحساب صالح، لا يحتاج أي اختراق) يقدر يستدعي مباشرة:
--    supabase.from('tenants').update({ plan_id:'basic', status:'active',
--      subscription_end_date:'2099-01-01' }).eq('id', myTenantId)
--  ويمنح نفسه اشتراكاً مدفوعاً كاملاً بلا أي دفعة فعلية، أو يلغي قفل/إيقاف
--  حسابه (locked_at/purge_at)، أو يمدّد تجربته المجانية (trial_ends_at)، بلا
--  أي مرور على مسار الدفع أو موافقة السوبر أدمن إطلاقاً.
--
--  هذا المُشغِّل (بنفس نمط staff_no_self_escalation_trigger، 20260822090100)
--  يمنع تغيير أعمدة دورة حياة الاشتراك/الفوترة/الملكية من غير super_admin،
--  بينما يبقي التعديل الذاتي الطبيعي (الاسم، الهاتف، العنوان، الشعار،
--  إعدادات الضريبة... راجع Settings.tsx/Onboarding.tsx) يعمل بلا أي تغيير.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.tenants_no_self_billing_escalation() RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF app_is_super_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.plan_id              IS DISTINCT FROM OLD.plan_id
     OR NEW.status             IS DISTINCT FROM OLD.status
     OR NEW.subscription_status IS DISTINCT FROM OLD.subscription_status
     OR NEW.trial_started_at   IS DISTINCT FROM OLD.trial_started_at
     OR NEW.trial_ends_at      IS DISTINCT FROM OLD.trial_ends_at
     OR NEW.locked_at          IS DISTINCT FROM OLD.locked_at
     OR NEW.purge_at           IS DISTINCT FROM OLD.purge_at
     OR NEW.is_trial           IS DISTINCT FROM OLD.is_trial
     OR NEW.owner_uid          IS DISTINCT FROM OLD.owner_uid
     OR NEW.referred_by        IS DISTINCT FROM OLD.referred_by
     OR NEW.enabled_modules    IS DISTINCT FROM OLD.enabled_modules
     OR NEW.assistant_enabled  IS DISTINCT FROM OLD.assistant_enabled
     OR NEW.is_test            IS DISTINCT FROM OLD.is_test THEN
    RAISE EXCEPTION 'لا يمكن تعديل حقول الاشتراك/الفوترة/الملكية على حساب المستأجر ذاتياً'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tenants_no_self_billing_escalation_trigger ON public.tenants;
CREATE TRIGGER tenants_no_self_billing_escalation_trigger
BEFORE UPDATE ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.tenants_no_self_billing_escalation();
