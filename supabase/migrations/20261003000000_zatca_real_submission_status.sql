-- =============================================================================
--  ZATCA real onboarding (seen-zatca-real-onboarding-task.md), Phase ب
--  step 6 (wiring): tracks the actual Clearance/Reporting submission
--  status per invoice, once a tenant has a real zatca_credentials row.
--
--  Deliberately NOT part of create_pos_sale itself: that RPC runs inside
--  the POS checkout transaction and must keep working exactly as it does
--  today for every tenant that has no ZATCA Production CSID yet (i.e.
--  everyone, until real onboarding in seen-zatca-real-onboarding-task.md
--  Phase ج completes for at least one tenant). The actual XML build +
--  sign + Clearance/Reporting call needs the tenant's decrypted private
--  key (zatcaCrypto.ts) and a real network call to ZATCA -- neither
--  belongs inside a Postgres function. A new server.ts endpoint
--  (/api/zatca/submit-invoice) updates these columns after create_pos_sale
--  has already committed the order+invoice.
-- =============================================================================

-- zatca_status values: 'not_applicable' (tenant has no production
-- zatca_credentials -- the normal case until Phase ج completes for a
-- tenant), 'pending', 'cleared' (B2B accepted), 'reported' (B2C accepted),
-- 'rejected' (B2B rejected -- never treated as a completed sale, per this
-- project's own decision).
ALTER TABLE public.tax_invoices
  ADD COLUMN IF NOT EXISTS zatca_status TEXT NOT NULL DEFAULT 'not_applicable',
  ADD COLUMN IF NOT EXISTS zatca_response JSONB,
  ADD COLUMN IF NOT EXISTS zatca_submitted_at TIMESTAMPTZ;

-- CHECK instead of the enum type directly on the column: this column may
-- already have the literal default 'not_applicable' written by existing
-- rows/older app code paths before this migration ever ran on a given
-- environment, and a CHECK is simpler to loosen later than an enum type
-- is to alter. Same reasoning as other status-like text columns elsewhere
-- in this schema.
ALTER TABLE public.tax_invoices
  DROP CONSTRAINT IF EXISTS tax_invoices_zatca_status_check;
ALTER TABLE public.tax_invoices
  ADD CONSTRAINT tax_invoices_zatca_status_check
  CHECK (zatca_status IN ('not_applicable', 'pending', 'cleared', 'reported', 'rejected'));
