/**
 * notifyOrderStatusChange — fire-and-forget call to the server after a
 * successful order status update, so any customer subscribed to that
 * order's public tracking page gets a push notification. Never touches the
 * status-update logic itself; callers just add one line after their
 * existing `supabase.from('orders').update(...)` succeeds. A failure here
 * (network blip, no subscription, FCM down) must never surface to the
 * cashier/tailor or make the status update look like it failed — see
 * seen-fault-isolation-task.md's "additive, defensive call" pattern.
 */
import { supabase } from '../lib/supabase/client';

export async function notifyOrderStatusChange(orderId: string): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;
    await fetch(`/api/orders/${orderId}/notify-status`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
  } catch (e) {
    console.warn('[notifyOrderStatusChange] non-fatal:', e);
  }
}

/**
 * Same fire-and-forget pattern as notifyOrderStatusChange, called once
 * right after a new order is successfully created (Orders.tsx, POS.tsx) --
 * pushes staff who opted in from their preferences menu (Phase 3). Never
 * touches order-creation logic and never fails it.
 */
export async function notifyNewOrderForStaff(orderId: string): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;
    await fetch(`/api/orders/${orderId}/notify-new-order`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
  } catch (e) {
    console.warn('[notifyNewOrderForStaff] non-fatal:', e);
  }
}
