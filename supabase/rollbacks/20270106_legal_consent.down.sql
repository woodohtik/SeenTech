-- Rollback of 20270106000000_legal_consent.sql (the columns are kept: they hold who agreed to what).
DROP FUNCTION IF EXISTS public.accept_legal_terms(text, text);
DROP TRIGGER IF EXISTS users_guard_legal_columns ON public.users;
DROP FUNCTION IF EXISTS public.guard_users_legal_columns();
