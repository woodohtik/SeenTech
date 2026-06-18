/**
 * trialService — منطق التجربة المجانية PLG (14 يوم)
 * --------------------------------------------------
 * يربط تدفّق التسجيل بنظام التجربة: بدء التجربة، زرع بيانات تجريبية للـ tenant،
 * التقاط الـ lead، وحساب حالة التجربة للعرض في الواجهة.
 *
 * SQL المطلوب: PLG_trial_lifecycle.sql (الدوال start_tenant_trial / activate_tenant_subscription).
 */

import { supabase } from '../lib/supabase/client';

export const TRIAL_DAYS = 14;

export interface TrialStatus {
  status: 'trial' | 'active' | 'locked' | 'purge_pending' | 'unknown';
  daysLeft: number;
  hoursLeft: number;
  ended: boolean;
}

/** يبدأ تجربة 14 يوم للـ tenant (يستدعي دالة SQL). */
export async function startTrial(tenantId: string, days = TRIAL_DAYS): Promise<void> {
  const { error } = await supabase.rpc('start_tenant_trial', { p_tenant_id: tenantId, p_days: days });
  if (error) throw error;
}

/** يفعّل الاشتراك الدائم بعد الدفع (يستدعي دالة SQL). */
export async function activateSubscription(tenantId: string): Promise<void> {
  const { error } = await supabase.rpc('activate_tenant_subscription', { p_tenant_id: tenantId });
  if (error) throw error;
}

/** يلتقط lead عند التسجيل (يربطه بالـ tenant، الحالة 'trial'). */
export async function captureTrialLead(input: {
  name: string; phone: string; email?: string; businessType?: string; tenantId?: string;
}): Promise<void> {
  const { error } = await supabase.from('leads').insert({
    name: input.name, phone: input.phone, email: input.email,
    business_type: input.businessType, tenant_id: input.tenantId,
    source: 'trial_signup', status: 'trial', created_at: new Date().toISOString(),
  });
  if (error) console.warn('[trialService] lead capture failed:', error.message);
}

/** يزرع بيانات تجريبية موحّدة داخل tenant التجربة (عميل يبدأ بمنتج غير فارغ). */
export async function seedTrialData(tenantId: string): Promise<void> {
  const now = Date.now();
  const { data: customers } = await supabase.from('customers').insert([
    { name: 'محمد العتيبي', phone: '0599999999', tenant_id: tenantId, measurements: { length: 150, shoulder: 45, chest: 100 }, is_test: true, created_at: new Date().toISOString() },
    { name: 'فهد الشمري', phone: '0588888888', tenant_id: tenantId, measurements: { length: 155, shoulder: 48, chest: 110 }, is_test: true, created_at: new Date().toISOString() },
  ]).select();

  await supabase.from('inventory_items').insert([
    { name: 'قماش قطن أبيض', category: 'fabric', quantity: 50, unit: 'meter', base_unit: 'meter', sku: 'COT-WHT', min_threshold: 10, price_per_unit: 45, tenant_id: tenantId, is_test: true, updated_at: new Date().toISOString() },
    { name: 'أزرار صدف', category: 'button', quantity: 500, unit: 'box', base_unit: 'piece', sku: 'BTN-SDF', min_threshold: 50, price_per_unit: 2, tenant_id: tenantId, is_test: true, updated_at: new Date().toISOString() },
  ]);

  if (customers && customers.length) {
    await supabase.from('orders').insert([
      { customer_id: customers[0].id, customer_name: customers[0].name, tenant_id: tenantId, items: [{ garmentType: 'ثوب', fabric: 'قطن', quantity: 1, price: 250 }], total_amount: 250, paid_amount: 250, status: 'delivered', is_test: true, order_date: new Date(now - 5 * 86400000).toISOString(), delivery_date: new Date().toISOString() },
      { customer_id: customers[1].id, customer_name: customers[1].name, tenant_id: tenantId, items: [{ garmentType: 'بشت', fabric: 'يدوي', quantity: 1, price: 1200 }], total_amount: 1200, paid_amount: 500, status: 'sewing', is_test: true, order_date: new Date().toISOString(), delivery_date: new Date(now + 14 * 86400000).toISOString() },
    ]);
  }
}

/** يحسب حالة التجربة للعرض (شريط العدّاد / شاشة القفل). */
export function computeTrialStatus(tenant: { subscription_status?: string | null; trial_ends_at?: string | null }): TrialStatus {
  const status = (tenant.subscription_status as TrialStatus['status']) || 'unknown';
  if (status !== 'trial' || !tenant.trial_ends_at) {
    return { status, daysLeft: 0, hoursLeft: 0, ended: status === 'locked' || status === 'purge_pending' };
  }
  const ms = new Date(tenant.trial_ends_at).getTime() - Date.now();
  if (ms <= 0) return { status, daysLeft: 0, hoursLeft: 0, ended: true };
  return { status, daysLeft: Math.floor(ms / 86400000), hoursLeft: Math.floor((ms % 86400000) / 3600000), ended: false };
}

/**
 * يفحص إن سبق لهذا الجوال/الإيميل أخذ تجربة مجانية (لمنع إعادة الاستغلال).
 * استدعِه في تدفّق التسجيل قبل startTrial: إن أرجع true → لا تمنح تجربة جديدة، وجّه العميل لصفحة الاشتراك.
 */
export async function hasUsedTrial(phone?: string, email?: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('has_used_trial', { p_phone: phone || null, p_email: email || null });
  if (error) { console.warn('[trialService] has_used_trial failed:', error.message); return false; }
  return Boolean(data);
}
