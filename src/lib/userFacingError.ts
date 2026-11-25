/**
 * Every error a person sees, from one place (seen-friendly-errors-everywhere-task.md).
 *
 * toUserError(err) turns any error -- a Supabase / Postgres / PostgREST
 * error, an HTTP answer, a network failure, a thrown Error -- into what
 * the shop's people see: a short title, one thing to do, and a code for
 * support. Never the error's own text, a link, a table or the names of the
 * services behind the app. The detail goes to the log (Sentry and the
 * console); the Sentry event, when there is one, goes into the code of an
 * unknown error.
 *
 * One exception: a sentence our own database functions write on purpose
 * for the employee, in Arabic ("open a shift before taking a payment") --
 * that is shown as it is (kind "refusal"), as before.
 */
import i18n from 'i18next';
import { logError } from './logger';

export type UserErrorKind =
  | 'offline'
  | 'network'
  | 'blocked'
  | 'session_expired'
  | 'permission'
  | 'duplicate'
  | 'duplicate_phone'
  | 'duplicate_email'
  | 'linked'
  | 'validation'
  | 'not_found'
  | 'rate_limited'
  | 'too_large'
  | 'timeout'
  | 'quota'
  | 'printer'
  | 'zatca'
  | 'server'
  | 'refusal'
  | 'unknown';

export const USER_ERROR_CODES: Readonly<Record<UserErrorKind, string>> = {
  offline: 'NET-00',
  blocked: 'NET-01',
  network: 'NET-02',
  session_expired: 'AUTH-11',
  permission: 'PERM-01',
  duplicate: 'SAVE-01',
  duplicate_phone: 'SAVE-01',
  duplicate_email: 'SAVE-01',
  validation: 'SAVE-02',
  linked: 'SAVE-03',
  not_found: 'SAVE-04',
  too_large: 'SAVE-05',
  refusal: 'SAVE-06',
  rate_limited: 'LIM-01',
  quota: 'LIM-02',
  timeout: 'SRV-03',
  printer: 'PRN-00',
  zatca: 'ZATCA-01',
  server: 'SRV-01',
  unknown: 'ERR-99',
};

export interface UserError {
  kind: UserErrorKind;
  /** Short, for support: NET-02, SAVE-01, ERR-99-1a2b3c4d. */
  code: string;
  /** What happened, in plain words. */
  title: string;
  /** The one thing to do now (may be empty for a refusal). */
  action: string;
  /** title and action together, for a single line. */
  message: string;
  /** The error's own text: only filled in for the platform team (super admin). */
  technical?: string;
}

// ---- who may see the technical text ---------------------------------------------

/* Question 1: the platform team sees "technical details" under the message;
   a shop never does. AuthContext sets this from the signed-in role. */
let showTechnical = false;
export function setShowTechnicalErrors(on: boolean): void { showTechnical = on; }
export const technicalErrorsShown = (): boolean => showTechnical;

// ---- classifying ---------------------------------------------------------------------

/** The browser could not reach a server at all (Chrome, Firefox, Safari wordings). */
const NETWORK = /failed to fetch|networkerror|network request failed|load failed|fetch failed|err_internet_disconnected|err_network/i;

interface Raw { message: string; code: string; status?: number; details: string }

function rawOf(err: unknown): Raw {
  if (typeof err === 'string') return { message: err, code: '', details: '' };
  // handleFirestoreError throws its record as JSON text: read what is inside.
  if (err instanceof Error && err.message.startsWith('{')) {
    try {
      const parsed = JSON.parse(err.message) as { error?: unknown };
      if (typeof parsed.error === 'string') return { message: parsed.error, code: '', details: '' };
    } catch { /* not ours */ }
  }
  // A write error event carries the database error as JSON text in `error`
  // (seen-cutting-fabric-pos-orders-fix-task.md: it reached the shop as raw JSON).
  const wrapped = (err as { error?: unknown } | null)?.error;
  if (typeof wrapped === 'string' && wrapped.startsWith('{')) {
    try {
      const inner = JSON.parse(wrapped) as unknown;
      if (inner && typeof inner === 'object' && typeof (inner as { message?: unknown }).message === 'string') return rawOf(inner);
    } catch { /* not JSON after all */ }
  }
  const e = (err ?? {}) as Record<string, unknown>;
  const status = typeof e.status === 'number' ? e.status : typeof e.statusCode === 'number' ? e.statusCode : undefined;
  const message = typeof e.message === 'string' ? e.message : typeof e.error === 'string' ? e.error : '';
  return {
    message,
    code: e.code === undefined || e.code === null ? '' : String(e.code),
    status,
    details: [e.details, e.hint].filter((x) => typeof x === 'string').join(' '),
  };
}

