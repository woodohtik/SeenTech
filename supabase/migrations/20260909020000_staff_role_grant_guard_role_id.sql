-- =============================================================================
--  إغلاق الثغرة نفسها عبر role_id (ultra-review، بند حرج)
--  ------------------------------------------------------------------------
--  staff_role_grant_guard (20260908030000) فحص عمود role النصّي فقط. لكن
--  AuthContext.tsx (resolveDbUser، ~126-134) يُعطي role_id أولوية على role
--  إن وُجد: يقرأ roles.role_key المرتبط به ويستخدمه كـ actualRole الفعلي.
--  موظف (حتى كاشير) يقدر يترك role='cashier' كما هو (يمرّ من الحارس القديم
--  بلا مشكلة) ويُغيّر role_id فقط ليشير لصفّ roles بصلاحيات owner/admin أو
--  حتى منصّة -- تصعيد كامل بلا أي مانع، عبر عمود شقيق لم يكن هذا الحارس
--  يفحصه إطلاقاً.
--
--  الحل: عند تغيّر role_id، اقرأ role_key للصف الجديد (roles.role_key) وطبِّق
--  عليه نفس فحص role النصّي بالضبط.
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

  IF TG_OP = 'UPDATE' AND NEW.role IS NOT DISTINCT FROM OLD.role
     AND NEW.role_id IS NOT DISTINCT FROM OLD.role_id THEN
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

  RETURN NEW;
END;
$$;
