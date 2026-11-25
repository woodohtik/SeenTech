import i18n from 'i18next';
import { logError } from '../lib/logger';

/**
 * Sign-in and sign-up errors in the customer's language
 * (seen-login-error-messages-task.md).
 *
 * Every error becomes one kind with a short code. The customer sees one
 * sentence saying what happened and one thing to do, and the code; never
 * the error's own (English, technical) text, a link, or the names of the
 * services behind the app. The technical detail goes to the console and
 * to Sentry (logError), without the password or the email.
 */

export type AuthErrorKind =
  | 'offline'
  | 'blocked'
  | 'network'
  | 'rate_limited'
  | 'invalid_credentials'
  | 'phone_or_password_wrong'
  | 'email_not_confirmed'
  | 'email_confirmation_required'
  | 'weak_password'
  | 'email_exists'
  | 'phone_exists'
  | 'invalid_email'
  | 'same_password'
  | 'account_setup'
  | 'server'
  | 'unknown';

export const AUTH_ERROR_CODES: Readonly<Record<AuthErrorKind, string>> = {
  offline: 'NET-00',
  blocked: 'NET-01',
  network: 'NET-02',
  invalid_credentials: 'AUTH-01',
  phone_or_password_wrong: 'AUTH-02',
  email_not_confirmed: 'AUTH-03',
  email_confirmation_required: 'AUTH-04',
  weak_password: 'AUTH-05',
  email_exists: 'AUTH-06',
  phone_exists: 'AUTH-07',
  invalid_email: 'AUTH-08',
  same_password: 'AUTH-09',
  rate_limited: 'AUTH-10',
  server: 'SRV-01',
  account_setup: 'SRV-02',
  unknown: 'ERR-99',
};

/**
 * The kinds the person cannot fix by typing something else: the message
 * shows its code, and a way to retry and to reach support.
 */
const NEEDS_HELP: ReadonlySet<AuthErrorKind> = new Set<AuthErrorKind>([
  'offline', 'blocked', 'network', 'rate_limited', 'server', 'account_setup', 'unknown',
]);

/** An error the sign-in screen raises itself, already knowing its kind. */
export class AuthKindError extends Error {
  readonly kind: AuthErrorKind;
  constructor(kind: AuthErrorKind) {
    super(kind);
    this.name = 'AuthKindError';
    this.kind = kind;
  }
}

/** The browser could not reach a server at all (Chrome, Firefox, Safari wordings). */
const NETWORK_MESSAGE = /failed to fetch|networkerror|network request failed|load failed|fetch failed|network error/i;

const MESSAGE_MAP: Array<[RegExp, AuthErrorKind]> = [
  [/invalid login credentials/i, 'invalid_credentials'],
  [/user already registered|users_email_key|already been registered/i, 'email_exists'],
  [/email not confirmed/i, 'email_not_confirmed'],
  [/password should be at least|weak.?password/i, 'weak_password'],
  [/unable to validate email address|invalid.*email|email address.*invalid/i, 'invalid_email'],
  [/rate limit|too many requests/i, 'rate_limited'],
  [/new password should be different from the old password/i, 'same_password'],
  // The account could not be set up on our side (an access rule or a key).
  [/row-level security|suitable key|pgrst301|expected 3 parts in jwt/i, 'account_setup'],
];

const statusOf = (err: unknown): number | undefined => {
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === 'number' ? s : undefined;
};

export function classifyAuthError(err: unknown): { kind: AuthErrorKind; code: string } {
  const kind = kindOf(err);
  return { kind, code: AUTH_ERROR_CODES[kind] };
}

function kindOf(err: unknown): AuthErrorKind {
  if (!err) return 'unknown';
  if (err instanceof AuthKindError) return err.kind;
  const message = typeof err === 'string' ? err : String((err as { message?: unknown }).message ?? '');
  const code = String((err as { code?: unknown }).code ?? '');
  const status = statusOf(err);

  if (NETWORK_MESSAGE.test(message) && (err instanceof TypeError || status === undefined || status === 0)) return 'network';
  if (status === 429) return 'rate_limited';
  if (code === '23505') return 'email_exists';
  if (code === '42501') return 'account_setup';
  if (code === 'weak_password') return 'weak_password';
  for (const [pattern, k] of MESSAGE_MAP) {
    if (pattern.test(message)) return k;
  }
  if (status !== undefined && status >= 500) return 'server';
  return 'unknown';
}

/**
 * Whether this site answers at all (a small file, 4 seconds at most). Used
 * to tell a blocked sign-in service (the site answers) from a weak or
 * missing connection (it does not). Any answer counts, even a 404.
 */
export async function siteIsReachable(timeoutMs = 4000): Promise<boolean> {
  if (typeof fetch === 'undefined') return false;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    await fetch(`/version.json?probe=${Date.now()}`, { cache: 'no-store', signal: controller?.signal });
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface FriendlyAuthError {
  kind: AuthErrorKind;
  code: string;
  /** One sentence in the interface language: what happened, what to do. */
  message: string;
  /** Show the code, "try again" and "contact support". */
  needsHelp: boolean;
}

const messageFor = (kind: AuthErrorKind): string => i18n.t(`login.errors.friendly.${kind}`);

/**
 * The error as the customer sees it. A network failure is told apart:
 * the device is offline (NET-00), the site answers but sign-in does not --
 * the network blocks it (NET-01) -- or nothing answers (NET-02).
 */
export async function describeAuthError(
  err: unknown,
  opts: { probe?: () => Promise<boolean> } = {},
): Promise<FriendlyAuthError> {
  let { kind } = classifyAuthError(err);
  let reachable: boolean | undefined;
  const online = typeof navigator === 'undefined' ? undefined : navigator.onLine;
  if (kind === 'network') {
    if (online === false) kind = 'offline';
    else {
      reachable = await (opts.probe ?? siteIsReachable)();
      kind = reachable ? 'blocked' : 'network';
    }
  }
  const code = AUTH_ERROR_CODES[kind];
  const needsHelp = NEEDS_HELP.has(kind);
  if (needsHelp) {
    // For us, not for the customer: the code and what the device saw.
    logError(err, {
      auth_error_code: code,
      browser: typeof navigator === 'undefined' ? '' : navigator.userAgent,
      online,
      site_reachable: reachable,
    });
  }
  return { kind, code, message: messageFor(kind), needsHelp };
}

/**
 * The same, without the network test (for screens that only need the
 * sentence). Never returns the error's own text.
 */
export const getAuthErrorMessage = (err: unknown): string => messageFor(classifyAuthError(err).kind);
