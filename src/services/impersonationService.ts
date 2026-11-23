import { supabase } from '../lib/supabase/client';

/**
 * seen-admin-reengineering-task.md بند 2 و9 -- دوال مشتركة لبدء/إنهاء الانتحال
 * بدل النسخ اليدوية المكرَّرة في SaaSLayout.tsx/Layout.tsx/AdminTailors.tsx/
 * SuperAdminDashboard.tsx. support_sessions مؤكَّد موجود وفعّال في schema cache
 * على staging والإنتاج (تحقَّق عبر `supabase migration list --linked` على كلا
 * المشروعين بتاريخ هذه المهمة)، فلا حاجة لمسار بديل يكتب في saas_settings.
 */

export type ImpersonationAccessType = 'stealth' | 'explicit';

/**
 * seen-readiness-fixes-task.md P6 (SECURITY-11): the session row is written
 * by the server (start_support_session), which also decides its type --
 * 'explicit' only on this admin's approved, unexpired request for this
 * shop, otherwise 'stealth'. The shop's owner sees every session. Returns
 * null when it could not be recorded (callers then do not continue).
 */
export async function startSupportSession(tenantId: string, requestId?: string): Promise<ImpersonationAccessType | null> {
  const { data, error } = await supabase.rpc('start_support_session', {
    p_tenant_id: tenantId,
    ...(requestId ? { p_request_id: requestId } : {}),
  });
  if (error) {
    console.error('[impersonation] Failed to record the support session:', error);
    return null;
  }
  return ((data as { access_type?: ImpersonationAccessType } | null)?.access_type) ?? null;
}

/** ينهي آخر سجل مفتوح (بلا ended_at) للمستخدم الحالي نفسه في هذا المستأجر،
 * عبر RPC يتحقق من الملكية (saas_user_id = المستخدم الحالي) على الخادم --
 * لا UPDATE مباشر بعد الآن، RLS لا يسمح به أصلاً (security audit 2026-10-25،
 * fingerprint support-sessions-actor-not-bound-to-auth-uid). */
export async function endImpersonation(tenantId: string): Promise<void> {
  try {
    const { error } = await supabase.rpc('end_impersonation_session', { p_tenant_id: tenantId });
    if (error) {
      console.error('[impersonation] Error ending support session:', error);
    }
  } catch (err) {
    console.error('[impersonation] Error ending support session:', err);
  }
}
