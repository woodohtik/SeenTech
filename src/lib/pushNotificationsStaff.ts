/**
 * pushNotificationsStaff.ts — FCM Web Push opt-in for a signed-in staff
 * member (seen-companion-app-task_1.md, Phase 3), split out of
 * pushNotifications.ts so that file (shared with the standalone customer
 * Android app build) never has to bundle the Supabase client.
 */
import { acquireFcmToken, type SubscribeResult } from './pushNotifications';
import { supabase } from './supabase/client';

export async function subscribeStaffToNewOrderNotifications(): Promise<SubscribeResult> {
  try {
    const acquired = await acquireFcmToken();
    if ('unsupported' in acquired) return 'unsupported';
    if ('denied' in acquired) return 'denied';
    if ('error' in acquired) return 'error';

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return 'error';

    const res = await fetch('/api/staff/push-subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ fcmToken: acquired.token }),
    });
    return res.ok ? 'granted' : 'error';
  } catch (e) {
    console.error('[pushNotificationsStaff] subscribe failed:', e);
    return 'error';
  }
}
