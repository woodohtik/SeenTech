/**
 * activationService — قراءة/تسجيل طبقة التفعيل والصحّة (إطار Reforge).
 * SQL: ANALYTICS_instrumentation.sql (tenant_activation + الـViews).
 * مصدر داشبورد السوبر أدمن، ومنطق at-risk/التوسّع داخل التطبيق.
 */
import { supabase } from '../lib/supabase/client';

export interface Activation {
  tenant_id: string; signup_at: string; setup_at?: string|null;
  aha_at?: string|null; habit_at?: string|null; active_days: number; last_active_at?: string|null;
  first_invoice_at?: string|null;
}
export interface Health { tenant_id: string; health_score: number; at_risk: boolean; actions_7d: number; breadth: number; last_active_at?: string|null; }

/** يُستدعى عند إكمال التهيئة (Setup Moment). */
export async function markSetup(tenantId: string): Promise<void> {
  const { error } = await supabase.rpc('mark_setup', { p_tenant: tenantId });
  if (error) console.warn('[activation] mark_setup failed:', error.message);
}

export async function getActivation(tenantId: string): Promise<Activation | null> {
  const { data } = await supabase.from('tenant_activation').select('*').eq('tenant_id', tenantId).maybeSingle();
  return (data as Activation) || null;
}

export async function getHealth(tenantId: string): Promise<Health | null> {
  const { data } = await supabase.from('v_tenant_health').select('*').eq('tenant_id', tenantId).maybeSingle();
  return (data as Health) || null;
}

/** قائمة المحلات المعرّضة للتسرّب (للتواصل الاستباقي / السوبر أدمن). */
export async function listAtRisk(limit = 50): Promise<Health[]> {
  const { data } = await supabase.from('v_tenant_health').select('*').eq('at_risk', true)
    .order('health_score', { ascending: true }).limit(limit);
  return (data || []) as Health[];
}

/** توزيع الإحياء: active / non_activated / dormant / churned. */
export async function getResurrectionBreakdown(): Promise<Record<string, number>> {
  const { data } = await supabase.from('v_resurrection_segment').select('segment');
  const out: Record<string, number> = { active:0, non_activated:0, dormant:0, churned:0 };
  (data || []).forEach((r: any) => { out[r.segment] = (out[r.segment]||0) + 1; });
  return out;
}

/** ملخّص النجم الشمالي WOMS. */
export async function getWomsSummary(): Promise<{ total: number; woms: number }> {
  const { data } = await supabase.from('v_woms').select('is_woms');
  const rows = data || [];
  return { total: rows.length, woms: rows.filter((r: any) => r.is_woms).length };
}

/** محلات ناضجة في Engagement — مرشّحة لعرض إضافات/فروع. */
export async function listExpansionCandidates(limit = 50): Promise<Health[]> {
  const { data } = await supabase.from('v_expansion_candidates').select('*')
    .order('health_score', { ascending: false }).limit(limit);
  return (data || []) as Health[];
}
