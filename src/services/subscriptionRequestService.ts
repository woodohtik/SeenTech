import { supabase } from '../lib/supabase/client';

export interface SubscriptionRequest {
  id: string;
  tenant_id: string;
  tenant_name?: string;
  tenant_email?: string;
  plan_id: string;
  plan_name: string;
  amount: number;
  original_amount?: number;
  coupon_code?: string | null;
  discount_amount?: number;
  payment_method: 'bank_transfer' | 'card' | 'network' | 'cash';
  proof_url?: string | null;
  reference_no?: string | null;
  status: 'pending' | 'approved' | 'rejected';
  notes?: string | null;
  created_at: string;
  updated_at?: string;
  rejection_reason?: string | null;
}

function mapRow(d: any): SubscriptionRequest {
  return {
    id: d.id,
    tenant_id: d.tenant_id,
    tenant_name: d.tenant_name || undefined,
    tenant_email: d.tenant_email || undefined,
    plan_id: d.plan_id,
    plan_name: d.plan_name,
    amount: Number(d.amount) || 0,
    original_amount: d.original_amount != null ? Number(d.original_amount) : undefined,
    coupon_code: d.coupon_code || null,
    discount_amount: Number(d.discount_amount) || 0,
    payment_method: d.payment_method,
    proof_url: d.proof_url,
    reference_no: d.reference_no,
    status: d.status,
    notes: d.notes,
    created_at: d.created_at,
    updated_at: d.updated_at,
    rejection_reason: d.rejection_reason,
  };
}

export interface CreateSubscriptionRequestInput {
  tenant_id: string;
  tenant_name?: string;
  tenant_email?: string;
  plan_id: string;
  payment_method: SubscriptionRequest['payment_method'];
  proof_url?: string | null;
  reference_no?: string | null;
  notes?: string | null;
  coupon_code?: string | null;
}

export interface CreateSubscriptionRequestResult {
  id: string;
  amount: number;
  discount_amount: number;
  original_amount: number;
}

/** Routes through create_subscription_request() (SECURITY DEFINER) instead of
 * a raw insert -- the RPC computes amount from plans.price itself (and
 * validates/reserves any coupon) rather than trusting a client-supplied
 * amount. Returns the resulting row's amount/discount so the caller can show
 * the price actually applied without a second round-trip. See
 * supabase/migrations/20261101000000_subscription_coupons.sql and
 * 20261102000000_create_subscription_request_returns_amount.sql. */
export async function createSubscriptionRequest(data: CreateSubscriptionRequestInput): Promise<CreateSubscriptionRequestResult> {
  const { data: rows, error } = await supabase.rpc('create_subscription_request', {
    p_tenant_id: data.tenant_id,
    p_plan_id: data.plan_id,
    p_payment_method: data.payment_method,
    p_proof_url: data.proof_url || null,
    p_reference_no: data.reference_no || null,
    p_notes: data.notes || null,
    p_coupon_code: data.coupon_code || null,
    p_tenant_name: data.tenant_name || null,
    p_tenant_email: data.tenant_email || null,
  });
  if (error) throw error;
  const row = Array.isArray(rows) ? rows[0] : rows;
  return {
    id: row?.id,
    amount: Number(row?.amount) || 0,
    discount_amount: Number(row?.discount_amount) || 0,
    original_amount: Number(row?.original_amount) || 0,
  };
}

export async function fetchSubscriptionRequests(): Promise<SubscriptionRequest[]> {
  const { data, error } = await supabase
    .from('subscription_requests')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []).map(mapRow);
}

/** BillingSettings.tsx (صفحة إعدادات تاجر واحد) تحتاج طلباته هو فقط --
 * فلترة server-side بدل جلب كل طلبات كل التجّار (fetchSubscriptionRequests)
 * ثم التصفية في المتصفح، وهو ما يُشغِّل مسحاً كاملاً للجدول عبر كل المنصة
 * في كل مرة يفتح فيها تاجر عادي إعدادات اشتراكه. */
export async function fetchMySubscriptionRequests(tenantId: string): Promise<SubscriptionRequest[]> {
  const { data, error } = await supabase
    .from('subscription_requests')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []).map(mapRow);
}

/** Atomic via approve_subscription_request RPC -- locks the request row and
 * only proceeds if it's still 'pending', which is what actually prevents two
 * admins on different devices from both approving (and double-crediting)
 * the same request. See supabase/migrations/20260908050000_subscription_requests_table.sql. */
export async function approveSubscriptionRequest(requestId: string): Promise<void> {
  const { error } = await supabase.rpc('approve_subscription_request', { p_request_id: requestId });
  if (error) throw error;
}

export async function rejectSubscriptionRequest(requestId: string, reason?: string): Promise<void> {
  const { error } = await supabase.rpc('reject_subscription_request', {
    p_request_id: requestId,
    p_reason: reason || null,
  });
  if (error) throw error;
}
