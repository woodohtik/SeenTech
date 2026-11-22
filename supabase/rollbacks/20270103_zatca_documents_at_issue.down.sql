-- Rollback of 20270103000001_zatca_documents_at_issue.sql (the columns are kept: dropping them would lose signed documents).
DROP TRIGGER IF EXISTS tax_invoices_zatca_stamp ON public.tax_invoices;
DROP TRIGGER IF EXISTS sales_returns_zatca_stamp ON public.sales_returns;
DROP TRIGGER IF EXISTS trg_sales_returns_immutable ON public.sales_returns;
DROP FUNCTION IF EXISTS public.zatca_stamp_document();
DROP FUNCTION IF EXISTS public.zatca_signing_begin(uuid, timestamptz, int);
DROP FUNCTION IF EXISTS public.zatca_signing_store(uuid, uuid, text, uuid, bigint, text, text, text, text);
DROP FUNCTION IF EXISTS public.zatca_signing_end(uuid, uuid);
DROP FUNCTION IF EXISTS public.zatca_unsigned_documents(uuid, bigint);
DROP FUNCTION IF EXISTS public.zatca_first_pih();
GRANT UPDATE, DELETE ON public.sales_returns TO authenticated;
