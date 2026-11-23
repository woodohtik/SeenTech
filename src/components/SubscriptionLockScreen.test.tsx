// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// seen-readiness-fixes-task.md P5 (PLATFORM-02, PLATFORM-03).
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o?.date ? `${k}:${o.date}` : k), i18n: { language: 'ar' } }) }));
vi.mock('./BillingSettings', () => ({ default: ({ tenantId }: { tenantId: string }) => <div>billing for {tenantId}</div> }));
vi.mock('../lib/direction', () => ({ localeOf: () => 'en-GB' }));

import SubscriptionLockScreen from './SubscriptionLockScreen';

afterEach(cleanup);
const tenant = { id: 't1', name: 'محل', owner_uid: 'owner', is_trial: true, purge_at: '2026-12-20T00:00:00Z' };

describe('the lock screen', () => {
  it('lets the owner open the billing page in place', async () => {
    render(<SubscriptionLockScreen tenant={tenant} userId="owner" kind="trial" dir="rtl" onLogout={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'subscription.lock_renew_now' }));
    expect(await screen.findByText('billing for t1')).toBeTruthy();
  });

  it('a staff member is told to ask the owner, and has no renew button', () => {
    render(<SubscriptionLockScreen tenant={tenant} userId="cashier" kind="trial" dir="rtl" onLogout={() => {}} />);
    expect(screen.queryByRole('button', { name: 'subscription.lock_renew_now' })).toBeNull();
    expect(screen.getByText('subscription.lock_ask_owner')).toBeTruthy();
  });

  it('a trial shop is told when its data will be deleted; support is the platform address', () => {
    render(<SubscriptionLockScreen tenant={tenant} userId="owner" kind="trial" dir="rtl" onLogout={() => {}} />);
    expect(screen.getByRole('alert').textContent).toContain('subscription.lock_purge_warning:20 December 2026');
    const mail = screen.getByRole('link', { name: 'subscription.lock_contact_support' }).getAttribute('href') || '';
    expect(mail.startsWith('mailto:info@seentech.io')).toBe(true);
    expect(mail).not.toContain('gmail');
  });
});
