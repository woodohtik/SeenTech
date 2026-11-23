import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase/client', () => ({ supabase: {} }));

import { referralLink } from './referralService';
import { partnerReferralLink } from './partnerReferralService';
import { PUBLIC_SITE_URL } from '../constants/site';

// The shops' referral link was built on an old domain (seen.sa) that is not
// Seen's site; the partners' pointed at seentech.io. Both must land on the
// landing page, which carries ?ref= onto sign-up (LandingPage.tsx).
describe('referral links', () => {
  it('a shop’s link points at the public site', () => {
    expect(PUBLIC_SITE_URL).toBe('https://seentech.io');
    expect(referralLink('AB12CD')).toBe('https://seentech.io/?ref=AB12CD');
  });

  it('a partner’s link points at the same site', () => {
    expect(partnerReferralLink('P9X')).toBe('https://seentech.io/?ref=P9X');
  });

  it('no referral link is built on the old domain', () => {
    expect(referralLink('X')).not.toContain('seen.sa');
    expect(partnerReferralLink('X')).not.toContain('seen.sa');
  });
});
