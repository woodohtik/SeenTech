/**
 * What reaches Sentry: technical data only (seen-sentry-setup-task.md,
 * section 7 -- PDPL, founder's decision of 25 Nov 2026).
 *
 * Used by the browser (src/lib/logger.ts) and the server
 * (src/server/logger.ts) as beforeSend / beforeBreadcrumb. No Sentry import
 * here: plain functions over plain objects, so both sides and the tests use
 * the same code. Sentry's own Data Scrubber is a second layer, not this one.
 *
 *  - links: an order's tracking token, a measurements token, ?token= / ?ref=
 *    and any long random path segment become [token];
 *  - text: Saudi phone numbers -> [phone], emails -> [email], an IP -> [ip],
 *    a 15-digit tax number -> [trn], Postgres "Key (phone)=(0501234567)" ->
 *    "Key (phone)=[redacted]";
 *  - the user is { id } only; no IP, no request body, no cookies, no headers;
 *  - console breadcrumbs are dropped (logError prints raw objects there);
 *    fetch/xhr ones keep the cleaned link only; a click keeps its selector
 *    without the element's text;
 *  - extra / contexts / tags go through the same cleaning; whole records
 *    (an order, an invoice, measurements, a customer) are removed.
 */

const PHONE = /(?<![\d])(?:\+?966|00966|0)?5\d{8}(?![\d])/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const IPV4 = /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g;
const TRN = /(?<![\d])3\d{13}3(?![\d])/g;
const PG_KEY = /Key \(([^)]*)\)=\([^)]*\)/g;
const TOKEN_PATH = /(\/(?:track|measurements|order-tracking|public\/order-tracking|public\/measurements|r|partner\/invite)\/)[^/?#\s"'<>]+/gi;
const TOKEN_QUERY = /([?&](?:token|ref|t|code|access_token|refresh_token|invite|key)=)[^&#\s"'<>]+/gi;
const LONG_SEGMENT = /(\/)[A-Za-z0-9_-]{24,}(?=[/?#]|$)/g;

/** Sensitive by name: the value is replaced, whatever it is. */
const SENSITIVE_KEYS = new Set([
  'phone', 'mobile', 'email', 'name', 'customer_name', 'customername', 'customer_phone', 'customerphone',
  'token', 'tracking_token', 'trackingtoken', 'trn', 'vat_number', 'vatnumber', 'buyer_trn', 'buyertrn',
  'address', 'notes', 'password', 'pin', 'authorization', 'cookie', 'cookies', 'ip', 'ip_address',
  'display_name', 'displayname', 'full_name', 'fullname', 'staff_name', 'staffname', 'company_name', 'companyname',
]);

/** Whole records: removed, only an id may stay beside them. */
const RECORD_KEYS = new Set([
  'order', 'orders', 'invoice', 'invoices', 'items', 'lines', 'measurements', 'customer', 'customers',
  'body', 'data', 'payload', 'request', 'response', 'staff', 'user_metadata', 'metadata',
]);

export function scrubText(value: string): string {
  return value
    .replace(PG_KEY, 'Key ($1)=[redacted]')
    .replace(TOKEN_PATH, '$1[token]')
    .replace(TOKEN_QUERY, '$1[token]')
    .replace(EMAIL, '[email]')
    .replace(TRN, '[trn]')
    .replace(PHONE, '[phone]')
    .replace(IPV4, '[ip]');
}

/** A link: the text rules, and any long random-looking path segment. */
export function scrubUrl(value: string): string {
  return scrubText(value).replace(LONG_SEGMENT, '$1[token]');
}

export function scrubValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return scrubText(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth > 4) return '[removed]';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrubValue(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    const k = key.toLowerCase();
    if (SENSITIVE_KEYS.has(k)) out[key] = '[redacted]';
    else if (RECORD_KEYS.has(k)) out[key] = '[removed]';
    else out[key] = scrubValue(v, depth + 1);
  }
  return out;
}

// Minimal shapes of Sentry's event and breadcrumb (no Sentry import here).
type Obj = Record<string, any>;

export function scrubBreadcrumb<T extends Obj>(crumb: T | null | undefined): T | null {
  if (!crumb) return null;
  if (crumb.category === 'console') return null;
  const out: Obj = { ...crumb };
  if (typeof out.message === 'string') out.message = scrubText(out.message);
  if (out.category === 'ui.click' || out.category === 'ui.input') {
    // The selector, never the element's text.
    out.message = typeof out.message === 'string' ? out.message.replace(/\[[^\]]*text[^\]]*\]/gi, '') : out.message;
    delete out.data;
  } else if (out.data && typeof out.data === 'object') {
    const data: Obj = {};
    for (const key of ['url', 'to', 'from', 'method', 'status_code']) {
      if (out.data[key] !== undefined) {
        data[key] = typeof out.data[key] === 'string' ? scrubUrl(out.data[key]) : out.data[key];
      }
    }
    out.data = data;
  }
  return out as T;
}

export function scrubEvent<T extends Obj>(event: T | null | undefined): T | null {
  if (!event) return null;
  const e: Obj = { ...event };

  if (typeof e.message === 'string') e.message = scrubText(e.message);
  if (e.logentry && typeof e.logentry === 'object') {
    e.logentry = { ...e.logentry, message: typeof e.logentry.message === 'string' ? scrubText(e.logentry.message) : e.logentry.message, params: undefined };
  }
  if (typeof e.transaction === 'string') e.transaction = scrubUrl(e.transaction);
  if (e.exception?.values) {
    e.exception = {
      ...e.exception,
      values: e.exception.values.map((v: Obj) => ({ ...v, value: typeof v.value === 'string' ? scrubText(v.value) : v.value })),
    };
  }

  // The request: the cleaned link and method only.
  if (e.request) {
    e.request = {
      url: typeof e.request.url === 'string' ? scrubUrl(e.request.url) : undefined,
      method: e.request.method,
    };
  }

  // The user: an id only (tenant, role, branch are tags). Never an IP.
  e.user = e.user?.id ? { id: String(e.user.id) } : undefined;

  if (e.extra) e.extra = scrubValue(e.extra);
  if (e.contexts) {
    const contexts: Obj = {};
    for (const [key, ctx] of Object.entries(e.contexts as Obj)) {
      // The runtime / browser / os contexts are technical; the rest is cleaned.
      contexts[key] = ['runtime', 'browser', 'os', 'device', 'app', 'trace', 'culture', 'cloud_resource'].includes(key) ? ctx : scrubValue(ctx);
    }
    e.contexts = contexts;
  }
  if (e.tags) {
    const tags: Obj = {};
    for (const [key, v] of Object.entries(e.tags as Obj)) tags[key] = typeof v === 'string' ? scrubUrl(v) : v;
    e.tags = tags;
  }
  if (Array.isArray(e.breadcrumbs)) {
    e.breadcrumbs = e.breadcrumbs.map((b: Obj) => scrubBreadcrumb(b)).filter(Boolean);
  }
  return e as T;
}

/** Errors that are noise, not faults of the app. */
export const IGNORED_ERRORS: Array<string | RegExp> = [
  /ResizeObserver loop/i,
  /^AbortError\b/,
  /The (user aborted a|operation was aborted)/i,
  /chrome-extension:\/\//,
  /moz-extension:\/\//,
  /safari-(web-)?extension:\/\//,
];
export const DENIED_URLS: RegExp[] = [/^chrome-extension:\/\//, /^moz-extension:\/\//, /^safari-(web-)?extension:\/\//];

/** A code chunk that no longer exists after an update (ErrorBoundary recovers): a warning, not a fault. */
export const STALE_BUILD_ERROR = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading (CSS )?chunk \d+ failed/i;

/** The environment name: production, staging (Vercel preview = the staging branch) or development. */
export function sentryEnvironment(vercelEnv: string | undefined, nodeEnv?: string): string {
  if (vercelEnv === 'production') return 'production';
  if (vercelEnv === 'preview') return 'staging';
  return nodeEnv === 'production' ? 'production' : 'development';
}
