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
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Version': 'V2',
      OTP: otp,
    },
    body: JSON.stringify({ csr: csrBase64 }),
  });

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
