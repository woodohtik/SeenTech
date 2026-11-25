// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ar from '../i18n/locales/ar.json';

// seen-login-error-messages-task.md: a failed connection on the sign-in
// screen shows one sentence, the code and two buttons -- never a link.
const signInWithPassword = vi.fn();
vi.mock('../lib/supabase/client', () => ({
  supabase: { auth: { signInWithPassword: (...a: unknown[]) => signInWithPassword(...a), signOut: vi.fn() }, from: vi.fn() },
}));
vi.mock('../lib/logger', () => ({ logError: vi.fn() }));
vi.mock('./BuildStamp', () => ({ default: () => null }));
vi.mock('./Branding', () => ({ default: () => null }));
vi.mock('./LoginHeroDecor', () => ({ default: () => null }));
vi.mock('../services/referralService', () => ({ recordReferralOnSignup: vi.fn() }));
vi.mock('../services/partnerReferralService', () => ({ recordReferralOnPartnerSignup: vi.fn() }));

import Login from './Login';

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ lng: 'ar', resources: { ar: { translation: ar } }, interpolation: { escapeValue: false } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); signInWithPassword.mockReset(); });

async function signInWith(email: string) {
  render(<MemoryRouter initialEntries={['/login']}><Login /></MemoryRouter>);
  fireEvent.change(screen.getByPlaceholderText(ar.login.email_or_phone_placeholder), { target: { value: email } });
  fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'Secret123' } });
  fireEvent.submit(screen.getByPlaceholderText('••••••••').closest('form')!);
  return screen.findByRole('alert');
}

describe('sign-in errors on screen', () => {
  it('"Failed to fetch" while this site answers: NET-01, another network, no link', async () => {
    signInWithPassword.mockRejectedValue(new TypeError('Failed to fetch'));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    const alert = await signInWith('owner@shop.test');
    await waitFor(() => expect(alert.textContent).toContain(ar.login.errors.friendly.blocked));
    expect(alert.textContent).toContain('NET-01');
    expect(alert.textContent).not.toMatch(/supabase|https?:|قاعدة البيانات/i);
    expect(document.body.textContent).not.toContain('supabase.co');
    expect(screen.getByRole('button', { name: ar.login.error_help.retry })).toBeTruthy();
    expect(screen.getByRole('button', { name: ar.login.error_help.contact_support })).toBeTruthy();
  });

  it('"Try again" sends the same request again', async () => {
    signInWithPassword.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ error: null });
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const alert = await signInWith('owner@shop.test');
    await waitFor(() => expect(alert.textContent).toContain('NET-02'));
    fireEvent.click(screen.getByRole('button', { name: ar.login.error_help.retry }));
    await waitFor(() => expect(signInWithPassword).toHaveBeenCalledTimes(2));
    expect(signInWithPassword.mock.calls[1][0]).toEqual({ email: 'owner@shop.test', password: 'Secret123' });
  });

  it('wrong password: the sentence as before, no code and no buttons', async () => {
    signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials', status: 400 } });
    const alert = await signInWith('owner@shop.test');
    await waitFor(() => expect(alert.textContent).toContain(ar.login.errors.friendly.invalid_credentials));
    expect(screen.queryByRole('button', { name: ar.login.error_help.retry })).toBeNull();
    expect(alert.textContent).not.toMatch(/AUTH-|NET-|ERR-/);
  });
});
