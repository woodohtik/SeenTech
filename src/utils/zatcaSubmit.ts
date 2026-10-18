/**
 * submitZatcaInvoice — called once right after a successful (non-offline)
 * POS sale (seen-zatca-real-onboarding-task.md Phase ب step 6), same
 * fire-and-forget shape as notifyNewOrderForStaff in orderNotify.ts: never
 * touches the sale itself, and a failure here must never make an already-
 * successful sale look broken to the cashier.
 *
 * Unlike those two notifications, the RESULT does matter for a B2B sale:
 * /api/zatca/submit-invoice is a complete no-op for every tenant without a
 * production ZATCA CSID yet (status 'not_applicable', the normal case
 * today), but once a tenant has one, a B2B invoice ZATCA actually rejects
 * must be surfaced to the cashier -- this project's own prior decision
 * ("لا تُعتبر مكتملة محلياً"). The local sale is already committed by this
 * point (ZATCA Clearance confirmation necessarily comes after the order
 * exists to build its invoice from), so this can only warn, not undo it --
 * no reversal flow exists for that yet.
 */
import { supabase } from '../lib/supabase/client';

export interface ZatcaSubmitResult {
  ok: boolean;
  status: 'not_applicable' | 'pending' | 'cleared' | 'reported' | 'rejected' | 'error';
}

export async function submitZatcaInvoice(orderId: string, isB2B: boolean): Promise<ZatcaSubmitResult> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return { ok: false, status: 'error' };

    const res = await fetch('/api/zatca/submit-invoice', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ orderId }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.warn('[submitZatcaInvoice] rejected or failed:', body);
      return { ok: false, status: isB2B ? 'rejected' : 'error' };
    }

    const data = await res.json();
    return { ok: true, status: data.status };
  } catch (e) {
    console.warn('[submitZatcaInvoice] non-fatal:', e);
    return { ok: false, status: 'error' };
  }
}

/**
 * seen-ai-assistant-zatca-cr-task.md, ZATCA #1: same fire-and-forget shape
 * as submitZatcaInvoice above, called once right after CreditNotes.tsx
 * inserts a sales_returns row. isB2B isn't a parameter here the way it is
 * above -- /api/zatca/submit-credit-note derives it itself from the
 * ORIGINAL order's own B2B notes, since a credit note's type must always
 * match the invoice it corrects, not a value the caller could get out of
 * sync with that invoice.
 */
export async function submitZatcaCreditNote(creditNoteId: string): Promise<ZatcaSubmitResult> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return { ok: false, status: 'error' };

    const res = await fetch('/api/zatca/submit-credit-note', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ creditNoteId }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.warn('[submitZatcaCreditNote] rejected or failed:', body);
      return { ok: false, status: 'error' };
    }

    const data = await res.json();
    return { ok: true, status: data.status };
  } catch (e) {
    console.warn('[submitZatcaCreditNote] non-fatal:', e);
    return { ok: false, status: 'error' };
  }
}
