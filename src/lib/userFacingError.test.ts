// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import i18n from 'i18next';
import ar from '../i18n/locales/ar.json';

vi.mock('./logger', () => ({ logError: vi.fn(() => undefined) }));
import { logError } from './logger';
import { setShowTechnicalErrors, toUserError, UserFacingError, userErrorKind } from './userFacingError';

// seen-friendly-errors-everywhere-task.md

beforeAll(async () => {
  await i18n.init({ lng: 'ar', resources: { ar: { translation: ar } }, interpolation: { escapeValue: false } });
});
afterEach(() => { setShowTechnicalErrors(false); vi.mocked(logError).mockReset(); vi.restoreAllMocks(); });

describe('userErrorKind: each kind of error, its code', () => {
  it.each([
    [new TypeError('Failed to fetch'), 'network', 'NET-02'],
    [{ message: 'TypeError: Load failed' }, 'network', 'NET-02'],
    [{ message: 'JWT expired', code: 'PGRST303' }, 'session_expired', 'AUTH-11'],
    [{ status: 401, message: 'Unauthorized' }, 'session_expired', 'AUTH-11'],
    [{ code: '42501', message: 'new row violates row-level security policy for table "orders"' }, 'permission', 'PERM-01'],
    [{ status: 403, message: 'forbidden' }, 'permission', 'PERM-01'],
    [{ code: '23505', message: 'duplicate key value violates unique constraint "customers_tenant_id_phone_key"' }, 'duplicate_phone', 'SAVE-01'],
    [{ code: '23505', message: 'duplicate key value violates unique constraint "staff_email_key"' }, 'duplicate_email', 'SAVE-01'],
    [{ code: '23505', message: 'duplicate key value violates unique constraint "x_key"' }, 'duplicate', 'SAVE-01'],
    [{ code: '23503', message: 'update or delete on table "customers" violates foreign key constraint' }, 'linked', 'SAVE-03'],
    [{ code: '23502', message: 'null value in column "name" violates not-null constraint' }, 'validation', 'SAVE-02'],
    [{ code: '22P02', message: 'invalid input syntax for type uuid: "abc"' }, 'validation', 'SAVE-02'],
    [{ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }, 'not_found', 'SAVE-04'],
    [{ status: 404, message: 'Not Found' }, 'not_found', 'SAVE-04'],
    [{ code: '57014', message: 'canceling statement due to statement timeout' }, 'timeout', 'SRV-03'],
    [{ status: 409, message: 'Conflict' }, 'unknown', 'ERR-99'],
    [{ status: 413, message: 'Payload Too Large' }, 'too_large', 'SAVE-05'],
    [{ status: 429, message: 'Too Many Requests' }, 'rate_limited', 'LIM-01'],
    [{ status: 500, message: 'Internal Server Error' }, 'server', 'SRV-01'],
    [{ status: 503, message: 'Service Unavailable' }, 'server', 'SRV-01'],
    [{ message: 'ZATCA rejected the invoice: reporting failed' }, 'zatca', 'ZATCA-01'],
    [new UserFacingError('printer', 'agent not running'), 'printer', 'PRN-00'],
    [new Error('x'), 'unknown', 'ERR-99'],
  ])('%o -> %s', (err, kind, code) => {
    expect(userErrorKind(err)).toBe(kind);
    expect(toUserError(err).code).toBe(code);
  });

  it('offline: NET-00', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(toUserError(new TypeError('Failed to fetch')).code).toBe('NET-00');
  });
});

describe('the error\'s own text never reaches the screen', () => {
  it.each([
    'boom',
    'supplier not found',
    'already_processed',
    'Request failed https://bvvhxjrlwphvrmneieuk.supabase.co/rest/v1/orders',
    '{"error":"permission denied for table orders","operationType":"create","path":"orders"}',
  ])('%j', (text) => {
    const ue = toUserError(new Error(text));
    expect(ue.message).not.toContain(text);
    expect(ue.message).not.toMatch(/supabase|https?:|orders|operationType/i);
  });

  it('a short unknown error: the generic sentence with ERR-99', () => {
    const ue = toUserError(new Error('nope'));
    expect(ue).toMatchObject({ kind: 'unknown', code: 'ERR-99' });
    expect(ue.message).toBe(`${ar.errors.user.unknown.title} ${ar.errors.user.unknown.action}`);
  });

  it("our own database function's Arabic refusal is shown as it is", () => {
    const ue = toUserError({ code: '22023', message: 'افتح وردية قبل استلام أي دفعة' });
    expect(ue).toMatchObject({ kind: 'refusal', title: 'افتح وردية قبل استلام أي دفعة', action: '' });
  });

  it('a database error wrapped as JSON (a write error event): its own Arabic sentence, never the JSON', () => {
    const info = { error: JSON.stringify({ code: '22023', message: 'سطر القماش هذا ليس من أصناف الطلب. حدّث الصفحة ثم أعد المحاولة.', hint: 'fabric_line_mismatch' }), operationType: 'update', path: 'orders' };
    const ue = toUserError(info);
    expect(ue.kind).toBe('refusal');
    expect(ue.message).toBe('سطر القماش هذا ليس من أصناف الطلب. حدّث الصفحة ثم أعد المحاولة.');
    expect(ue.message).not.toContain('{');
  });

  it('the duplicate phone of the acceptance list', () => {
    const ue = toUserError({ code: '23505', message: 'duplicate key value violates unique constraint "customers_phone_key"' });
    expect(ue.title).toBe(ar.errors.user.duplicate_phone.title);
    expect(ue.message).not.toContain('duplicate key');
  });
});

describe('the log, and the platform team', () => {
  it('every error goes to the log with its code; the Sentry event joins an unknown code', () => {
    vi.mocked(logError).mockReturnValue('1a2b3c4d5e6f7a8b');
    const err = new Error('nope');
    expect(toUserError(err, { where: 'pos.checkout' }).code).toBe('ERR-99-1a2b3c4d');
    expect(logError).toHaveBeenCalledWith(err, expect.objectContaining({ error_code: 'ERR-99', where: 'pos.checkout' }));
  });

  it('the technical text: for the super admin only', () => {
    const err = { code: '23505', message: 'duplicate key value violates unique constraint "x_key"' };
    expect(toUserError(err).technical).toBeUndefined();
    setShowTechnicalErrors(true);
    expect(toUserError(err).technical).toContain('duplicate key value');
  });
});