/** The kind of an error, without the text (exported for tests and for code that needs to branch). */
export function userErrorKind(err: unknown): UserErrorKind {
  if (err === null || err === undefined || err === '') return 'unknown';
  const explicit = (err as { userErrorKind?: UserErrorKind }).userErrorKind;
  if (explicit) return explicit;
  const { message, code, status, details } = rawOf(err);
  const text = `${message} ${details}`;
  const low = text.toLowerCase();

  if (NETWORK.test(text) || (err instanceof TypeError && /fetch/i.test(message))) {
    return typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'network';
  }
  if (/jwt expired|token.?expired|pgrst303|refresh token not found|invalid refresh token|session.?(missing|expired)/i.test(text) || status === 401) return 'session_expired';
  if (code === '23505' || low.includes('duplicate key value') || /already (been )?registered|already exists/i.test(text)) {
    if (/phone|جوال|mobile/i.test(text)) return 'duplicate_phone';
    if (/email|بريد/i.test(text)) return 'duplicate_email';
    return 'duplicate';
  }
  if (code === '23503' || low.includes('violates foreign key')) return 'linked';
  if (['23502', '22P02', '22001', '22003', '22007', '22008', '23514'].includes(code) || /invalid input syntax|violates not-null|violates check constraint|value too long/i.test(low) || status === 400 || status === 422) return 'validation';
  if (code === 'PGRST116' || status === 404 || /no rows|not found/i.test(low)) return 'not_found';
  if (code === '57014' || /statement timeout|canceling statement|timed? ?out/i.test(low) || status === 408 || status === 504) return 'timeout';
  if (code === '42501' || code === 'permission-denied' || /row-level security|permission denied|insufficient permissions|forbidden/i.test(low) || status === 403) return 'permission';
  if (status === 429 || /rate limit|too many requests/i.test(low)) return 'rate_limited';
  if (status === 413 || /payload too large|file too large|entity too large/i.test(low)) return 'too_large';
  if (/quota/i.test(low)) return 'quota';
  if (/zatca/i.test(low)) return 'zatca';
  if (status !== undefined && status >= 500) return 'server';
  return 'unknown';
}

// ---- the person's words ---------------------------------------------------------------

/**
 * seen-readiness-fixes-task.md P1.3: the server refuses some actions on purpose
 * and says why in the shop's language ("open a shift before taking a
 * payment", "no payment on a cancelled order", "more than what is left").
 * Those messages are for the employee as they are; anything else is not.
 */
export function dbRefusalMessage(error: unknown): string | null {
  const e = error as { code?: string; message?: string } | null;
  if (!e || typeof e.message !== 'string') return null;
  if (!['22023', '23514', '42501', 'P0001'].includes(String(e.code ?? ''))) return null;
  if (e.message === 'forbidden' || !/[\u0600-\u06FF]/.test(e.message)) return null;
  return e.message;
}

const ARABIC = /[؀-ۿ]/;

/**
 * Our own sentence for the employee: a database function's deliberate
 * refusal, or a short Arabic message our code wrote. Never the English
 * text of a library.
 */
function ownSentence(err: unknown): string | null {
  const refusal = dbRefusalMessage(err);
  if (refusal) return refusal;
  const { message } = rawOf(err);
  if (message && message.length < 200 && ARABIC.test(message) && !/https?:|\{|\}|supabase|postgres|sql/i.test(message)) return message;
  return null;
}

export interface UserErrorContext {
  /** Where it happened, for the log (never shown): "pos.checkout", "customers.save". */
  where?: string;
  /** Do not log (the caller already did). */
  silent?: boolean;
  [key: string]: unknown;
}

/** An error as the shop's people see it -- and logged, for us, with its code. */
export function toUserError(err: unknown, context: UserErrorContext = {}): UserError {
  // A failure that already carries our own text and code (a print result,
  // a PrintError): shown as it is.
  const f = err as { friendly?: unknown; message?: unknown; code?: unknown; userErrorKind?: UserErrorKind; error?: unknown } | null;
  if (f && f.friendly === true && typeof f.message === 'string') {
    const kind = f.userErrorKind ?? 'unknown';
    const code = typeof f.code === 'string' ? f.code : USER_ERROR_CODES[kind];
    if (!context.silent) {
      const { silent: _s, ...extra } = context;
      logError(typeof f.error === 'string' && f.error ? new Error(f.error) : err, { error_code: code, ...extra });
    }
    return {
      kind, code, title: f.message, action: '', message: f.message,
      technical: showTechnical && typeof f.error === 'string' ? f.error : undefined,
    };
  }
  const own = ownSentence(err);
  const kind: UserErrorKind = own ? 'refusal' : userErrorKind(err);
  let code = USER_ERROR_CODES[kind];
  const { silent, ...extra } = context;
  if (!silent) {
    const eventId = logError(err, { error_code: code, ...extra });
    if (kind === 'unknown' && eventId) code = `${code}-${eventId.slice(0, 8)}`;
  }
  const title = own ?? i18n.t(`errors.user.${kind}.title`);
  const action = own ? '' : i18n.t(`errors.user.${kind}.action`);
  const raw = rawOf(err);
  return {
    kind,
    code,
    title,
    action,
    message: action ? `${title} ${action}` : title,
    technical: showTechnical ? [raw.code, raw.status, raw.message, raw.details].filter((x) => x !== '' && x !== undefined).join(' · ') || String(err) : undefined,
  };
}

/**
 * Our own sentence when the error carries one (a database function's
 * deliberate refusal), otherwise the given text -- for a screen that has its
 * own message for the failure. The error is logged either way.
 */
export function ownMessageOr(err: unknown, fallback: string, context: UserErrorContext = {}): string {
  const own = ownSentence(err);
  if (!context.silent) logError(err, { error_code: own ? USER_ERROR_CODES.refusal : 'screen', ...context });
  return own ?? fallback;
}

/**
 * For a screen with its own text for the failure ("the employee was not
 * deleted"): our specific sentence when the error is one we recognise (a
 * duplicate email, no connection, no permission...), otherwise the screen's
 * text with the code. Logged either way.
 */
export function explainOr(err: unknown, fallback: string, context: UserErrorContext = {}): string {
  const ue = toUserError(err, context);
  if (ue.kind !== 'unknown') return ue.message;
  return `${fallback} (${i18n.t('errors.user.code', { code: ue.code })})`;
}

/** An Error that already knows its kind (for code that detects the case itself). */
export class UserFacingError extends Error {
  readonly userErrorKind: UserErrorKind;
  constructor(kind: UserErrorKind, detail?: string) {
    super(detail ?? kind);
    this.name = 'UserFacingError';
    this.userErrorKind = kind;
  }
}
