/**
 * partnerReferralService — برنامج شركاء الإحالة (موازٍ تماماً لـreferralService.ts،
 * بلا أي تعديل عليه أو على جداوله)
 * -----------------------------------------------------------------------
 * حساب شريك إحالة مستقل عن التجار يُحيل تجاراً جدداً لسِين. نفس أرقام برنامج
 * إحالة التجار: 300 ر.س لكل إحالة مؤهَّلة (اشتراك فعلي خلال 30 يوماً)، سحب
 * عند تجاوز 1000 ر.س، مراجعة إدارية يدوية.
 * SQL: supabase/migrations/20261110000001_referral_partner_accounts.sql
 * Spec: docs/superpowers/specs/2026-11-10-referral-partner-accounts-design.md
 */

import { supabase } from '../lib/supabase/client';

export const REWARD_PER_PARTNER_REFERRAL = 300;
export const MIN_PARTNER_WITHDRAWAL = 1000;
export const SITE = 'https://seen.sa';

export interface PartnerWallet { balance: number; total_earned: number; }
export interface PartnerReferralRow { id: string; referred_tenant_id: string; reward_amount: number; status: string; created_at: string; qualified_until?: string; credited_at?: string; }
export interface PartnerWithdrawal { id: string; partner_id?: string; amount: number; iban?: string; beneficiary?: string; status: string; admin_note?: string; requested_at: string; processed_at?: string; }
export interface PartnerReferralProgramSettings { enabled: boolean; rewardPerReferral: number; minWithdrawal: number; }

/** إعدادات برنامج شركاء الإحالة -- saas_settings['partner_referral_program'] (مستقل عن 'referral_program'). */
export async function getPartnerReferralProgramSettings(): Promise<PartnerReferralProgramSettings> {
  const { data } = await supabase.from('saas_settings').select('value').eq('key', 'partner_referral_program').maybeSingle();
  return {
    enabled: data?.value?.enabled !== false,
    rewardPerReferral: Number(data?.value?.rewardPerReferral) || REWARD_PER_PARTNER_REFERRAL,
    minWithdrawal: Number(data?.value?.minWithdrawal) || MIN_PARTNER_WITHDRAWAL,
  };
}

/**
 * يُنشئ صف referral_partners جديداً للمستخدم الحالي عبر RPC (لا إدراج مباشر من
 * العميل -- RLS على الجدول عمداً لا تسمح بذلك، ومنع العميل من فرض status/referral_code
 * خاصة به بنفسه، انظر register_referral_partner في المايجريشن).
 */
export async function registerReferralPartner(name: string, email: string, phone: string | null): Promise<string> {
  const { data, error } = await supabase.rpc('register_referral_partner', { p_name: name, p_email: email, p_phone: phone });
  if (error) throw error;
  return data as string;
}

/** يضمن وجود كود إحالة للشريك ويُرجعه. */
export async function ensurePartnerReferralCode(partnerId: string): Promise<string> {
  const { data, error } = await supabase.rpc('ensure_partner_referral_code', { p_partner: partnerId });
  if (error) throw error;
  return data as string;
}

export function partnerReferralLink(code: string): string {
  return `${SITE}/?ref=${code}`;
}

export async function getPartnerWallet(partnerId: string): Promise<PartnerWallet> {
  const { data } = await supabase.from('partner_wallets').select('balance,total_earned').eq('partner_id', partnerId).maybeSingle();
  return { balance: Number(data?.balance || 0), total_earned: Number(data?.total_earned || 0) };
}

export async function listPartnerReferrals(partnerId: string): Promise<PartnerReferralRow[]> {
  const { data } = await supabase.from('partner_referrals').select('*').eq('partner_id', partnerId).order('created_at', { ascending: false });
  return (data || []) as PartnerReferralRow[];
}

/** يُستدعى من تدفّق تسجيل تاجر جديد عند وجود ?ref=CODE (يسجّل إحالة «معلّقة» عبر نظام الشركاء -- تُحتسب عند اشتراك المُحال). */
export async function recordReferralOnPartnerSignup(refCode: string, referredTenantId: string): Promise<void> {
  if (!refCode) return;
  const { error } = await supabase.rpc('record_partner_referral', { p_ref_code: refCode, p_referred_tenant: referredTenantId });
  if (error) console.warn('[partner-referral] record failed:', error.message);
}

/** طلب سحب (يتطلّب رصيد > 1000). */
export async function requestPartnerWithdrawal(partnerId: string, amount: number, iban: string, beneficiary: string): Promise<string> {
  const { data, error } = await supabase.rpc('request_partner_withdrawal', { p_partner: partnerId, p_amount: amount, p_iban: iban, p_beneficiary: beneficiary });
  if (error) throw error;
  return data as string;
}

export async function listMyPartnerWithdrawals(partnerId: string): Promise<PartnerWithdrawal[]> {
  const { data } = await supabase.from('partner_withdrawal_requests').select('*').eq('partner_id', partnerId).order('requested_at', { ascending: false });
  return (data || []) as PartnerWithdrawal[];
}

// ---------- إدارة (داشبورد سين) ----------
export async function listPendingPartnerWithdrawals(): Promise<PartnerWithdrawal[]> {
  const { data, error } = await supabase.rpc('list_pending_partner_withdrawals');
  if (error) throw error;
  return (data || []) as PartnerWithdrawal[];
}

export async function processPartnerWithdrawal(requestId: string, approve: boolean, note = ''): Promise<void> {
  const { error } = await supabase.rpc('process_partner_withdrawal', { p_request: requestId, p_approve: approve, p_note: note });
  if (error) throw error;
}
