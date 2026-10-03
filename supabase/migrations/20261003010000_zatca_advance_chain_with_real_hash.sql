-- =============================================================================
--  ZATCA real onboarding (seen-zatca-real-onboarding-task.md), Phase ب
--  step 6: swaps create_pos_sale's placeholder PIH hash for the real one
--  computed from the actual signed UBL XML, once /api/zatca/submit-invoice
--  (server.ts) has built, signed, and successfully submitted it to ZATCA.
--
--  SECURITY DEFINER + explicit tenant check (not app_current_tenant_id()):
--  called from server.ts using the service-role client, not a user JWT --
--  there is no PostgREST session to derive a tenant from. p_tenant_id is
--  taken as a parameter instead, exactly as this project's other
--  service-role-only RPCs do, and every WHERE clause below is still scoped
--  by it explicitly so a caller can never touch another tenant's chain.
--
--  Only advances the tip if last_invoice_id still equals p_order_id -- if a
--  newer sale already advanced the chain past this one by the time this
--  runs, this is a stale/out-of-order call and must be a no-op rather than
--  corrupting the chain by writing a hash for an invoice that is no longer
--  the tip. See the KNOWN LIMITATION comment on the /api/zatca/submit-invoice
--  route in server.ts for the concurrency window this does not fully close.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.zatca_advance_chain_with_real_hash(
  p_tenant_id UUID,
  p_order_id  UUID,
  p_real_hash TEXT
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_updated INT;
BEGIN
  PERFORM 1 FROM public.zatca_invoice_chain_state
   WHERE tenant_id = p_tenant_id
   FOR UPDATE;

  UPDATE public.zatca_invoice_chain_state
     SET last_invoice_hash = p_real_hash, updated_at = now()
   WHERE tenant_id = p_tenant_id
     AND last_invoice_id = p_order_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END $$;

REVOKE EXECUTE ON FUNCTION public.zatca_advance_chain_with_real_hash(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
-- service_role only -- called exclusively from server.ts via supabaseAdmin, never from the browser.
