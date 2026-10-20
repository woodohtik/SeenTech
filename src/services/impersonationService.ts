import { supabase } from '../lib/supabase/client';

/**
 * seen-admin-reengineering-task.md بند 2 و9 -- دوال مشتركة لبدء/إنهاء الانتحال
 * بدل النسخ اليدوية المكرَّرة في SaaSLayout.tsx/Layout.tsx/AdminTailors.tsx/
 * SuperAdminDashboard.tsx. support_sessions مؤكَّد موجود وفعّال في schema cache
 * على staging والإنتاج (تحقَّق عبر `supabase migration list --linked` على كلا
 * المشروعين بتاريخ هذه المهمة)، فلا حاجة لمسار بديل يكتب في saas_settings.
 */

export type ImpersonationAccessType = 'stealth' | 'explicit';

interface ImpersonationActor {
  id: string;
  name: string;
}

/** يُدرج سجل support_sessions. يُرجع false عند فشل الإدراج -- المستدعي يقرر
 * هل يمنع المتابعة بلا سجل تدقيق (كما تفعل كل مسارات الانتحال الآن). */
export async function logImpersonationStart(
  tenantId: string,
  actor: ImpersonationActor,
  accessType: ImpersonationAccessType
): Promise<boolean> {
  const { error } = await supabase.from('support_sessions').insert({
    tenant_id: tenantId,
    saas_user_id: actor.id,
    saas_user_name: actor.name,
    access_type: accessType,
    started_at: new Date().toISOString(),
  });
  if (error) {
    console.error('[impersonation] Failed to log session start:', error);
    return false;
  }
  return true;
}

/** يجد آخر سجل مفتوح (بلا ended_at) لهذا المستأجر ويغلقه بمدة محسوبة فعلياً. */
export async function endImpersonation(tenantId: string): Promise<void> {
  try {
    const { data } = await supabase
      .from('support_sessions')
      .select('id, started_at')
      .eq('tenant_id', tenantId)
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) {
      const started = new Date(data.started_at);
      const ended = new Date();
      const durationMinutes = Math.ceil((ended.getTime() - started.getTime()) / 60000);
      await supabase
        .from('support_sessions')
        .update({ ended_at: ended.toISOString(), duration_minutes: durationMinutes })
        .eq('id', data.id);
    }
  } catch (err) {
    console.error('[impersonation] Error ending support session:', err);
  }
}
