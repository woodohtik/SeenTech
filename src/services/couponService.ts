import { supabase } from '../lib/supabase/client';

export interface Coupon {
  id: string;
  code: string;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  restricted_tenant_id: string | null;
  plan_id: string | null;
  max_redemptions: number | null;
  redemption_count: number;
  expires_at: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
}

export interface CreateCouponInput {
  code?: string;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  restricted_tenant_id?: string | null;
  plan_id?: string | null;
  max_redemptions?: number | null;
  expires_at?: string | null;
  notes?: string | null;
}

export interface CouponPreview {
  discount_amount: number;
  final_amount: number;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCouponCode(): string {
  let suffix = '';
  for (let i = 0; i < 6; i++) suffix += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return `OFF-${suffix}`;
}

export async function fetchCoupons(): Promise<Coupon[]> {
  const { data, error } = await supabase.from('coupons').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

/** Retries with a freshly generated code on a unique-constraint collision
 * only when the caller left `code` blank -- an explicit code the admin typed
 * is never silently swapped for a different one. */
export async function createCoupon(input: CreateCouponInput): Promise<Coupon> {
  const explicitCode = input.code?.trim().toUpperCase() || null;
  const attempts = explicitCode ? 1 : 4;
  let lastError: any = null;

  for (let i = 0; i < attempts; i++) {
    const code = explicitCode || generateCouponCode();
    const { data, error } = await supabase
      .from('coupons')
      .insert({
        code,
        discount_type: input.discount_type,
        discount_value: input.discount_value,
        restricted_tenant_id: input.restricted_tenant_id || null,
        plan_id: input.plan_id || null,
        max_redemptions: input.max_redemptions || null,
        expires_at: input.expires_at || null,
        notes: input.notes?.trim() || null,
      })
      .select()
      .single();

    if (!error) return data;
    if (error.code !== '23505') throw error;
    lastError = error;
  }
  throw lastError;
}

export async function setCouponActive(id: string, isActive: boolean): Promise<void> {
  const { error } = await supabase.from('coupons').update({ is_active: isActive }).eq('id', id);
  if (error) throw error;
}

export async function deleteCoupon(id: string): Promise<void> {
  const { error } = await supabase.from('coupons').delete().eq('id', id);
  if (error) throw error;
}

export async function previewCoupon(code: string, tenantId: string, planId: string): Promise<CouponPreview> {
  const { data, error } = await supabase.rpc('preview_coupon', {
    p_code: code,
    p_tenant_id: tenantId,
    p_plan_id: planId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return { discount_amount: Number(row?.discount_amount) || 0, final_amount: Number(row?.final_amount) || 0 };
}
