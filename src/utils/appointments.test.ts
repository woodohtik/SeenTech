import { describe, expect, it } from 'vitest';
import { appointmentKindsFor, appointmentReminder, countFittings } from './appointments';

// seen-open-verticals-task.md, wave 1 (shared item 2).
describe('appointments', () => {
  it("each vertical's kinds: fittings for women's tailoring; visits and installation for furniture", () => {
    expect(appointmentKindsFor('womens_tailoring')).toEqual(['fitting', 'pickup', 'other']);
    expect(appointmentKindsFor('furniture')).toEqual(['measurement_visit', 'pickup', 'delivery', 'installation', 'other']);
    expect(appointmentKindsFor('mens_tailoring')).toEqual(['fitting', 'other']);
  });

  it('the reminder names the customer, what and when', () => {
    const t = (k: string, o?: Record<string, unknown>) => `${k}|${JSON.stringify(o ?? {})}`;
    const text = appointmentReminder(t, { kind: 'fitting', starts_at: '2027-02-10T16:30:00+03:00' }, 'نورة', 'ar');
    expect(text).toContain('appointments.reminder');
    expect(text).toContain('نورة');
    expect(text).toContain('appointments.kind.fitting');
  });

  it("an order's fittings: the ones not cancelled", () => {
    expect(countFittings([{ kind: 'fitting', status: 'done' }, { kind: 'fitting', status: 'cancelled' }, { kind: 'pickup', status: 'scheduled' }, { kind: 'fitting', status: 'scheduled' }])).toBe(2);
  });
});
