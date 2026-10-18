/**
 * ZATCA real onboarding (seen-zatca-real-onboarding-task.md), Phase ب
 * step 2: the actual HTTP client for ZATCA's own e-invoicing APIs --
 * Compliance CSID issuance first, Production CSID / Compliance Invoices /
 * Clearance / Reporting to follow. Nothing in this project has ever called
 * a real ZATCA endpoint before this; zatcaPhase2Service.ts's clearInvoice/
 * reportInvoice were scaffolding that was never wired to anything and never
 * tested against a live server.
 *
 * CONFIDENCE LEVEL / LIVE TEST RESULTS (2026-10-03): called this for real
 * against ZATCA's actual sandbox (gw-fatoora.zatca.gov.sa, a real Apigee
 * gateway behind Cloudflare -- confirmed via response headers/fault
 * format, not a stub). Confirmed live:
 *  - The base path and `/compliance` route exist and are reachable.
 *  - `Accept-Version` is genuinely checked -- omitting it gives a distinct
 *    406 "This Version is not supported or not provided in the header.";
 *    sending "V2" does NOT reproduce that error, so "V2" is at least an
 *    accepted value.
 *  - Varying the CSR content (empty / garbage / a real, OpenSSL-validated
 *    CSR) and the OTP header's value all produced the exact same generic
 *    400 "Invalid Request" -- so neither is what's currently rejected.
 *  - `OTP` must be a header, not a body field: omitting the header
 *    entirely (regardless of a same-named body field, any casing) gives a
 *    distinct, structured `{"errors":[{"code":"Missing-OTP",...}]}`
 *    instead of the generic one -- so the header IS being read, just not
 *    enough on its own to get past validation yet.
 *  - STILL UNRESOLVED: what specifically is still wrong once CSR, OTP
 *    header, and Accept-Version are all present and individually
 *    plausible -- the generic "Invalid Request" doesn't say. Likely a
 *    missing/malformed header or body field not yet tried, or a field this
 *    code sends with the wrong exact name/casing. Needs either ZATCA's
 *    official Postman collection/API reference (not publicly discoverable
 *    -- swagger/openapi probing off this gateway all 500'd) or another
 *    documented working example to compare against byte-for-byte.
 *
 * seen-week-plan-task.md day 1-2 follow-up (2026-10-12): added the missing
 * `Accept-Language` header below (cheapest fix, item 1) -- not yet
 * re-tested live against the real sandbox since adding it, so still
 * unconfirmed whether that alone clears the 400. Also did item 3 (compare
 * against known-working examples): the Fatoora developer community
 * (https://zatca1.discourse.group) and a public integration guide
 * (https://www.jibrid.com/blog/zatca-phase2-api-integration-guide) both
 * confirm the exact same header set (Content-Type, OTP, Accept-Version:
 * V2) and body shape (`{ csr: base64CSR }`) this file already sends --
 * no structural difference found. One real lead surfaced there worth
 * re-checking on the next live attempt even though it contradicts our own
 * prior test: multiple other developers hit this identical generic 400
 * specifically from a malformed CSR encoding (CSR must be a single
 * continuous base64 string -- no PEM headers/footers, no embedded
 * newlines/whitespace); one reported ZATCA's own Swagger sample CSR
 * working while their externally-generated one didn't, with no further
 * detail on why. generateZatcaCsr() in zatcaCsr.ts does already produce a
 * single continuous base64 string (csrBase64, not the PEM-wrapped form),
 * so this looks ruled out here too -- but given it's the one concrete,
 * reproducible cause other integrators report for this exact symptom, it's
 * worth explicitly re-confirming (e.g. dump the live-sent csrBase64 to a
 * log line and inspect it byte-for-byte) before escalating to item 2
 * (ZATCA's own EGS developer support, 19993 / info@zatca.gov.sa) as a
 * last resort.
 */

const ZATCA_BASE_URL: Record<'sandbox' | 'simulation' | 'production', string> = {
  sandbox: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal',
  simulation: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation',
  production: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/core',
};

export type ZatcaEnvironment = keyof typeof ZATCA_BASE_URL;

export class ZatcaApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(message);
    this.name = 'ZatcaApiError';
  }
}

