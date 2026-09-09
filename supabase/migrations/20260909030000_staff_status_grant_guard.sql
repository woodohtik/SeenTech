-- =============================================================================
--  منع تعطيل/تفعيل حساب زميل بلا صلاحية فعلية (ultra-review)
--  ------------------------------------------------------------------------
--  Staff.tsx toggleStatus() تحقّق فقط عبر canEdit (واجهة) قبل هذا الإصلاح --
--  UPDATE الفعلي على staff.status لا يمرّ على أي فحص DB لغير الصف الشخصي
--  (staff_no_self_escalation_trigger يحمي فقط تعديل صفّك أنت). موظف عادي
--  (كاشير) يقدر يستدعي مباشرة supabase.from('staff').update({status:
--  'inactive'}).eq('id', <صف owner>) ويعطّل حساب صاحب المحل.
--  يتطلب الآن أن يكون الفاعل owner/admin فعلياً (أو super_admin، يمرّ دائماً)
--  لتغيير status على صف آخر غير صفّه الشخصي.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.staff_role_grant_guard() RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_role      text;
  new_role_id_key text;
BEGIN
  IF app_is_super_admin() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.role IS NOT DISTINCT FROM OLD.role
     AND NEW.role_id IS NOT DISTINCT FROM OLD.role_id
     AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.role::text IN ('super_admin', 'support_tech', 'billing_admin') THEN
    RAISE EXCEPTION 'لا يمكن منح دور منصّة (%) بدون صلاحية super_admin فعلية', NEW.role
      USING ERRCODE = '42501';
  END IF;

  IF NEW.role::text IN ('owner', 'admin') THEN
    actor_role := app_current_role();
    IF actor_role IS NULL OR actor_role NOT IN ('owner', 'admin') THEN
      RAISE EXCEPTION 'لا يمكن منح دور % بدون أن يكون المستخدم الحالي owner أو admin بالفعل', NEW.role
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.role_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.role_id IS DISTINCT FROM OLD.role_id) THEN
    SELECT role_key INTO new_role_id_key FROM public.roles WHERE id = NEW.role_id;

    IF new_role_id_key IN ('super_admin', 'support_tech', 'billing_admin') THEN
      RAISE EXCEPTION 'لا يمكن منح دور منصّة (%) عبر role_id بدون صلاحية super_admin فعلية', new_role_id_key
        USING ERRCODE = '42501';
    END IF;

    IF new_role_id_key IN ('owner', 'admin') THEN
      actor_role := COALESCE(actor_role, app_current_role());
      IF actor_role IS NULL OR actor_role NOT IN ('owner', 'admin') THEN
        RAISE EXCEPTION 'لا يمكن منح دور % عبر role_id بدون أن يكون المستخدم الحالي owner أو admin بالفعل', new_role_id_key
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  -- تعطيل/تفعيل صف آخر غير صف الفاعل نفسه: يتطلب owner/admin. (صف الفاعل
  -- نفسه محمي أصلاً عبر staff_no_self_escalation_trigger لكل غير super_admin.)
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status AND OLD.uid IS DISTINCT FROM app_current_uid() THEN
    actor_role := COALESCE(actor_role, app_current_role());
    IF actor_role IS NULL OR actor_role NOT IN ('owner', 'admin') THEN
      RAISE EXCEPTION 'لا يمكن تعديل حالة موظف آخر بدون أن يكون المستخدم الحالي owner أو admin'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
