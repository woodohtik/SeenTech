/**
 * "محل الاختبار الآلي" -- the test shop the golden paths run against
 * (seen-stability-guardrails-task.md, question 3).
 *
 * It exists only in a local, throw-away Supabase started by CI (`supabase
 * start`) -- never on staging or production, so no account is created on a
 * real service and no real data is touched. seed.ts builds it from nothing
 * before every run. The password is a test value for that local database
 * only.
 */
export const TEST_PASSWORD = 'Golden-Path-Test-1';

export const SHOP = {
  tenantId: '0e000000-0000-4000-8000-000000000001',
  branchId: '0e000000-0000-4000-8000-0000000000b1',
  name: 'محل الاختبار الآلي',
  vatNumber: '310000000000003',
} as const;

export const STAFF = {
  owner: { staffId: '0e000000-0000-4000-8000-0000000000c1', email: 'owner@golden.test', name: 'صاحب المحل', role: 'owner' },
  cashier: { staffId: '0e000000-0000-4000-8000-0000000000c2', email: 'cashier@golden.test', name: 'الكاشير', role: 'cashier' },
  tailor: { staffId: '0e000000-0000-4000-8000-0000000000c3', email: 'tailor@golden.test', name: 'الخياط', role: 'tailor' },
} as const;

export const CUSTOMER = { id: '0e000000-0000-4000-8000-0000000000e1', name: 'عميل الاختبار', phone: '0501111111' } as const;

export const FABRIC = { id: '0e000000-0000-4000-8000-0000000000f1', name: 'قطن الاختبار', stock: 100 } as const;