async function parseJsonOrText(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * seen-ai-assistant-zatca-cr-task.md, ZATCA #3: one retry, short delay,
 * ONLY for a transient failure -- the fetch itself throwing (network error,
 * DNS, connection reset, or this request's own AbortSignal.timeout firing)
 * or a 5xx from ZATCA's gateway. A real 4xx rejection (invalid request,
 * bad CSR, business-rule failure) is never retried here -- retrying that
 * would just waste 10 more seconds reproducing the exact same rejection,
 * and every call site above already distinguishes 4xx from a timeout via
 * ZatcaApiError's status.
 *
 * `buildInit` is called fresh for each attempt (not a static RequestInit)
 * specifically so the retry gets its own new AbortSignal.timeout(10_000) --
 * reusing the first attempt's signal would mean a request that failed near
 * the 10s mark retries against a signal that's already expired or about to.
 */
async function fetchWithRetry(url: string, buildInit: () => RequestInit): Promise<Response> {
  try {
    const res = await fetch(url, buildInit());
    if (res.status < 500) return res;
    await new Promise((r) => setTimeout(r, 1000));
    return fetch(url, buildInit());
  } catch (err) {
    await new Promise((r) => setTimeout(r, 1000));
    return fetch(url, buildInit());
  }
}

export interface ComplianceCsidResult {
  /** The issued certificate, base64-encoded by ZATCA (decode to get the PEM/DER X.509 cert). */
  binarySecurityToken: string;
  /** The API secret/password to use as the Basic Auth password on every subsequent call authenticated with this CSID. */
  secret: string;
  /** ZATCA's tracking id for this request -- needed later to request the Production CSID. */
  requestId: string;
  /** Raw response, kept for logging/debugging -- ZATCA's dispositionMessage and other fields vary by scenario. */
  raw: unknown;
}

/** The Basic Auth credential pair ZATCA issues with any CSID (Compliance or Production). */
export interface ZatcaCsidAuth {
  binarySecurityToken: string;
  secret: string;
}

function basicAuthHeader(auth: ZatcaCsidAuth): string {
  return `Basic ${Buffer.from(`${auth.binarySecurityToken}:${auth.secret}`).toString('base64')}`;
}

export interface ZatcaInvoiceSubmission {
  invoiceHash: string;
  uuid: string;
  /** The signed UBL invoice XML, base64-encoded. */
  invoiceBase64: string;
}

export interface ZatcaInvoiceResponse {
  /** 'CLEARED' | 'REPORTED' | 'NOT_CLEARED' etc, per ZATCA's own status vocabulary -- treat anything other than a successful clear/report as a rejection. */
  status: string;
  raw: unknown;
}

/**
 * Compliance Invoices -- the mandatory test submissions (matches postman/
 * seen-zatca-api.postman_collection.json exactly: same path, same headers,
 * same Basic Auth convention) that must all pass before ZATCA will issue a
 * Production CSID. Call once per required invoice type (simplified,
 * standard, and any credit/debit note variants ZATCA's current guideline
 * requires) with that invoice's own hash/uuid/signed XML.
 */
export async function submitComplianceInvoice(
  submission: ZatcaInvoiceSubmission,
  complianceAuth: ZatcaCsidAuth,
  env: ZatcaEnvironment = 'sandbox'
): Promise<ZatcaInvoiceResponse> {
  const url = `${ZATCA_BASE_URL[env]}/compliance/invoices`;
  const res = await fetchWithRetry(url, () => ({
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
    headers: {
      'Content-Type': 'application/json',
      'Accept-Version': 'V2',
      'Accept-Language': 'en',
      Authorization: basicAuthHeader(complianceAuth),
    },
    body: JSON.stringify({
      invoiceHash: submission.invoiceHash,
      uuid: submission.uuid,
      invoice: submission.invoiceBase64,
    }),
  }));
  const body = await parseJsonOrText(res);
  if (!res.ok) {
    throw new ZatcaApiError(`ZATCA Compliance Invoice submission failed (${res.status})`, res.status, body);
  }
  const data = body as any;
  return { status: String(data?.clearanceStatus ?? data?.reportingStatus ?? data?.status ?? 'UNKNOWN'), raw: body };
}

/**
 * Production CSID -- requested once, after every required Compliance
 * Invoice type has passed. Authenticated with the COMPLIANCE CSID's own
 * credentials (not the taxpayer's OTP again), per
 * postman/seen-zatca-api.postman_collection.json.
 */
export async function requestProductionCsid(
  complianceRequestId: string,
  complianceAuth: ZatcaCsidAuth,
  env: ZatcaEnvironment = 'sandbox'
): Promise<ComplianceCsidResult> {
  const url = `${ZATCA_BASE_URL[env]}/production/csids`;
  const res = await fetchWithRetry(url, () => ({
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
    headers: {
      'Content-Type': 'application/json',
      'Accept-Version': 'V2',
      'Accept-Language': 'en',
      Authorization: basicAuthHeader(complianceAuth),
    },
    body: JSON.stringify({ compliance_request_id: complianceRequestId }),
  }));
  const body = await parseJsonOrText(res);
  if (!res.ok) {
    throw new ZatcaApiError(`ZATCA Production CSID request failed (${res.status})`, res.status, body);
  }
  const data = body as any;
  if (!data?.binarySecurityToken || !data?.secret) {
    throw new ZatcaApiError('ZATCA Production CSID response missing binarySecurityToken/secret', res.status, body);
  }
  return {
    binarySecurityToken: data.binarySecurityToken,
    secret: data.secret,
    requestId: String(data.requestID ?? data.requestId ?? ''),
    raw: body,
  };
}

/**
 * Reporting -- for simplified (B2C) invoices, within ZATCA's 24h window.
 * Authenticated with the PRODUCTION CSID. A non-2xx response here must
 * never be treated as a successfully issued invoice by the caller.
 */
export async function reportInvoice(
  submission: ZatcaInvoiceSubmission,
  productionAuth: ZatcaCsidAuth,
  env: ZatcaEnvironment = 'production'
): Promise<ZatcaInvoiceResponse> {
  const url = `${ZATCA_BASE_URL[env]}/invoices/reporting/single`;
  const res = await fetchWithRetry(url, () => ({
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
    headers: {
      'Content-Type': 'application/json',
      'Accept-Version': 'V2',
      'Accept-Language': 'en',
      Authorization: basicAuthHeader(productionAuth),
    },
    body: JSON.stringify({
      invoiceHash: submission.invoiceHash,
      uuid: submission.uuid,
      invoice: submission.invoiceBase64,
    }),
  }));
  const body = await parseJsonOrText(res);
  if (!res.ok) {
    throw new ZatcaApiError(`ZATCA Reporting failed (${res.status})`, res.status, body);
  }
  const data = body as any;
  return { status: String(data?.reportingStatus ?? data?.status ?? 'UNKNOWN'), raw: body };
}

/**
 * Clearance -- for standard (B2B) invoices. Synchronous: ZATCA must accept
 * the invoice before the sale may be considered complete (this project's
 * own prior decision -- a B2B sale rejected here is not queued/offline-
 * deferred like a B2C sale, it's a hard failure the cashier sees
 * immediately). Authenticated with the PRODUCTION CSID.
 */
export async function clearInvoice(
  submission: ZatcaInvoiceSubmission,
  productionAuth: ZatcaCsidAuth,
  env: ZatcaEnvironment = 'production'
): Promise<ZatcaInvoiceResponse> {
  const url = `${ZATCA_BASE_URL[env]}/invoices/clearance/single`;
  const res = await fetchWithRetry(url, () => ({
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
    headers: {
      'Content-Type': 'application/json',
      'Accept-Version': 'V2',
      'Accept-Language': 'en',
      'Clearance-Status': '1',
      Authorization: basicAuthHeader(productionAuth),
    },
    body: JSON.stringify({
      invoiceHash: submission.invoiceHash,
      uuid: submission.uuid,
      invoice: submission.invoiceBase64,
    }),
  }));
  const body = await parseJsonOrText(res);
  if (!res.ok) {
    throw new ZatcaApiError(`ZATCA Clearance failed (${res.status})`, res.status, body);
  }
  const data = body as any;
  return { status: String(data?.clearanceStatus ?? data?.status ?? 'UNKNOWN'), raw: body };
}

/**
 * Requests a Compliance CSID: submits the CSR (zatcaCsr.ts) plus the OTP
 * generated from the Fatoora Portal, gets back a certificate + API secret
 * usable against the Compliance Invoices endpoint. This is the first real
 * network call this project makes to ZATCA.
 *
 * For env: 'sandbox' (ZATCA's "Integration Sandbox" / developer portal
 * tier), ZATCA's own documentation states no real taxpayer account is
 * needed when testing with the published dummy VAT number
 * (399999999900003) -- but whether that also means any OTP value is
 * accepted, or a specific fixed test OTP is required, is exactly what
 * calling this for real against `sandbox` answers authoritatively.
 */
export async function requestComplianceCsid(
  csrBase64: string,
  otp: string,
  env: ZatcaEnvironment = 'sandbox'
): Promise<ComplianceCsidResult> {
  const url = `${ZATCA_BASE_URL[env]}/compliance`;
  const res = await fetchWithRetry(url, () => ({
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Version': 'V2',
      'Accept-Language': 'en',
      OTP: otp,
    },
    body: JSON.stringify({ csr: csrBase64 }),
  }));

  const body = await parseJsonOrText(res);
  if (!res.ok) {
    throw new ZatcaApiError(`ZATCA Compliance CSID request failed (${res.status})`, res.status, body);
  }

  const data = body as any;
  if (!data?.binarySecurityToken || !data?.secret) {
    throw new ZatcaApiError('ZATCA Compliance CSID response missing binarySecurityToken/secret', res.status, body);
  }

  return {
    binarySecurityToken: data.binarySecurityToken,
    secret: data.secret,
    requestId: String(data.requestID ?? data.requestId ?? ''),
    raw: body,
  };
}
