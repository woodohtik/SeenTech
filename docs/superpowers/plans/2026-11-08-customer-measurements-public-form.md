# Public Customer Measurements Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff send a customer a permanent, unauthenticated link where the customer fills in their own tailoring measurements, saved immediately to their profile.

**Architecture:** Mirrors the existing `/track/:token` public order-tracking feature exactly: a random UUID token column, two new `server.ts` routes using `supabaseAdmin` with an explicit field allowlist (no RPC, no `anon` grant), the already-shared `checkTrackingRateLimit` limiter, and a new public React route that reuses the existing `VisualMeasurements`/`ThobeMeasurementSelector` components unchanged.

**Tech Stack:** Express (`server.ts`), Supabase (Postgres + `supabaseAdmin` service-role client), React + react-router-dom, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-08-customer-measurements-public-form-design.md`

## Post-plan follow-up fixes (user-reported, after the plan's own completion)

- `App.tsx`: pre-Routes staff-session interception screens (conflict/trial-lock/
  PIN setup/PIN login) had no path exemption, so any public route shown in a
  browser that also carried a staff session (same device/browser) was blocked.
  Fixed with an `isPublicRoute` check gating all four. Commit `d4b5610`.
- `CustomerMeasurementsForm.tsx`: the card was a fixed 520px regardless of
  viewport, but `VisualMeasurements`/`ThobeMeasurementSelector` both react to
  viewport width for their own wider-screen layouts (4 columns at sm:,
  side-by-side with a fixed 350px column at lg:) -- looked fine on a phone
  (narrow viewport anyway), cramped on desktop. Fixed with a scoped responsive
  `<style>` block widening the card at the same two breakpoints. Commit `6b767ce`.

## Global Constraints

- No new RPC and no `GRANT` to `anon` — all public reads/writes go through `server.ts` using `supabaseAdmin` with an explicit, hand-picked field list (spec §"القرار المعماري").
- Reuse the existing `checkTrackingRateLimit`/`tracking_attempts` limiter (`server.ts:345`) — no new rate-limit table.
- Reuse the existing `TRACKING_TOKEN_RE` UUID regex (`server.ts:303`) for token-format pre-checks on both new routes.
- The GET response returns only: `customer_name`, `shop_name`, `shop_logo_url`, `measurement_unit`, `measurements` — nothing else from `customers`/`tenants` (spec §3).
- `measurements_token`: `UUID NOT NULL DEFAULT gen_random_uuid()`, unique index — permanent, never expires, never single-use (spec decisions #2).
- Submitting the form saves immediately — no review/approval queue (spec decision #1).
- `VisualMeasurements.tsx` and `ThobeMeasurementSelector.tsx` are reused completely unchanged — no prop or behavior edits to either file (spec decision #3).
- `measurement_unit` default/fallback is `'inch'`, matching the existing `src/hooks/useMeasurementUnit.ts:6` default — not `'cm'`.

## Review Focus

- `POST` with `body.measurements` entirely missing (no key at all, not even `{}`) must return 400, not crash — pinned in Task 2.
- `thobeMeasurements: null` sent explicitly must be treated as "no sub-object provided" (dropped, not an error) rather than rejected — pinned in Task 2.
- A numeric field sent as a numeric *string* (e.g. `"140"` instead of `140`) must be rejected, not silently coerced — pinned in Task 2.
- `GET` for a customer whose `measurements` column is `null` (brand-new customer, never measured) must return `measurements: {}`, not throw — pinned in Task 3's manual verification (Task 3 has no automated route tests, matching the existing `/api/public/order-tracking/*` precedent).
- `GET`/`POST` for a customer whose `tenant` join comes back null (dangling/missing tenant row) must degrade `shop_name`/`shop_logo_url` to `''`/`null` gracefully, matching the existing `tenantData?.name || ''` pattern in the order-tracking route — pinned in Task 3's manual verification.

---

### Task 1: DB migration + `Customer.measurementsToken` type + query mapping

**Files:**
- Create: `supabase/migrations/20261113000000_customers_measurements_token.sql`
- Modify: `src/types/index.ts:103-118` (the `Customer` interface)
- Modify: `src/components/Customers.tsx:241-249` (`customersQuery`'s row-mapping `.map()`)

**Interfaces:**
- Produces: `Customer.measurementsToken?: string` (camelCase field), populated from `customers.measurements_token`. Tasks 3 and 5 both read this field.

No automated test for this task — it is schema/type/mapping only, matching this codebase's existing precedent for `orders.tracking_token` (no test file accompanies that migration either). Verified by type-checking and a manual DB check instead.

- [ ] **Step 1: Write the migration**

```sql
ALTER TABLE customers ADD COLUMN IF NOT EXISTS measurements_token UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_measurements_token ON customers (measurements_token);
```

- [ ] **Step 2: Add `measurementsToken?: string;` to the `Customer` interface in `src/types/index.ts`**, as the last field (after `city?: string;` on line 117).

- [ ] **Step 3: Add `measurementsToken: c.measurements_token` to the row-mapping object in `Customers.tsx`'s `customersQuery.queryFn`** (`src/components/Customers.tsx:241-249`), alongside the existing `isTest`/`isB2B`/`companyName`/`trn`/`createdAt`/`tenantId` lines.

- [ ] **Step 4: Run type check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Apply the migration to staging**

Run: `supabase db push` (staging project already linked per this session's established workflow).
Expected: migration applies cleanly; `select measurements_token from customers limit 1;` in the Supabase SQL editor returns a UUID for an existing row.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261113000000_customers_measurements_token.sql src/types/index.ts src/components/Customers.tsx
git commit -m "feat(customers): add permanent measurements_token for the public measurements form"
```

---

### Task 2: Measurements payload validator

**Files:**
- Create: `src/server/validateMeasurementsPayload.ts`
- Test: `src/server/validateMeasurementsPayload.test.ts`

**Interfaces:**
- Produces: `validateMeasurementsPayload(input: unknown): { ok: true; value: Measurements } | { ok: false; error: string }`. Task 3's POST route consumes this exact function and return shape.

This is the only piece of new logic in the feature, so it is the one task that gets full TDD with exhaustive cases — everything else in this plan is wiring around an already-established pattern.

**Allowed keys and limits (exact values from the spec, §3 "POST"):**
- Numeric fields (must be `number`, `Number.isFinite`, `0 <= n <= 300`): `length, shoulder, chest, waist, hips, sleeve, neck, bottomWidth, handWidth, midSleeveWidth, cuffLength`.
- `thobeMeasurements` (optional sub-object; `null` or omitted both mean "not provided" and are dropped, not an error): same `0-300` numeric rule applied to its own six keys `collar, chest, shoulders, sleeves, length, bottomWidth`. Any other key inside it is rejected.
- Free-text fields (must be `string`, `length <= 40`): `collarType, cuffType, pocketType, chestStyle, shoulderStyle, cuttingType`.
- Strict enums: `collarPadding` ∈ `['hard','soft']`, `closureType` ∈ `['zipper','buttons']`, `closureVisibility` ∈ `['hidden','visible']`.
- Any key in the input outside this list (at the top level or inside `thobeMeasurements`) → reject the whole payload.
- Top-level input that is not a plain object (e.g. `undefined`, `null`, an array, a string) → reject.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { validateMeasurementsPayload } from './validateMeasurementsPayload';

describe('validateMeasurementsPayload', () => {
  it('accepts a full valid payload', () => {
    const result = validateMeasurementsPayload({
      length: 140, chest: 52, collarType: 'classic', collarPadding: 'hard',
      thobeMeasurements: { collar: 40, chest: 52, shoulders: 45, sleeves: 60, length: 140, bottomWidth: 100 },
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a non-object top level input', () => {
    expect(validateMeasurementsPayload(undefined).ok).toBe(false);
    expect(validateMeasurementsPayload(null).ok).toBe(false);
    expect(validateMeasurementsPayload('x').ok).toBe(false);
    expect(validateMeasurementsPayload([1, 2]).ok).toBe(false);
  });

  it('rejects an unknown top-level key', () => {
    expect(validateMeasurementsPayload({ length: 140, hacked: true }).ok).toBe(false);
  });

  it('rejects an out-of-range numeric value', () => {
    expect(validateMeasurementsPayload({ chest: 301 }).ok).toBe(false);
    expect(validateMeasurementsPayload({ chest: -1 }).ok).toBe(false);
  });

  it('rejects a numeric field sent as a string', () => {
    expect(validateMeasurementsPayload({ chest: '52' }).ok).toBe(false);
  });

  it('rejects a free-text field over 40 characters', () => {
    expect(validateMeasurementsPayload({ collarType: 'x'.repeat(41) }).ok).toBe(false);
  });

  it('rejects an invalid enum value', () => {
    expect(validateMeasurementsPayload({ collarPadding: 'medium' }).ok).toBe(false);
  });

  it('rejects an unknown key inside thobeMeasurements', () => {
    expect(validateMeasurementsPayload({ thobeMeasurements: { collar: 40, hacked: 1 } }).ok).toBe(false);
  });

  it('treats thobeMeasurements: null as not provided', () => {
    const result = validateMeasurementsPayload({ chest: 52, thobeMeasurements: null });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.thobeMeasurements).toBeUndefined();
  });

  it('accepts an empty object (no fields changed)', () => {
    expect(validateMeasurementsPayload({}).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/server/validateMeasurementsPayload.test.ts`
Expected: FAIL — `validateMeasurementsPayload` is not defined / module not found.

- [ ] **Step 3: Implement `validateMeasurementsPayload(input: unknown): { ok: true; value: Measurements } | { ok: false; error: string }` in `src/server/validateMeasurementsPayload.ts`**

Import `Measurements` from `../types`. Use the allowed-keys/limits list above. Reject on the first violation found (top-level non-object → unknown key → per-field type/range/enum → `thobeMeasurements` unknown key → `thobeMeasurements` per-field range). `null`/`undefined` for any individual field (including `thobeMeasurements`) means "not provided," skip it — don't error and don't include it in `value`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/server/validateMeasurementsPayload.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 5: Commit**

```bash
git add src/server/validateMeasurementsPayload.ts src/server/validateMeasurementsPayload.test.ts
git commit -m "feat(server): add validator for public measurements-form submissions"
```

---

### Task 3: Public server routes

**Files:**
- Modify: `server.ts` — add one import near line 12, insert two routes after line 565 (end of the `/api/public/order-tracking/:token/subscribe` route), before the `sendPushAndPruneDeadTokens` comment on line 567.

**Interfaces:**
- Consumes: `validateMeasurementsPayload` (Task 2), `TRACKING_TOKEN_RE`, `checkTrackingRateLimit`, `clientIp`, `internalError` — all already defined earlier in `server.ts`. `customers.measurements_token` (Task 1).
- Produces: `GET /api/public/measurements/:token` and `POST /api/public/measurements/:token`, consumed by Task 4's public page.

No automated test for this task, matching the existing `/api/public/order-tracking/*` routes (acknowledged untested in `docs/reports/PUBLIC_TRACKING_SPEC.md`'s own acceptance checklist). Verified by manual `curl` against the local dev server.

- [ ] **Step 1: Add the import**

Near the existing imports (after `triggerBlogRebuild` on line 12):
```ts
import { validateMeasurementsPayload } from "./src/server/validateMeasurementsPayload.ts";
```

- [ ] **Step 2: Insert the two routes** after line 565 (`}));` closing the subscribe route), before the `sendPushAndPruneDeadTokens` comment on line 567:

```ts
app.get("/api/public/measurements/:token", asyncHandler(async (req, res) => {
  const { token } = req.params;
  const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");

  if (!TRACKING_TOKEN_RE.test(token)) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  const { allowed, recordFailure } = await checkTrackingRateLimit(supabaseAdmin, clientIp(req));
  if (!allowed) {
    return res.status(429).json({ error: 'محاولات كثيرة جداً. انتظر دقيقة ثم أعد المحاولة.' });
  }

  const { data: customerData } = await supabaseAdmin
    .from('customers')
    .select('name, measurements, tenant:tenants(name, logo_url, measurement_unit)')
    .eq('measurements_token', token)
    .maybeSingle();

  if (!customerData) {
    await recordFailure();
    return res.status(404).json({ error: 'Customer not found' });
  }

  const tenantData = (customerData as any).tenant;

  res.json({
    customer_name: customerData.name,
    shop_name: tenantData?.name || '',
    shop_logo_url: tenantData?.logo_url || null,
    measurement_unit: isValidMeasurementUnit(tenantData?.measurement_unit) ? tenantData.measurement_unit : 'inch',
    measurements: customerData.measurements || {},
  });
}));

app.post("/api/public/measurements/:token", asyncHandler(async (req, res) => {
  const { token } = req.params;
  const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");

  if (!TRACKING_TOKEN_RE.test(token)) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  const { allowed, recordFailure } = await checkTrackingRateLimit(supabaseAdmin, clientIp(req));
  if (!allowed) {
    return res.status(429).json({ error: 'محاولات كثيرة جداً. انتظر دقيقة ثم أعد المحاولة.' });
  }

  const result = validateMeasurementsPayload((req.body || {}).measurements);
  if (!result.ok) {
    return res.status(400).json({ error: result.error });
  }

  const { data: customerData } = await supabaseAdmin
    .from('customers')
    .select('id')
    .eq('measurements_token', token)
    .maybeSingle();

  if (!customerData) {
    await recordFailure();
    return res.status(404).json({ error: 'Customer not found' });
  }

  const { error: updateError } = await supabaseAdmin
    .from('customers')
    .update({ measurements: result.value })
    .eq('measurements_token', token);

  if (updateError) {
    return internalError(res, 'Error saving public measurements', updateError);
  }

  res.json({ ok: true });
}));
```

`isValidMeasurementUnit` is already imported at the top of `server.ts` (line 10) — no new import needed for it.

- [ ] **Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Manual verification against the local dev server**

Run the dev server (`npm run dev` or this project's existing dev command), then:
```bash
curl http://localhost:<port>/api/public/measurements/not-a-uuid
# Expected: 404 {"error":"Customer not found"}

curl http://localhost:<port>/api/public/measurements/<a real measurements_token from staging>
# Expected: 200 with customer_name/shop_name/shop_logo_url/measurement_unit/measurements

curl -X POST http://localhost:<port>/api/public/measurements/<same token> \
  -H "Content-Type: application/json" -d '{"measurements":{"chest":52}}'
# Expected: 200 {"ok":true}

curl -X POST http://localhost:<port>/api/public/measurements/<same token> \
  -H "Content-Type: application/json" -d '{"measurements":{"hacked":true}}'
# Expected: 400
```
Confirm in the Supabase staging dashboard that the customer's `measurements` column actually updated after the successful POST.

Also confirm, using a staging customer whose `measurements` column is `null` (a brand-new, never-measured customer — add one if none exists): the GET response for their token returns `"measurements":{}`, not a crash. And using a customer record whose `tenant_id` doesn't resolve (or by temporarily checking the code path logically if no such row exists on staging): `shop_name`/`shop_logo_url` degrade to `''`/`null` rather than throwing.

- [ ] **Step 5: Commit**

```bash
git add server.ts
git commit -m "feat(server): add public GET/POST routes for the customer measurements form"
```

---

### Task 4: Public page component + route

**Files:**
- Create: `src/components/public/CustomerMeasurementsForm.tsx`
- Modify: `src/App.tsx` (lazy import near line 17, a `MeasurementsRoute` wrapper near line 27, a `<Route>` near line 590)

**Interfaces:**
- Consumes: `GET`/`POST /api/public/measurements/:token` (Task 3). `VisualMeasurements` (`src/components/VisualMeasurements.tsx`, props `{ values, onChange, readOnly? }`). `ThobeMeasurementSelector` (`src/components/ThobeMeasurementSelector.tsx`, props `{ values, onChange, readOnly?, measurementUnit }`). `customerColors`/`customerFont`/`customerRadius` from `src/lib/customerAppTheme.ts`. `apiUrl` from `src/lib/apiBase.ts`.
- Produces: the `/measurements/:token` public route, which Task 5's "send link" buttons link to.

No automated test for this task, matching `OrderTracking.tsx` (same public-page category, also untested). Verified manually in the browser.

- [ ] **Step 1: Create `src/components/public/CustomerMeasurementsForm.tsx`**

Default export `CustomerMeasurementsForm({ token }: { token: string })`. Structure, modeled directly on `src/components/public/OrderTracking.tsx`:
- No Supabase import — `fetch(apiUrl(\`/api/public/measurements/${token}\`))` only.
- State: `loading`, `error`, `customerName`, `shopName`, `shopLogoUrl`, `measurementUnit` (default `'inch'`), `measurements` (the live, editable `Measurements` object the two child components read/write), `saving`, `saved`.
- On mount: `GET`, populate the state above from the response, or set `error` on non-200/network failure (reuse the same loading-skeleton/error-box visual pattern as `OrderTracking.tsx`).
- Body (once loaded, no error): same branded card shell (`customerColors`/`customerFont`/`customerRadius`, dark-mode-free since those tokens already resolve via CSS vars) showing the shop logo/name and `customerName`, then `<VisualMeasurements values={measurements} onChange={(field, value) => setMeasurements(m => ({ ...m, [field]: value }))} />` and `<ThobeMeasurementSelector values={measurements} onChange={setMeasurements} measurementUnit={measurementUnit} />`, then one "حفظ" button.
- On save: `POST` with `{ measurements }`; on 200 show a success message in place of the button (`saved` state); on non-200 show an inline error without losing the entered data.

- [ ] **Step 2: Wire the route in `src/App.tsx`**

Add near the existing lazy imports (after `OrderTracking`/`LandingPage` around line 17):
```ts
const CustomerMeasurementsForm = React.lazy(() => import('./components/public/CustomerMeasurementsForm'));
```
Add a wrapper mirroring `TrackRoute` (lines 20-27):
```ts
const MeasurementsRoute = () => {
  const { token } = useParams();
  return (
    <React.Suspense fallback={<PageSkeleton />}>
      <CustomerMeasurementsForm token={token || ''} />
    </React.Suspense>
  );
};
```
Add the route next to `/track/:token` (after line 590):
```tsx
<Route path="/measurements/:token" element={<MeasurementsRoute />} />
```

- [ ] **Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Manual verification in the browser**

Open `/measurements/<a real token>` in a private/incognito window (no logged-in session). Confirm: branded card loads, existing measurements (if any) are pre-filled, editing a value and clicking save shows a success state, reloading the same URL shows the just-saved value. Then open `/measurements/not-a-real-token` and confirm a clean error state, not a crash.

- [ ] **Step 5: Commit**

```bash
git add src/components/public/CustomerMeasurementsForm.tsx src/App.tsx
git commit -m "feat(public): add the customer measurements form page at /measurements/:token"
```

---

### Task 5: "Send link" UI in Customers.tsx

**Files:**
- Modify: `src/components/Customers.tsx`
- Modify: `src/i18n/locales/ar.json`
- Modify: `src/i18n/locales/en.json`

**Interfaces:**
- Consumes: `customer.measurementsToken` (Task 1), `sendWhatsAppMessage` (`src/utils/whatsapp.ts`, already imported project-wide), `useBranding` (`src/contexts/BrandingContext`, not yet imported in this file), the `/measurements/:token` route (Task 4).

No automated test for this task — UI wiring around an already-manual-tested send flow (`Orders.tsx`'s `sendTrackingLink` has no automated test either). Verified manually in the browser.

- [ ] **Step 1: Add the i18n strings**

`src/i18n/locales/ar.json`, next to `tracking_link_message` (around line 1922), add under the `customers` namespace:
```json
"measurement_link_message": "مرحباً {{customerName}}، يرجى تعبئة مقاساتك من الرابط التالي: {{url}}\n- {{storeName}}",
"send_measurements_link": "إرسال رابط المقاسات"
```
`src/i18n/locales/en.json`, same two keys under `customers`, English text:
```json
"measurement_link_message": "Hello {{customerName}}, please fill in your measurements here: {{url}}\n- {{storeName}}",
"send_measurements_link": "Send Measurements Link"
```

- [ ] **Step 2: Import `useBranding` and add the send handler**

Add `import { useBranding } from '../contexts/BrandingContext';` to the import block. Inside the component body (near other handlers), add:
```ts
const { settings: branding } = useBranding();

const sendMeasurementsLink = (customer: Customer) => {
  if (!customer.measurementsToken || !customer.phone) return;
  const url = `${window.location.origin}/measurements/${customer.measurementsToken}`;
  const message = t('customers.measurement_link_message', {
    customerName: customer.name,
    url,
    storeName: branding.companyName || t('pos.store_default'),
  });
  sendWhatsAppMessage(customer.phone, message);
};
```
`sendWhatsAppMessage` needs importing from `'../utils/whatsapp'` if not already imported in this file.

- [ ] **Step 3: Add a menu item to both per-customer action dropdowns**

Add, in both blocks (mobile around `src/components/Customers.tsx:1211-1223`, desktop around `:1516-1529` — both right after the existing "Create New Order" button, before the `canEdit` divider), a new button matching the existing style exactly:
```tsx
<button
  type="button"
  onClick={() => {
    setActiveMenuId(null);
    sendMeasurementsLink(customer);
  }}
  className="w-full flex items-center justify-between px-2.5 py-2 text-right rounded-xl text-xs font-bold text-content-muted hover:text-brand hover:bg-brand/5 transition-all cursor-pointer group"
>
  <span className="truncate">{t('customers.send_measurements_link')}</span>
  <div className="w-6 h-6 rounded-lg bg-brand/5 flex items-center justify-center shrink-0 group-hover:bg-brand/15 text-brand transition-all">
    <Ruler size={12} />
  </div>
</button>
```
`Ruler` is already imported in this file (line 17) — no new icon import needed.

- [ ] **Step 4: Add the button inside the edit-customer modal**

In the modal body, only when editing an existing customer (`editingCustomer` is truthy — a brand-new, unsaved customer has no `measurementsToken` yet), add a button near the phone field (after the phone/name grid around `src/components/Customers.tsx:1757`):
```tsx
{editingCustomer?.measurementsToken && (
  <button
    type="button"
    onClick={() => sendMeasurementsLink(editingCustomer)}
    className="mb-8 px-4 py-2.5 bg-brand/10 text-brand font-bold text-sm rounded-xl hover:bg-brand/20 transition-all flex items-center gap-2 w-fit"
  >
    <Ruler size={16} />
    {t('customers.send_measurements_link')}
  </button>
)}
```

- [ ] **Step 5: Run type check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Manual verification in the browser**

On staging: open the customers list, use the "..." menu on an existing customer, click "إرسال رابط المقاسات" — confirm a WhatsApp tab opens with the correct pre-filled message and a working `/measurements/:token` URL. Open the same customer's edit modal and confirm the same button there does the same thing. Confirm the button/menu item does *not* appear for a customer with no phone on file (or confirm the guard silently no-ops).

- [ ] **Step 7: Commit**

```bash
git add src/components/Customers.tsx src/i18n/locales/ar.json src/i18n/locales/en.json
git commit -m "feat(customers): add send-measurements-link action to customer list and edit modal"
```
