-- seen-readiness-fixes-task.md P5 (PLATFORM-01; founder question 6) -- a
-- shop owner agrees to the terms and the privacy policy when signing up, and
-- the agreement is kept with its date and the version agreed to.
--
-- users.terms_version / privacy_version / legal_accepted_at, written only by
-- accept_legal_terms for the signed-in user's own row (the browser cannot
-- backdate or forge someone else's). The texts are at /terms and /privacy
-- (src/legal/legalDocuments.ts) and are marked as drafts until the founder's
-- lawyer approves them.
-- Rollback: supabase/rollbacks/20270106_legal_consent.down.sql

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS terms_version     text,
  ADD COLUMN IF NOT EXISTS privacy_version   text,
  ADD COLUMN IF NOT EXISTS legal_accepted_at timestamptz;

CREATE OR REPLACE FUNCTION public.accept_legal_terms(p_terms_version text, p_privacy_version text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid text := auth.uid()::text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(btrim(p_terms_version), '') = '' OR COALESCE(btrim(p_privacy_version), '') = '' OR length(p_terms_version) > 40 OR length(p_privacy_version) > 40 THEN
    RAISE EXCEPTION 'نسخة غير صالحة' USING ERRCODE = '22023';
  END IF;
  UPDATE public.users
     SET terms_version = p_terms_version, privacy_version = p_privacy_version, legal_accepted_at = now()
   WHERE id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('terms_version', p_terms_version, 'privacy_version', p_privacy_version, 'accepted_at', now());
END;
$function$;
REVOKE ALL ON FUNCTION public.accept_legal_terms(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_legal_terms(text, text) TO authenticated;

-- The browser writes users rows itself (sign-up, profile), with table-wide
-- grants: a trigger keeps these three for accept_legal_terms alone.
CREATE OR REPLACE FUNCTION public.guard_users_legal_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.terms_version := NULL; NEW.privacy_version := NULL; NEW.legal_accepted_at := NULL;
  ELSIF NEW.terms_version IS DISTINCT FROM OLD.terms_version
     OR NEW.privacy_version IS DISTINCT FROM OLD.privacy_version
     OR NEW.legal_accepted_at IS DISTINCT FROM OLD.legal_accepted_at THEN
    RAISE EXCEPTION 'الموافقة على الشروط تُسجَّل عبر النظام فقط' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS users_guard_legal_columns ON public.users;
CREATE TRIGGER users_guard_legal_columns BEFORE INSERT OR UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.guard_users_legal_columns();
