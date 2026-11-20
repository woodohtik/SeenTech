// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';

// The orders fetch interceptor (seen-performance-first-open-login-task.md
// Phase 8): an update that touches none of the columns packed into `notes`
// needs no read of the row first; one that does still merges from it.
const ID = '11111111-2222-4333-8444-555555555555';
const existingNotes = '__ORDER_METADATA_V2__:' + JSON.stringify({
  originalNotes: 'قماش من العميل',
  history: [{ status: 'pending', updatedAt: '2026-11-01T10:00:00Z' }],
  items: [{ name: 'ثوب', qty: 1 }],
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init?: any) => {
    const method = init?.method || 'GET';
    if (method === 'GET') {
      return new Response(JSON.stringify([{ id: ID, status: 'sewing', notes: existingNotes }]), { status: 200 });
    }
    return new Response('', { status: 204 });
  });
}

const calls = (spy: ReturnType<typeof mockFetch>) =>
  spy.mock.calls.map(([url, init]) => ({ url: String(url), method: (init as any)?.method || 'GET', body: (init as any)?.body }));

test('a status / payment update is sent as is, with no read of the row first', async () => {
  const spy = mockFetch();
  const { supabase } = await import('./client');
  await supabase.from('orders').update({ status: 'ready', paid_amount: 50 }).eq('id', ID);
  const c = calls(spy);
  expect(c.map((x) => x.method)).toEqual(['PATCH']);
  const body = JSON.parse(c[0].body);
  expect(body).toEqual({ status: 'ready', paid_amount: 50 });
  expect('notes' in body).toBe(false);
});

test('an update to the notes still keeps the items and history packed with them', async () => {
  const spy = mockFetch();
  const { supabase } = await import('./client');
  await supabase.from('orders').update({ notes: 'ملاحظة جديدة' }).eq('id', ID);
  const c = calls(spy);
  expect(c.map((x) => x.method)).toEqual(['GET', 'PATCH']);
  const notes: string = JSON.parse(c[1].body).notes;
  expect(notes.startsWith('__ORDER_METADATA_V2__:')).toBe(true);
  const meta = JSON.parse(notes.slice('__ORDER_METADATA_V2__:'.length));
  expect(meta.originalNotes).toBe('ملاحظة جديدة');
  expect(meta.items).toEqual([{ name: 'ثوب', qty: 1 }]);
  expect(meta.history).toEqual([{ status: 'pending', updatedAt: '2026-11-01T10:00:00Z' }]);
});
