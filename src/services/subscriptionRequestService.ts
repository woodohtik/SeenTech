import i18n from 'i18next';
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

const STORAGE_KEY = 'seen_subscription_requests';

function getLocalRequests(): SubscriptionRequest[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Failed to parse local subscription requests:', e);
    return [];
  }
}

function saveLocalRequests(requests: SubscriptionRequest[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(requests));
    window.dispatchEvent(new Event('subscription_request_updated'));
  } catch (e) {
    console.error('Failed to save local subscription requests:', e);
  }
}

export async function createSubscriptionRequest(
  data: Omit<SubscriptionRequest, 'id' | 'status' | 'created_at'>
): Promise<SubscriptionRequest> {
  const newReq: SubscriptionRequest = {
    ...data,
    id: `SUB-REQ-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    status: 'pending',
    created_at: new Date().toISOString(),
  };

  // 1. Save to localStorage
  const local = getLocalRequests();
  local.unshift(newReq);
  saveLocalRequests(local);

  // 2. Try saving to Supabase payments table for durability across devices
  try {
    const notePayload = `[SUB_REQ] ${JSON.stringify({
      req_id: newReq.id,
      plan_id: newReq.plan_id,
      plan_name: newReq.plan_name,
      tenant_name: newReq.tenant_name,
      tenant_email: newReq.tenant_email,
      proof_url: newReq.proof_url || null,
      status: 'pending',
      notes: newReq.notes || ''
    })}`;

    await supabase.from('payments').insert({
      tenant_id: newReq.tenant_id,
      amount: newReq.amount,
      method: newReq.payment_method,
      reference: newReq.reference_no || newReq.id,
      received_at: newReq.created_at,
      notes: notePayload,
    });
  } catch (err) {
    console.warn('Could not insert subscription request to Supabase payments table:', err);
  }

  return newReq;
}

export async function fetchSubscriptionRequests(): Promise<SubscriptionRequest[]> {
  const localRequests = getLocalRequests();
  const requestsMap = new Map<string, SubscriptionRequest>();

  localRequests.forEach(req => requestsMap.set(req.id, req));

  // Also try fetching from Supabase payments
  try {
    const { data: dbPayments } = await supabase
      .from('payments')
      .select('*, tenants(name, owner_email)')
      .order('received_at', { ascending: false });

    if (dbPayments) {
      dbPayments.forEach((pay: any) => {
        if (pay.notes && typeof pay.notes === 'string' && pay.notes.startsWith('[SUB_REQ]')) {
          try {
            const rawJson = pay.notes.replace('[SUB_REQ]', '').trim();
            const parsed = JSON.parse(rawJson);
            const reqId = parsed.req_id || pay.id;

            // If local request has newer or updated status, keep local update; otherwise use DB
            if (!requestsMap.has(reqId)) {
              requestsMap.set(reqId, {
                id: reqId,
                tenant_id: pay.tenant_id,
                tenant_name: parsed.tenant_name || pay.tenants?.name || i18n.t('saas.default_subscriber_name'),
                tenant_email: parsed.tenant_email || pay.tenants?.owner_email || '',
                plan_id: parsed.plan_id || 'basic',
                plan_name: parsed.plan_name || i18n.t('billing.plans.basic.name'),
                amount: Number(pay.amount) || 599,
                payment_method: pay.method || 'bank_transfer',
                proof_url: parsed.proof_url || null,
                reference_no: pay.reference || null,
                status: parsed.status || 'pending',
                notes: parsed.notes || null,
                created_at: pay.received_at || new Date().toISOString(),
                rejection_reason: parsed.rejection_reason || null,
              });
            }
          } catch (e) {
            // Ignore non-json sub_req notes
          }
        }
      });
    }
  } catch (err) {
    console.warn('Error fetching subscription requests from Supabase:', err);
  }

  const result = Array.from(requestsMap.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return result;
}

export async function approveSubscriptionRequest(
  requestId: string,
  tenantId: string,
  planId: 'free' | 'basic'
): Promise<boolean> {
  const local = getLocalRequests();
  const reqIndex = local.findIndex(r => r.id === requestId);
  const req = local[reqIndex];

  const now = new Date();
  const nextYear = new Date(now);
  nextYear.setFullYear(now.getFullYear() + 1);

  // 1. Update Tenant in Supabase
  try {
    await supabase
      .from('tenants')
      .update({
        plan_id: planId,
        status: 'active',
        subscription_end_date: nextYear.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq('id', tenantId);

    // Record official completed payment
    if (planId === 'basic') {
      await supabase.from('payments').insert({
        tenant_id: tenantId,
        amount: 599,
        method: req?.payment_method || 'bank_transfer',
        received_at: now.toISOString(),
        notes: `سداد وتفعيل اشتراك الباقة الأساسية (معتمد من السوبر أدمن)`,
        reference: req?.reference_no || `APPROVED-${Date.now().toString().slice(-6)}`,
      });
    }
  } catch (err) {
    console.error('Failed to update tenant subscription in DB:', err);
  }

  // 2. Update request status in local storage
  if (reqIndex !== -1) {
    local[reqIndex].status = 'approved';
    local[reqIndex].updated_at = now.toISOString();
    saveLocalRequests(local);
  } else {
    // If request wasn't local, add it as approved
    local.unshift({
      id: requestId,
      tenant_id: tenantId,
      plan_id: planId,
      plan_name: planId === 'basic' ? i18n.t('billing.plans.basic.name') : i18n.t('billing.plans.free.short_name'),
      amount: planId === 'basic' ? 599 : 0,
      payment_method: 'bank_transfer',
      status: 'approved',
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    });
    saveLocalRequests(local);
  }

  return true;
}

export async function rejectSubscriptionRequest(
  requestId: string,
  reason?: string
): Promise<boolean> {
  const local = getLocalRequests();
  const reqIndex = local.findIndex(r => r.id === requestId);
  const now = new Date().toISOString();

  if (reqIndex !== -1) {
    local[reqIndex].status = 'rejected';
    local[reqIndex].rejection_reason = reason || i18n.t('subscription.request_rejected_by_admin');
    local[reqIndex].updated_at = now;
    saveLocalRequests(local);
  }

  return true;
}
