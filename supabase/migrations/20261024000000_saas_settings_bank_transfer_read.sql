-- =============================================================================
--  saas_settings_public_read (20260909070000) allow-lists specific keys for
--  non-super-admin reads: 'branding' for everyone, 'support_access_requests'
--  for owner/admin. The new 'bank_transfer' key (BillingSettings.tsx's
--  merchant-facing bank-transfer payment instructions) was not on that list,
--  so every tenant's read silently returned zero rows under RLS (no error --
--  the client code just fell back to its hardcoded defaults, which is why
--  this looked like "the new value doesn't show up" rather than an error).
--
--  bank_transfer is meant to be shown to every merchant on the billing
--  screen, same exposure level as branding -- safe to allow for everyone.
-- =============================================================================

DROP POLICY IF EXISTS saas_settings_public_read ON public.saas_settings;
CREATE POLICY saas_settings_public_read ON public.saas_settings
  FOR SELECT TO authenticated
  USING (
    app_is_super_admin()
    OR key IN ('branding', 'bank_transfer')
    OR (key = 'support_access_requests' AND app_current_role() IN ('owner', 'admin'))
  );
