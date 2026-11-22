/**
 * seen-readiness-fixes-task.md P2.4 -- what the ZATCA queue worker records for
 * each send. The send itself (zatcaSendInvoice / zatcaSendCreditNote in
 * server.ts) returns the same { status, body } its route answers with.
 */
export type QueueOutcome = 'sent' | 'retry' | 'rejected' | 'failed' | 'not_applicable';

export function classifyZatcaSend(r: { status: number; body: any }): { status: QueueOutcome; error: string | null } {
  const body = r.body ?? {};
  const message = typeof body.error === 'string' ? body.error : null;
  if (r.status === 200) {
    if (body.status === 'not_applicable') return { status: 'not_applicable', error: null };
    if (body.status === 'reported' || body.status === 'cleared') return { status: 'sent', error: null };
    return { status: 'retry', error: `unexpected answer: ${JSON.stringify(body).slice(0, 200)}` };
  }
  if (r.status === 502) {
    // ZATCA turned it down (kept with its reason) or could not be reached (try again).
    return { status: body.status === 'rejected' ? 'rejected' : 'retry', error: message };
  }
  if (r.status === 409) {
    // Another send (or the shop's signing) is running -- see it again later.
    // Missing seller tax settings need the owner, and a document issued before
    // the chain existed is never sent; neither is worth another try.
    return /tax settings incomplete|before the ZATCA chain/i.test(message ?? '')
      ? { status: 'failed', error: message }
      : { status: 'retry', error: message };
  }
  if (r.status === 404) return { status: 'failed', error: message };
  return { status: 'retry', error: message ?? `HTTP ${r.status}` };
}
