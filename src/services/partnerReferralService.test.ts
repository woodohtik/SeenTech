import { test, expect, vi, beforeEach } from 'vitest';

const fromMock = vi.fn();
const rpcMock = vi.fn();
vi.mock('../lib/supabase/client', () => ({
  supabase: {
    from: (...args: any[]) => fromMock(...args),
    rpc: (...args: any[]) => rpcMock(...args),
  },
}));

import { requestPartnerWithdrawal, recordReferralOnPartnerSignup, registerReferralPartner } from './partnerReferralService';

beforeEach(() => {
  fromMock.mockReset();
  rpcMock.mockReset();
});

test('requestPartnerWithdrawal forwards amount/iban/beneficiary to request_partner_withdrawal RPC and returns its id', async () => {
  rpcMock.mockResolvedValue({ data: 'wd-123', error: null });
  const id = await requestPartnerWithdrawal('partner-1', 1500, 'SA0000000000000000000000', 'فلان');
  expect(rpcMock).toHaveBeenCalledWith('request_partner_withdrawal', {
    p_partner: 'partner-1', p_amount: 1500, p_iban: 'SA0000000000000000000000', p_beneficiary: 'فلان',
  });
  expect(id).toBe('wd-123');
});

test('requestPartnerWithdrawal throws when the RPC returns an error (e.g. below minimum)', async () => {
  rpcMock.mockResolvedValue({ data: null, error: { message: 'الحد الأدنى للسحب أكثر من 1000 ر.س' } });
  await expect(requestPartnerWithdrawal('partner-1', 500, 'SA0', 'فلان')).rejects.toBeTruthy();
});

test('recordReferralOnPartnerSignup calls record_partner_referral with the code and tenant id, and swallows RPC errors', async () => {
  rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } });
  await expect(recordReferralOnPartnerSignup('P1A2B3', 'tenant-9')).resolves.toBeUndefined();
  expect(rpcMock).toHaveBeenCalledWith('record_partner_referral', { p_ref_code: 'P1A2B3', p_referred_tenant: 'tenant-9' });
});

test('recordReferralOnPartnerSignup is a no-op when refCode is empty', async () => {
  await recordReferralOnPartnerSignup('', 'tenant-9');
  expect(rpcMock).not.toHaveBeenCalled();
});

test('registerReferralPartner forwards name/email/phone to register_referral_partner RPC and returns the new partner id', async () => {
  rpcMock.mockResolvedValue({ data: 'partner-9', error: null });
  const id = await registerReferralPartner('فلان الفلاني', 'f@example.com', '0500000000');
  expect(rpcMock).toHaveBeenCalledWith('register_referral_partner', {
    p_name: 'فلان الفلاني', p_email: 'f@example.com', p_phone: '0500000000',
  });
  expect(id).toBe('partner-9');
});

test('registerReferralPartner throws when the RPC returns an error (e.g. duplicate email)', async () => {
  rpcMock.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "referral_partners_email_key"' } });
  await expect(registerReferralPartner('فلان', 'dup@example.com', null)).rejects.toMatchObject({ code: '23505' });
});
