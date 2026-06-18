/**
 * referralService — برنامج الإحالة (Referral)
 * --------------------------------------------
 * رابط إحالة لكل عميل · 300 ر.س تُمنَح عند اشتراك المُحال (لا مجرد تسجيله) وخلال 30 يوماً من تسجيله.
 * سحب عند تجاوز 1000 (مراجعة يدوية في داشبورد سين).
 * SQL المطلوب: REFERRAL_program.sql.
 */

import { supabase } from '../lib/supabase/client';

export const REWARD_PER_REFERRAL = 300;
export const MIN_WITHDRAWAL = 1000;   // السحب متاح عند تجاوز هذا المبلغ (فوق 1000)
export const SITE = 'https://seen.sa';

export interface Wallet { balance: number; total_earned: number; }
export interface ReferralRow { id: string; referred_tenant_id: string; reward_amount: number; status: string; created_at: string; qualified_until?: string; credited_at?: string; }
export interface Withdrawal { id: string; tenant_id?: string; amount: number; iban?: string; beneficiary?: string; status: string; admin_note?: string; requested_at: string; processed_at?: string; }

/** يضمن وجود كود إحالة للمحل ويُرجعه. */
export async function ensureReferralCode(tenantId: string): Promise<string> {
  const { data, error } = await supabase.rpc('ensure_referral_code', { p_tenant: tenantId });
  if (error) throw error;
  return data as string;
}

export function referralLink(code: string): string {
  return `${SITE}/?ref=${code}`;
}

export async function getWallet(tenantId: string): Promise<Wallet> {
  const { data } = await supabase.from('referral_wallets').select('balance,total_earned').eq('tenant_id', tenantId).maybeSingle();
  return { balance: Number(data?.balance || 0), total_earned: Number(data?.total_earned || 0) };
}

export async function listReferrals(tenantId: string): Promise<ReferralRow[]> {
  const { data } = await supabase.from('referrals').select('*').eq('referrer_tenant_id', tenantId).order('created_at', { ascending: false });
  return (data || []) as ReferralRow[];
}

/** يُستدعى من تدفّق التسجيل عند وجود ?ref=CODE (يسجّل إحالة «معلّقة» — تُحتسب عند اشتراك المُحال). */
export async function recordReferralOnSignup(refCode: string, referredTenantId: string): Promise<void> {
  if (!refCode) return;
  const { error } = await supabase.rpc('record_referral', { p_ref_code: refCode, p_referred_tenant: referredTenantId });
  if (error) console.warn('[referral] record failed:', error.message);
}

/** طلب سحب (يتطلّب رصيد ≥ 1500). */
export async function requestWithdrawal(tenantId: string, amount: number, iban: string, beneficiary: string): Promise<string> {
  const { data, error } = await supabase.rpc('request_withdrawal', { p_tenant: tenantId, p_amount: amount, p_iban: iban, p_beneficiary: beneficiary });
  if (error) throw error;
  return data as string;
}

export async function listMyWithdrawals(tenantId: string): Promise<Withdrawal[]> {
  const { data } = await supabase.from('withdrawal_requests').select('*').eq('tenant_id', tenantId).order('requested_at', { ascending: false });
  return (data || []) as Withdrawal[];
}

// ---------- إدارة (داشبورد سين) ----------
export async function listPendingWithdrawals(): Promise<Withdrawal[]> {
  const { data } = await supabase.from('withdrawal_requests').select('*').eq('status', 'pending').order('requested_at', { ascending: true });
  return (data || []) as Withdrawal[];
}

export async function processWithdrawal(requestId: string, approve: boolean, note = ''): Promise<void> {
  const { error } = await supabase.rpc('process_withdrawal', { p_request: requestId, p_approve: approve, p_note: note });
  if (error) throw error;
}
