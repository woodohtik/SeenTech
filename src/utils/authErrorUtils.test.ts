// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import i18n from 'i18next';
import ar from '../i18n/locales/ar.json';
import en from '../i18n/locales/en.json';
import ur from '../i18n/locales/ur.json';

vi.mock('../lib/logger', () => ({ logError: vi.fn() }));
import { logError } from '../lib/logger';
import { AuthKindError, classifyAuthError, describeAuthError, getAuthErrorMessage } from './authErrorUtils';

// seen-login-error-messages-task.md

beforeAll(async () => {
  await i18n.init({ lng: 'ar', resources: { ar: { translation: ar } }, interpolation: { escapeValue: false } });
});
afterEach(() => { vi.restoreAllMocks(); vi.mocked(logError).mockClear(); });

describe('classifyAuthError: every kind of error, its code', () => {
  it.each([
    [new TypeError('Failed to fetch'), 'network', 'NET-02'],
    [new TypeError('NetworkError when attempting to fetch resource.'), 'network', 'NET-02'],
    [new TypeError('Load failed'), 'network', 'NET-02'],
    [{ name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 }, 'network', 'NET-02'],
    [{ message: 'Request rate limit reached', status: 429 }, 'rate_limited', 'AUTH-10'],
    [{ message: 'Invalid login credentials', status: 400 }, 'invalid_credentials', 'AUTH-01'],
    [{ message: 'Email not confirmed', status: 400 }, 'email_not_confirmed', 'AUTH-03'],
    [{ message: 'Password should be at least 8 characters.', status: 422 }, 'weak_password', 'AUTH-05'],
    [{ message: 'User already registered', status: 422 }, 'email_exists', 'AUTH-06'],
    [{ code: '23505', message: 'duplicate key value violates unique constraint "users_email_key"' }, 'email_exists', 'AUTH-06'],
    [new AuthKindError('phone_exists'), 'phone_exists', 'AUTH-07'],
    [new AuthKindError('phone_or_password_wrong'), 'phone_or_password_wrong', 'AUTH-02'],
    [{ code: '42501', message: 'new row violates row-level security policy for table "users"' }, 'account_setup', 'SRV-02'],
    [{ message: 'Internal Server Error', status: 500 }, 'server', 'SRV-01'],
    [{ message: 'upstream connect error', status: 503 }, 'server', 'SRV-01'],
    [new Error('Something nobody expected at https://abc.supabase.co'), 'unknown', 'ERR-99'],
    [null, 'unknown', 'ERR-99'],
  ])('%o -> %s %s', (err, kind, code) => {
    expect(classifyAuthError(err)).toEqual({ kind, code });
  });
});

describe('the customer never sees the error\'s own text', () => {
  it('an unknown error: the friendly sentence, not its message', () => {
    const text = getAuthErrorMessage(new Error('JWT expired at https://bvvhxjrlwphvrmneieuk.supabase.co'));
    expect(text).toBe(ar.login.errors.friendly.unknown);
    expect(text).not.toMatch(/supabase|jwt|https?:/i);
  });

  it('wrong password: the same sentence as before', () => {
    expect(getAuthErrorMessage({ message: 'Invalid login credentials' })).toBe(ar.login.errors.friendly.invalid_credentials);
  });
});

describe('describeAuthError: offline, blocked, or a weak connection', () => {
  const failed = new TypeError('Failed to fetch');

  it('the device is offline: NET-00, without testing the site', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const probe = vi.fn(async () => true);
    const e = await describeAuthError(failed, { probe });
    expect(e).toMatchObject({ kind: 'offline', code: 'NET-00', needsHelp: true });
    expect(probe).not.toHaveBeenCalled();
  });

  it('the site answers but sign-in does not: the network blocks it, NET-01', async () => {
    const e = await describeAuthError(failed, { probe: async () => true });
    expect(e).toMatchObject({ kind: 'blocked', code: 'NET-01' });
    expect(e.message).toBe(ar.login.errors.friendly.blocked);
  });

  it('nothing answers: a weak connection, NET-02', async () => {
    const e = await describeAuthError(failed, { probe: async () => false });
    expect(e).toMatchObject({ kind: 'network', code: 'NET-02' });
  });

  it('the code and what the device saw go to the log; a typing mistake does not', async () => {
    await describeAuthError(failed, { probe: async () => true });
    expect(logError).toHaveBeenCalledWith(failed, expect.objectContaining({ auth_error_code: 'NET-01', site_reachable: true }));
    vi.mocked(logError).mockClear();
    const wrong = await describeAuthError({ message: 'Invalid login credentials' });
    expect(wrong.needsHelp).toBe(false);
    expect(logError).not.toHaveBeenCalled();
  });
});

describe('the sign-in texts, in the three languages', () => {
  const banned = /\{\{url\}\}|supabase|firebase|jwt|\brls\b|secrets|\bapi\b|https?:|قاعدة البيانات|خوادم|database|adblock/i;
  const strings = (node: unknown, path: string): Array<[string, string]> =>
    typeof node === 'string'
      ? [[path, node]]
      : Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => strings(v, `${path}.${k}`));

  it.each([['ar', ar], ['en', en], ['ur', ur]])('%s: no link and no technical word under login.errors', (_lang, locale) => {
    const hits = strings((locale as typeof ar).login.errors, 'login.errors').filter(([, text]) => banned.test(text));
    expect(hits).toEqual([]);
  });

  it.each([['ar', ar], ['en', en], ['ur', ur]])('%s: every kind has its sentence', (_lang, locale) => {
    const friendly = (locale as typeof ar).login.errors.friendly as Record<string, string>;
    for (const kind of Object.keys(ar.login.errors.friendly)) expect(friendly[kind], kind).toBeTruthy();
  });
});
