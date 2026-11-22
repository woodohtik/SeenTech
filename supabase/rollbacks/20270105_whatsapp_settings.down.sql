-- Rollback of 20270105000006_whatsapp_settings.sql (the column is kept).
DROP FUNCTION IF EXISTS public.save_whatsapp_settings(boolean, text);
