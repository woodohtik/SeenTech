import { describe, expect, it } from 'vitest';
import { classifyZatcaSend } from './zatcaQueue';

// seen-readiness-fixes-task.md P2.4 / ZATCA-17.
describe('classifyZatcaSend', () => {
  it('a reported or cleared document (or one already sent) is done', () => {
    expect(classifyZatcaSend({ status: 200, body: { ok: true, status: 'reported' } }).status).toBe('sent');
    expect(classifyZatcaSend({ status: 200, body: { ok: true, status: 'cleared', replayed: true } }).status).toBe('sent');
  });
  it('a shop without a production certificate has nothing to send', () => {
    expect(classifyZatcaSend({ status: 200, body: { ok: true, status: 'not_applicable' } }).status).toBe('not_applicable');
  });
  it("ZATCA's rejection is kept with its reason; a network failure is retried", () => {
    expect(classifyZatcaSend({ status: 502, body: { error: 'x', status: 'rejected' } })).toEqual({ status: 'rejected', error: 'x' });
    expect(classifyZatcaSend({ status: 502, body: { error: 'y', status: 'retry' } }).status).toBe('retry');
    expect(classifyZatcaSend({ status: 500, body: { error: 'Internal Server Error' } }).status).toBe('retry');
  });
  it('a send already running is seen later; missing tax settings or a missing document need a person', () => {
    expect(classifyZatcaSend({ status: 409, body: { error: 'ZATCA submission already in progress or completed for this invoice' } }).status).toBe('retry');
    expect(classifyZatcaSend({ status: 409, body: { error: 'Tenant tax settings incomplete; cannot submit to ZATCA' } }).status).toBe('failed');
    expect(classifyZatcaSend({ status: 404, body: { error: 'Invoice not found for this order' } }).status).toBe('failed');
  });
});
