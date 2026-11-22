-- Rollback of 20270103000000_zatca_submission_queue.sql.
DROP TRIGGER IF EXISTS tax_invoices_zatca_enqueue ON public.tax_invoices;
DROP TRIGGER IF EXISTS sales_returns_zatca_enqueue ON public.sales_returns;
DROP FUNCTION IF EXISTS public.zatca_enqueue();
DROP FUNCTION IF EXISTS public.zatca_claim_submissions(int);
DROP FUNCTION IF EXISTS public.zatca_finish_submission(uuid, text, text, jsonb);
DROP TABLE IF EXISTS public.zatca_submissions;
