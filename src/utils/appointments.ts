/**
 * Appointments (seen-open-verticals-task.md, wave 1, shared item 2): their
 * kinds per vertical, the WhatsApp reminder's text, and an order's fittings.
 */
export type AppointmentKind = 'fitting' | 'measurement_visit' | 'pickup' | 'delivery' | 'installation' | 'other';
export type AppointmentStatus = 'scheduled' | 'done' | 'cancelled' | 'no_show';

export interface Appointment {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  order_id: string | null;
  kind: AppointmentKind;
  starts_at: string;
  duration_min: number;
  address: string | null;
  staff_id: string | null;
  status: AppointmentStatus;
  notes: string | null;
}

export function appointmentKindsFor(vertical: string | null | undefined): AppointmentKind[] {
  if (vertical === 'womens_tailoring') return ['fitting', 'pickup', 'other'];
  if (vertical === 'furniture') return ['measurement_visit', 'pickup', 'delivery', 'installation', 'other'];
  return ['fitting', 'other'];
}

type T = (key: string, options?: Record<string, unknown>) => string;

/** The reminder's text: «تذكير يا نورة: بروفة يوم الأربعاء 10 فبراير الساعة 4:30 م». */
export function appointmentReminder(t: T, a: Pick<Appointment, 'kind' | 'starts_at'>, customerName: string, locale: string): string {
  const when = new Date(a.starts_at);
  const date = when.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
  const time = when.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  return t('appointments.reminder', { name: customerName, kind: t(`appointments.kind.${a.kind}`), date, time });
}

/** How many fittings an order has had or has booked (cancelled ones aside). */
export function countFittings(list: ReadonlyArray<Pick<Appointment, 'kind' | 'status'>>): number {
  return list.filter((a) => a.kind === 'fitting' && a.status !== 'cancelled').length;
}
