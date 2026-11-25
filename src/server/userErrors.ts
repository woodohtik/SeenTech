/**
 * What the server tells the browser when something fails
 * (seen-friendly-errors-everywhere-task.md, phase 5):
 *
 *   { ok: false, code, kind, error }
 *
 * `error` is a plain sentence in the request's language (Accept-Language:
 * ar, en or ur; Arabic otherwise), `kind` and `code` match the app's
 * toUserError (src/lib/userFacingError.ts), so a screen can show its own
 * text for the kind. The original error is logged, never sent.
 */
import type { Request } from 'express';

export type ServerErrorKind =
  | 'server'
  | 'validation'
  | 'duplicate_email'
  | 'permission'
  | 'not_found'
  | 'rate_limited'
  | 'printer'
  | 'unknown';

export const SERVER_ERROR_CODES: Readonly<Record<ServerErrorKind, string>> = {
  server: 'SRV-01',
  validation: 'SAVE-02',
  duplicate_email: 'SAVE-01',
  permission: 'PERM-01',
  not_found: 'SAVE-04',
  rate_limited: 'LIM-01',
  printer: 'PRN-01',
  unknown: 'ERR-99',
};

type Lang = 'ar' | 'en' | 'ur';
const TEXT: Readonly<Record<ServerErrorKind, Record<Lang, string>>> = {
  server: {
    ar: 'خدمة سين متوقفة مؤقتاً. انتظر قليلاً ثم أعد المحاولة.',
    en: 'Seen is down for a moment. Wait a little, then try again.',
    ur: 'سین کچھ دیر کے لیے بند ہے۔ تھوڑا انتظار کر کے دوبارہ کوشش کریں۔',
  },
  validation: {
    ar: 'في قيمة ناقصة أو غير صحيحة. راجع الحقول ثم أعد المحاولة.',
    en: 'A value is missing or not valid. Check the fields, then try again.',
    ur: 'کوئی قیمت خالی یا غلط ہے۔ خانے چیک کر کے دوبارہ کوشش کریں۔',
  },
  duplicate_email: {
    ar: 'البريد الإلكتروني مسجل مسبقاً. استخدم بريداً آخر.',
    en: 'This email is already registered. Use another email.',
    ur: 'یہ ای میل پہلے سے درج ہے۔ دوسری ای میل استعمال کریں۔',
  },
  permission: {
    ar: 'ما عندك صلاحية لهذا الإجراء.',
    en: 'You do not have permission for this.',
    ur: 'آپ کو اس کام کی اجازت نہیں۔',
  },
  not_found: {
    ar: 'ما لقينا ما تطلبه. حدّث الصفحة.',
    en: 'We could not find it. Refresh the page.',
    ur: 'یہ نہیں ملا۔ صفحہ تازہ کریں۔',
  },
  rate_limited: {
    ar: 'محاولات كثيرة. انتظر دقيقة ثم أعد المحاولة.',
    en: 'Too many attempts. Wait a minute, then try again.',
    ur: 'بہت زیادہ کوششیں۔ ایک منٹ انتظار کر کے دوبارہ کوشش کریں۔',
  },
  printer: {
    ar: 'ما وصلت الطباعة للطابعة. تأكد أنها شغّالة ومتصلة بالشبكة، ثم أعد المحاولة.',
    en: 'The print did not reach the printer. Check that it is on and on the network, then try again.',
    ur: 'پرنٹ پرنٹر تک نہیں پہنچا۔ دیکھیں کہ وہ آن اور نیٹ ورک سے منسلک ہے، پھر دوبارہ کوشش کریں۔',
  },
  unknown: {
    ar: 'صار خطأ غير متوقع. أعد المحاولة، وإذا تكرر تواصل معنا.',
    en: 'Something unexpected went wrong. Try again, and if it keeps happening, contact us.',
    ur: 'ایک غیر متوقع خرابی ہوئی۔ دوبارہ کوشش کریں، اور اگر بار بار ہو تو ہم سے رابطہ کریں۔',
  },
};

export function requestLang(req?: Pick<Request, 'headers'> | null): Lang {
  const header = String(req?.headers?.['accept-language'] ?? '').toLowerCase();
  const first = header.split(',')[0]?.trim().slice(0, 2);
  return first === 'en' || first === 'ur' ? first : 'ar';
}

export interface ServerErrorBody {
  ok: false;
  code: string;
  kind: ServerErrorKind;
  error: string;
  /** A machine word the screen may branch on (never a library's text). */
  reason?: string;
}

export function userErrorBody(req: Pick<Request, 'headers'> | null | undefined, kind: ServerErrorKind, reason?: string): ServerErrorBody {
  return {
    ok: false,
    code: SERVER_ERROR_CODES[kind],
    kind,
    error: TEXT[kind][requestLang(req)],
    ...(reason ? { reason } : {}),
  };
}

/** A Supabase Auth admin error, as a kind and a reason word (never its text). */
export function authAdminErrorKind(message: string | undefined | null): { kind: ServerErrorKind; reason: string } {
  const m = String(message ?? '');
  if (/already been registered|already registered|already exists/i.test(m)) return { kind: 'duplicate_email', reason: 'email_already_in_use' };
  if (/password/i.test(m)) return { kind: 'validation', reason: 'weak_password' };
  if (/email/i.test(m)) return { kind: 'validation', reason: 'invalid_email' };
  return { kind: 'unknown', reason: 'account_failed' };
}
