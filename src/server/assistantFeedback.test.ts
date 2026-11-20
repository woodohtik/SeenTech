import { describe, expect, it } from 'vitest';
import { parseFeedback } from './assistantFeedback';

const base = { messageKey: 'a1b2c3d4-e5f6', rating: 'up' };

describe('parseFeedback', () => {
  it('accepts a plain "useful"', () => {
    expect(parseFeedback(base)).toEqual({
      ok: true,
      value: { messageKey: 'a1b2c3d4-e5f6', rating: 1, comment: null, question: null, toolNames: [], page: null },
    });
  });

  it('keeps a comment only on "not useful", trimmed and cut at 500', () => {
    const down = parseFeedback({ ...base, rating: 'down', comment: `  ${'x'.repeat(600)}  ` });
    expect(down.ok && down.value.comment?.length).toBe(500);
    const up = parseFeedback({ ...base, comment: 'nice' });
    expect(up.ok && up.value.comment).toBeNull();
  });

  it('refuses a missing or odd message key and an unknown rating', () => {
    expect(parseFeedback({ ...base, messageKey: 'short' })).toEqual({ ok: false, error: 'invalid_message_key' });
    expect(parseFeedback({ ...base, messageKey: "x'; drop table--" })).toEqual({ ok: false, error: 'invalid_message_key' });
    expect(parseFeedback({ ...base, rating: 5 })).toEqual({ ok: false, error: 'invalid_rating' });
    expect(parseFeedback(null)).toEqual({ ok: false, error: 'invalid_message_key' });
  });

  it('keeps only known tool names, once each, and only known pages', () => {
    const r = parseFeedback({ ...base, toolNames: ['getPendingOrders', 'dropTables', 'getPendingOrders', 7], page: 'orders' });
    expect(r.ok && r.value.toolNames).toEqual(['getPendingOrders']);
    expect(r.ok && r.value.page).toBe('orders');
    const p = parseFeedback({ ...base, page: '../../etc' });
    expect(p.ok && p.value.page).toBeNull();
  });

  it('cuts the question at 1000 characters', () => {
    const r = parseFeedback({ ...base, question: 'س'.repeat(1500) });
    expect(r.ok && r.value.question?.length).toBe(1000);
  });
});
