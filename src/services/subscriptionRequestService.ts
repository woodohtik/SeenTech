import { supabase } from '../lib/supabase/client';

export interface SubscriptionRequest {
  id: string;
  tenant_id: string;
  tenant_name?: string;
  tenant_email?: string;
  plan_id: 'free' | 'basic';
  plan_name: string;
  amount: number;
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

export async function createSubscriptionRequest(
  data: Omit<SubscriptionRequest, 'id' | 'status' | 'created_at'>
): Promise<SubscriptionRequest> {
  const { data: row, error } = await supabase
    .from('subscription_requests')
    .insert({
      tenant_id: data.tenant_id,
      tenant_name: data.tenant_name || null,
      tenant_email: data.tenant_email || null,
      plan_id: data.plan_id,
      plan_name: data.plan_name,
      amount: data.amount,
      payment_method: data.payment_method,
      proof_url: data.proof_url || null,
      reference_no: data.reference_no || null,
      notes: data.notes || null,
    })
    .select()
    .single();

  if (error) throw error;
  return mapRow(row);
}

export async function fetchSubscriptionRequests(): Promise<SubscriptionRequest[]> {
  const { data, error } = await supabase
    .from('subscription_requests')
    .select('*')
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
