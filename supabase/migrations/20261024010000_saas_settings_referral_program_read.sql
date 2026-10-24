-- =============================================================================
--  Same gap as 20261024000000, found while fixing bank_transfer: Referral.tsx
--  (tenant-facing) reads saas_settings['referral_program'] directly via
--  getReferralProgramSettings() (referralService.ts) -- that key was never
--  on saas_settings_public_read's allow-list either, so every tenant's read
--  has been silently returning zero rows under RLS since 20260909070000
--  narrowed the policy. No error -- getReferralProgramSettings() just falls
--  back to its hardcoded defaults (enabled: true, 300, 1000), which happen
--  to match the seeded values, so this has been invisible until now: any
--  admin edit to the referral program from Settings would never actually
--  reach a tenant's Referral.tsx.
--
--  referral_program is meant to be read by every tenant (it drives the
--  reward/minimum-withdrawal numbers shown on their own referral page) --
--  same public exposure level as branding/bank_transfer.
-- =============================================================================

DROP POLICY IF EXISTS saas_settings_public_read ON public.saas_settings;
CREATE POLICY saas_settings_public_read ON public.saas_settings
  FOR SELECT TO authenticated
  USING (
    app_is_super_admin()
    OR key IN ('branding', 'bank_transfer', 'referral_program')
    OR (key = 'support_access_requests' AND app_current_role() IN ('owner', 'admin'))
  );
