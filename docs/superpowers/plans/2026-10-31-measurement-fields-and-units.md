# Measurement Fields and Units Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace three thobe measurement fields (waist/hips/bottomWidth) with three new ones (handWidth/midSleeveWidth/cuffLength) in a fixed new order, and add a tenant-level measurement unit (cm/inch, default inch) that converts values at display/input boundaries while storage stays in cm.

**Architecture:** A pure conversion/validation utility (`measurementUnits.ts`) and the reordered field-set constant (`measurementWizardSteps.ts`) are the shared foundation everything else imports. A new lightweight hook (`useMeasurementUnit`) fetches the tenant's unit for screens that don't otherwise load the tenant row. Everything downstream (the interactive SVG selector, the voice wizard, the two list screens, the sanity-range checker, and Settings) consumes those two foundations without inventing its own conversion or field-order logic.

**Tech Stack:** React + TypeScript, Vitest + @testing-library/react, Supabase/Postgres (migration), Express (`server.ts`).

**Spec:** [docs/superpowers/specs/2026-10-31-measurement-fields-and-units-design.md](../specs/2026-10-31-measurement-fields-and-units-design.md)

## Global Constraints

- Internal storage of every measurement value stays in cm, always — never store inches.
- Conversion happens only at display and input boundaries (never inside stored state).
- Every conversion rounds to the nearest 0.1.
- No migration or deletion of historical `waist`/`hips`/`bottomWidth` data — it stays wherever it's already stored, and keeps appearing in read-only historical displays.
- The measurement unit is a tenant-level setting only (no branch/employee override).
- Default unit for a tenant with no explicit choice is `'inch'`.
- New field order everywhere the 8 fields are shown in sequence: `length → shoulder → sleeve → chest → neck → handWidth → midSleeveWidth → cuffLength`.

## Review Focus

- Round-trip rounding: converting a cm value to the active unit and back must not drift by more than 0.1 — tested in Task 1.
- Any `measurement_unit` value other than exactly `'cm'`/`'inch'` (including missing/null) must be treated as `'inch'` everywhere it's read or written, never thrown or silently stored — tested in Task 1 (`isValidMeasurementUnit`) and Task 4 (hook) and Task 9 (server validation).
- The legacy removed fields (`waist`/`hips`/`bottomWidth`), still shown in historical read-only displays, must be converted to the tenant's active unit exactly like the new fields — not left in raw cm while the rest of the screen shows inches — covered in Task 7.
- `useMeasurementUnit` must never block or error the host screen while its fetch is in flight or fails — it stays at the `'inch'` default — tested in Task 4.
- The sanity-range warning message (`aiService.ts`) must show the out-of-range value/min/max converted to the active unit, not always cm — tested in Task 8.

---

### Task 1: Unit conversion and validation utility

**Files:**
- Create: `src/utils/measurementUnits.ts`
- Test: `src/utils/measurementUnits.test.ts`

**Interfaces:**
- Produces: `export type MeasurementUnit = 'cm' | 'inch'`; `export function isValidMeasurementUnit(value: unknown): value is MeasurementUnit`; `export function cmToDisplayUnit(cm: number, unit: MeasurementUnit): number`; `export function displayUnitToCm(value: number, unit: MeasurementUnit): number`; `export function unitLabelKey(unit: MeasurementUnit): string` (returns the i18n key `'measurements.unit_cm'` or `'measurements.unit_inch'`, not the resolved text — callers call `t(unitLabelKey(unit))`).

- [ ] **Step 1: Write the failing tests**

```ts
import { test, expect } from 'vitest';
import { isValidMeasurementUnit, cmToDisplayUnit, displayUnitToCm, unitLabelKey } from './measurementUnits';

test('isValidMeasurementUnit accepts only cm and inch', () => {
  expect(isValidMeasurementUnit('cm')).toBe(true);
  expect(isValidMeasurementUnit('inch')).toBe(true);
  expect(isValidMeasurementUnit('foo')).toBe(false);
  expect(isValidMeasurementUnit(undefined)).toBe(false);
  expect(isValidMeasurementUnit(null)).toBe(false);
  expect(isValidMeasurementUnit(123)).toBe(false);
});

test('cm stays unchanged in cm mode', () => {
  expect(cmToDisplayUnit(40, 'cm')).toBe(40);
});

test('converts cm to inch, rounded to the nearest 0.1', () => {
  expect(cmToDisplayUnit(40, 'inch')).toBe(15.7); // 40 / 2.54 = 15.748...
});

test('value stays unchanged in cm mode', () => {
  expect(displayUnitToCm(40, 'cm')).toBe(40);
});

test('converts inch to cm, rounded to the nearest 0.1', () => {
  expect(displayUnitToCm(15.7, 'inch')).toBe(39.9); // 15.7 * 2.54 = 39.878
});

test('a value round-trips through inch and back to cm within 0.1', () => {
  const original = 100;
  const asInch = cmToDisplayUnit(original, 'inch');
  const backToCm = displayUnitToCm(asInch, 'inch');
  expect(Math.abs(backToCm - original)).toBeLessThanOrEqual(0.1);
});

test('unitLabelKey returns the i18n key for each unit', () => {
  expect(unitLabelKey('cm')).toBe('measurements.unit_cm');
  expect(unitLabelKey('inch')).toBe('measurements.unit_inch');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- measurementUnits --run`
Expected: FAIL — `Cannot find module './measurementUnits'`

- [ ] **Step 3: Implement `src/utils/measurementUnits.ts`**

`CM_PER_INCH = 2.54`. Round every conversion with `Math.round(value * 10) / 10`. `cmToDisplayUnit`/`displayUnitToCm` assume a valid `MeasurementUnit` (callers validate at the boundary with `isValidMeasurementUnit` before trusting external data, per Task 4/Task 9).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- measurementUnits --run`
Expected: PASS, 7/7

- [ ] **Step 5: Commit**

```bash
git add src/utils/measurementUnits.ts src/utils/measurementUnits.test.ts
git commit -m "feat: add measurement unit conversion and validation utility"
```

---

### Task 2: Types and the new field order

**Files:**
- Modify: `src/types/index.ts:12-31` (`Measurements`), `src/types/index.ts:51-76` (`Tenant`)
- Modify: `src/utils/measurementWizardSteps.ts`
- Modify: `src/utils/measurementWizardSteps.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `Measurements` gains `handWidth?: number`, `midSleeveWidth?: number`, `cuffLength?: number` (keeps `waist?`, `hips?`, `bottomWidth?` as-is — do not remove them from the type, only from editing UI in later tasks). `Tenant` gains `measurementUnit?: 'cm' | 'inch'`. `measurementWizardSteps.ts`'s `ThobePart` union becomes `'neck' | 'chest' | 'shoulder' | 'sleeve' | 'length' | 'handWidth' | 'midSleeveWidth' | 'cuffLength'` (drops `'waist' | 'hips' | 'bottomWidth'`), and `MEASUREMENT_WIZARD_ORDER` becomes `['length', 'shoulder', 'sleeve', 'chest', 'neck', 'handWidth', 'midSleeveWidth', 'cuffLength']`. `getNextMeasurementStep` keeps its existing signature.

- [ ] **Step 1: Update the failing test**

Replace the existing `measurementWizardSteps.test.ts` body:

```ts
import { test, expect } from 'vitest';
import { getNextMeasurementStep, MEASUREMENT_WIZARD_ORDER } from './measurementWizardSteps';

test('starts at the first field', () => {
  expect(getNextMeasurementStep(-1)).toBe('length');
});

test('advances through all 8 fields in the new order', () => {
  expect(MEASUREMENT_WIZARD_ORDER).toEqual([
    'length', 'shoulder', 'sleeve', 'chest', 'neck', 'handWidth', 'midSleeveWidth', 'cuffLength',
  ]);
  expect(getNextMeasurementStep(0)).toBe('shoulder');
  expect(getNextMeasurementStep(6)).toBe('cuffLength');
});

test('returns null after the last field', () => {
  expect(getNextMeasurementStep(7)).toBeNull();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- measurementWizardSteps --run`
Expected: FAIL — `getNextMeasurementStep(-1)` still returns `'neck'`, not `'length'`.

- [ ] **Step 3: Update `measurementWizardSteps.ts`'s `ThobePart` union and `MEASUREMENT_WIZARD_ORDER`**

Per the Produces block above. `getNextMeasurementStep`'s body is unchanged (it's an index lookup, independent of the array's contents).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- measurementWizardSteps --run`
Expected: PASS, 3/3

- [ ] **Step 5: Update `src/types/index.ts`**

Add the three new optional fields to `Measurements` and `measurementUnit?: 'cm' | 'inch'` to `Tenant`, per the Produces block. No test (type-only change) — verified by Step 6.

- [ ] **Step 6: Run the typechecker**

Run: `npm run lint`
Expected: no new errors (existing `ThobeMeasurementSelector.tsx`'s own duplicated `ThobePart` union still has `waist`/`hips`/`bottomWidth` until Task 6 — this task does not touch that file, so no cross-file type error is expected yet).

- [ ] **Step 7: Commit**

```bash
git add src/types/index.ts src/utils/measurementWizardSteps.ts src/utils/measurementWizardSteps.test.ts
git commit -m "feat: redefine measurement fields and wizard order"
```

---

### Task 3: Database migration for the tenant measurement unit

**Files:**
- Create: `supabase/migrations/20261107000000_tenants_measurement_unit.sql`

**Interfaces:**
- Produces: `tenants.measurement_unit TEXT NOT NULL DEFAULT 'inch' CHECK (measurement_unit IN ('cm', 'inch'))`.

- [ ] **Step 1: Write the migration**

```sql
ALTER TABLE tenants
  ADD COLUMN measurement_unit TEXT NOT NULL DEFAULT 'inch'
  CHECK (measurement_unit IN ('cm', 'inch'));
```

- [ ] **Step 2: Apply it to the staging project and verify the column**

Run: `supabase db push` (already linked to project `yodvqhdjzjyhvrlhguzf` per `supabase/.temp/project-ref` — staging only, per this project's standing rule to never push migrations to production without being asked)
Expected: migration applies cleanly; a `select measurement_unit from tenants limit 1;` via the Supabase SQL editor or `supabase db execute` returns `'inch'` for an existing row.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20261107000000_tenants_measurement_unit.sql
git commit -m "feat: add tenants.measurement_unit column"
```

---

### Task 4: `useMeasurementUnit` hook

**Files:**
- Create: `src/hooks/useMeasurementUnit.ts`
- Test: `src/hooks/useMeasurementUnit.test.ts`

**Interfaces:**
- Consumes: `MeasurementUnit`, `isValidMeasurementUnit` from Task 1 (`src/utils/measurementUnits.ts`); the `supabase` client from `src/lib/supabase/client.ts`.
- Produces: `export function useMeasurementUnit(tenantId: string): MeasurementUnit` — queries `tenants.measurement_unit` for `tenantId` once on mount/`tenantId` change, defaults to and stays at `'inch'` until (and unless) a valid `'cm'` value resolves; never throws to the caller.

- [ ] **Step 1: Write the failing tests**

```ts
// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { test, expect, vi } from 'vitest';
import { useMeasurementUnit } from './useMeasurementUnit';

const maybeSingle = vi.fn();
vi.mock('../lib/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle }),
      }),
    }),
  },
}));

test('defaults to inch before the fetch resolves', () => {
  maybeSingle.mockReturnValue(new Promise(() => {})); // never resolves within this test
  const { result } = renderHook(() => useMeasurementUnit('tenant-1'));
  expect(result.current).toBe('inch');
});

test('switches to cm when the tenant has measurement_unit = cm', async () => {
  maybeSingle.mockResolvedValue({ data: { measurement_unit: 'cm' }, error: null });
  const { result } = renderHook(() => useMeasurementUnit('tenant-1'));
  await waitFor(() => expect(result.current).toBe('cm'));
});

test('stays at inch on a query error', async () => {
  maybeSingle.mockResolvedValue({ data: null, error: { message: 'boom' } });
  const { result } = renderHook(() => useMeasurementUnit('tenant-1'));
  await waitFor(() => expect(maybeSingle).toHaveBeenCalled());
  expect(result.current).toBe('inch');
});

test('stays at inch when the column value is null or unexpected', async () => {
  maybeSingle.mockResolvedValue({ data: { measurement_unit: null }, error: null });
  const { result } = renderHook(() => useMeasurementUnit('tenant-1'));
  await waitFor(() => expect(maybeSingle).toHaveBeenCalled());
  expect(result.current).toBe('inch');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- useMeasurementUnit --run`
Expected: FAIL — `Cannot find module './useMeasurementUnit'`

- [ ] **Step 3: Implement `src/hooks/useMeasurementUnit.ts`**

`useState<MeasurementUnit>('inch')`, `useEffect` keyed on `tenantId` that calls `supabase.from('tenants').select('measurement_unit').eq('id', tenantId).maybeSingle()`, and on a resolved, non-cancelled result sets the unit to `data.measurement_unit` only when `isValidMeasurementUnit(data?.measurement_unit)` is true (covers the null/unexpected-value case in one guard — no separate branch needed). A `cancelled` flag in the effect's cleanup avoids setting state after unmount. No early return when `tenantId` is falsy is required beyond the query naturally returning no row.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- useMeasurementUnit --run`
Expected: PASS, 4/4

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useMeasurementUnit.ts src/hooks/useMeasurementUnit.test.ts
git commit -m "feat: add useMeasurementUnit hook"
```

---

### Task 5: `VoiceMeasurementWizard` — unit-aware voice entry

**Files:**
- Modify: `src/components/VoiceMeasurementWizard.tsx`

**Interfaces:**
- Consumes: `MeasurementUnit`, `cmToDisplayUnit`, `displayUnitToCm` from Task 1.
- Produces: `VoiceMeasurementWizardProps` gains `measurementUnit: MeasurementUnit` (required) — `ThobeMeasurementSelector` (Task 6) will pass this prop once this task lands.

No test — this component has no existing test file, and the project has no precedent for unit-testing this kind of SVG/speech-heavy component (same rationale applies to `ThobeMeasurementSelector.tsx` in Task 6). Verified by typecheck + manual voice test on staging (Step 4).

- [ ] **Step 1: Add `measurementUnit: MeasurementUnit` to `VoiceMeasurementWizardProps` (lines 18-22)**

Import `MeasurementUnit`, `displayUnitToCm`, `cmToDisplayUnit` from `../utils/measurementUnits`. Destructure `measurementUnit` in the component's parameter list (line 28).

- [ ] **Step 2: Convert the parsed value to cm before saving (lines 106-126)**

`parseArabicNumber(transcript)` itself is unchanged — it still returns a plain number in whatever unit the spoken word represents conceptually (the function has no unit awareness; it just parses a spoken number). Immediately after the `value === null` null-check (line 113), before `onChange` (line 118), convert: `const valueInCm = displayUnitToCm(value, measurementUnit);` and use `valueInCm` in the `onChange({ ...values, [activePart]: valueInCm })` call, so the stored value matches cm everywhere else. For the on-screen "✓ label: value" confirmation, convert back for display so it matches the active unit rather than showing a raw cm number: `setLastResult({ part: activePart, value: cmToDisplayUnit(valueInCm, measurementUnit) })`.

- [ ] **Step 3: Typecheck**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Manual verification on staging**

With the tenant's unit set to inch, open the voice wizard, speak a number for one field, confirm the on-screen "✓ label: value" confirmation shows the inch value, and that the saved measurement (re-opening the editor) shows the same inch value — i.e. no double conversion.

- [ ] **Step 5: Commit**

```bash
git add src/components/VoiceMeasurementWizard.tsx
git commit -m "feat: convert voice-entered measurements to the active unit"
```

---

### Task 6: `ThobeMeasurementSelector` — new fields, order, and unit-aware display

**Files:**
- Modify: `src/components/ThobeMeasurementSelector.tsx`

**Interfaces:**
- Consumes: `MeasurementUnit`, `cmToDisplayUnit`, `displayUnitToCm`, `unitLabelKey` from Task 1; `ThobePart` shape from Task 2 (this file's own duplicated union, per the file's existing top-of-file comment, must be kept in sync by hand — not imported); `VoiceMeasurementWizardProps`'s new `measurementUnit` prop from Task 5.
- Produces: `ThobeMeasurementSelectorProps` gains `measurementUnit: MeasurementUnit` (required), passed through to `VoiceMeasurementWizard`.

No test (this file has no existing test file, and the project has no precedent for unit-testing this SVG-heavy component — see `src/components/VoiceMeasurementWizard.tsx`, also untested). Verified by typecheck + a manual check in the browser (Step 6).

- [ ] **Step 1: Update the local `ThobePart` union and `PART_LABELS`/`PART_HINTS` (lines 17-39)**

`ThobePart` becomes `'neck' | 'chest' | 'shoulder' | 'sleeve' | 'length' | 'handWidth' | 'midSleeveWidth' | 'cuffLength'`. Rebuild `PART_LABELS`/`PART_HINTS` as object literals in the new order (`length, shoulder, sleeve, chest, neck, handWidth, midSleeveWidth, cuffLength`) with keys `measurements.part_label.<field>` / `measurements.part_hint.<field>` — the three new keys are added to the locale files in Step 7 of this task.

- [ ] **Step 2: Add `measurementUnit: MeasurementUnit` to `ThobeMeasurementSelectorProps` (lines 11-15)**

Import `MeasurementUnit`, `cmToDisplayUnit`, `displayUnitToCm`, `unitLabelKey` from `../utils/measurementUnits`.

- [ ] **Step 3: Remove the three old SVG regions and add three new ones**

Remove `part-waist` (lines 203-220), `part-hips` (222-239), `part-bottomWidth` (300-318) entirely, including their `aria-label`/`onClick`/`onKeyDown` wiring.

Add three new clickable regions near the existing sleeve group (242-275), each a `motion.g` with a left+right circle pair (mirroring the existing `part-sleeve` group's left/right-arm pattern), `role="button"`, `tabIndex={readOnly ? -1 : 0}`, `aria-label={t(PART_LABELS.<field>)}`, `onClick={() => handlePartClick('<field>')}`, `onKeyDown={handlePartKeyDown('<field>')}`, filled/stroked with `highlightColor` when `activePart === '<field>'` exactly like the existing regions:

- `part-handWidth`: circles radius 12 at `(35, 495)` and `(365, 495)` (sleeve wrist tips, next to the existing decorative "Cuff Details" lines at 270-274).
- `part-midSleeveWidth`: circles radius 12 at `(40, 330)` and `(360, 330)` (midpoint of each sleeve path).
- `part-cuffLength`: circles radius 12 at `(35, 470)` and `(365, 470)` (just above the hand-width markers, over the existing cuff decoration).

These coordinates are an approximate starting placement on the existing garment SVG (`viewBox="0 0 400 800"`) — not pixel-exact per the spec; adjust visually in Step 6 if they visibly overlap or sit off the garment outline.

- [ ] **Step 4: Update the "Value Labels" section (320-363)**

Remove the `case 'waist'`, `case 'hips'`, `case 'bottomWidth'` branches. Add:

```ts
case 'handWidth': coords = { x: 35, y: 495 }; break;
case 'midSleeveWidth': coords = { x: 40, y: 330 }; break;
case 'cuffLength': coords = { x: 35, y: 470 }; break;
```

Each label's displayed number (`{val}` at line 358) becomes `{cmToDisplayUnit(val, measurementUnit)}` — every stored value here is cm, converted for display only.

- [ ] **Step 5: Update the input list (lines 402-461) for unit-aware display/input and the new order**

The list already iterates `Object.keys(PART_LABELS)`, so it follows the new order automatically once Step 1 rebuilds `PART_LABELS` in the new order. Two changes inside the loop:
- The `input`'s `value` (line 450, currently `(values as any)[part] || ''`) becomes `(values as any)[part] ? cmToDisplayUnit((values as any)[part], measurementUnit) : ''`.
- `handleInputChange` (lines 62-66): the parsed `numValue` is the value the user typed in the active unit — convert it to cm before calling `onChange`: `onChange({ ...values, [part]: displayUnitToCm(numValue, measurementUnit) })`.
- The hardcoded unit label (line 457, `{t('customers.cm')}`) becomes `{t(unitLabelKey(measurementUnit))}`.

- [ ] **Step 6: Pass `measurementUnit` through to the voice wizard (line 399)**

`<VoiceMeasurementWizard values={values} onChange={onChange} onClose={...} measurementUnit={measurementUnit} />` — `VoiceMeasurementWizard` already accepts this prop from Task 5, so this typechecks immediately.

- [ ] **Step 7: Add the three new locale keys to `src/i18n/locales/{ar,en,ur}.json`**

Under `measurements.part_label` and `measurements.part_hint` in all three files (`measurements.handWidth`/`.midSleeveWidth`/`.cuffLength` flat keys are added in Task 7, where they're first consumed):

| key | ar | en | ur |
|---|---|---|---|
| `part_label.handWidth` | وسع اليد | Hand Width | ہاتھ کی چوڑائی |
| `part_label.midSleeveWidth` | وسط الكم | Mid-Sleeve Width | آستین کا درمیانی گھیر |
| `part_label.cuffLength` | طول الكبك | Cuff Length | کف کی لمبائی |
| `part_hint.handWidth` | قم بقياس محيط اليد عند الرسغ. | Measure around the hand at the wrist. | کلائی کے گرد ہاتھ کی پیمائش کریں۔ |
| `part_hint.midSleeveWidth` | قم بقياس عرض الكم عند منتصف المسافة بين الكتف والرسغ. | Measure the sleeve width at the midpoint between the shoulder and the wrist. | کندھے اور کلائی کے درمیان آستین کی چوڑائی ناپیں۔ |
| `part_hint.cuffLength` | قم بقياس طول كبك الكم من بدايته حتى نهايته. | Measure the cuff length from its start to its end. | کف کی لمبائی شروع سے آخر تک ناپیں۔ |
| `unit_cm` (under `measurements`, not `part_label`) | سم | cm | سینٹی میٹر |
| `unit_inch` (under `measurements`, not `part_label`) | إنش | in | انچ |

`measurements.waist`, `.hips`, `.bottomWidth` and their `part_label`/`part_hint` entries are left untouched (still read by `Orders.tsx`/`Customers.tsx` in Task 7).

- [ ] **Step 8: Typecheck**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 9: Manual verification in the browser**

Open a customer's measurement editor on a local/staging build, confirm: the 8 fields render in the new order with the new labels, the three new SVG regions are clickable and focus their input, entering a number and switching the tenant's unit (once Task 9 ships) changes the displayed number consistently.

- [ ] **Step 10: Commit**

```bash
git add src/components/ThobeMeasurementSelector.tsx src/i18n/locales/ar.json src/i18n/locales/en.json src/i18n/locales/ur.json
git commit -m "feat: redefine thobe measurement fields and wire unit-aware display"
```

---

### Task 7: `Orders.tsx` / `Customers.tsx` — unit-aware display, including legacy fields

**Files:**
- Modify: `src/components/Customers.tsx:1805-1812` (editable `ThobeMeasurementSelector` call), `src/components/Customers.tsx:2077-2082` (read-only call)
- Modify: `src/components/Orders.tsx:1938-1945`, `src/components/Orders.tsx:3234-3239`, `src/components/Orders.tsx:3269-3276`
- Modify: `src/i18n/locales/{ar,en,ur}.json` (flat `measurements.handWidth`/`.midSleeveWidth`/`.cuffLength` keys)

**Interfaces:**
- Consumes: `useMeasurementUnit` from Task 4; `cmToDisplayUnit`, `unitLabelKey` from Task 1; `measurementUnit` prop on `ThobeMeasurementSelector` from Task 6.

No test (same rationale as Tasks 5-6: these are large untested screen components). Verified by typecheck + manual check (Step 4).

- [ ] **Step 1: Wire `useMeasurementUnit` into both files**

Both components already receive `tenantId` as a prop. Add `const measurementUnit = useMeasurementUnit(tenantId);` near their other hook calls, and import it from `../hooks/useMeasurementUnit`.

- [ ] **Step 2: Pass `measurementUnit` to both `ThobeMeasurementSelector` calls in `Customers.tsx`**

Add `measurementUnit={measurementUnit}` to the calls at lines 1805 and 2077.

- [ ] **Step 3: Update all five display-list sites to convert every measurement value (new and legacy) to the active unit**

At each of the five sites (`Customers.tsx` doesn't have display lists beyond the `ThobeMeasurementSelector` calls already covered in Step 2; the five list sites are all in `Orders.tsx`: 1938-1945, 3234-3239, 3269-3276 plus the already-covered selector calls), two things change together:

1. Add three new entries for `handWidth`, `midSleeveWidth`, `cuffLength` using the new flat locale keys (`measurements.handWidth` etc., added in Step 5 below), following the exact same `{ label: t('measurements.<field>'), value: ...measurements?.<field> }` shape already used for every other field at that site.
2. **Every** entry's `value` (both the pre-existing fields including `waist`/`hips`/`bottomWidth`, and the three new ones) is wrapped: `value: typeof raw === 'number' ? cmToDisplayUnit(raw, measurementUnit) : raw` — this is the fix for the Review Focus item: legacy fields must convert too, not just new ones. Where the site renders the value with a trailing unit string (check each site's surrounding JSX — if none currently shows a unit suffix, add one next to the number using `t(unitLabelKey(measurementUnit))`, matching the existing visual pattern at that site, e.g. "40 إنش" instead of a bare "40").

- [ ] **Step 4: Typecheck and manually verify**

Run: `npm run lint` — expect no errors.

Manually on staging: set the tenant's unit to inch in Settings (once Task 9 ships), open a customer with `waist` data from before this change, confirm that legacy value now displays in inch too, not cm.

- [ ] **Step 5: Add the three flat locale keys**

Under `measurements` (flat, sibling to `measurements.waist`/`.hips`/`.neck` etc., not nested under `part_label`) in `ar.json`/`en.json`/`ur.json`:

| key | ar | en | ur |
|---|---|---|---|
| `measurements.handWidth` | وسع اليد | Hand Width | ہاتھ کی چوڑائی |
| `measurements.midSleeveWidth` | وسط الكم | Mid-Sleeve Width | آستین کا درمیانی گھیر |
| `measurements.cuffLength` | طول الكبك | Cuff Length | کف کی لمبائی |

- [ ] **Step 6: Commit**

```bash
git add src/components/Customers.tsx src/components/Orders.tsx src/i18n/locales/ar.json src/i18n/locales/en.json src/i18n/locales/ur.json
git commit -m "feat: show unit-converted measurements (including legacy fields) in order/customer screens"
```

---

### Task 8: `aiService.ts` — new field ranges and unit-aware warning message

**Files:**
- Modify: `src/services/aiService.ts:35-43` (`SANE_RANGES`), `:51-81` (`ruleBasedMeasurementChecks`), `:174-183` (`labelOf`)
- Create: `src/services/aiService.test.ts`

**Interfaces:**
- Consumes: `MeasurementUnit`, `cmToDisplayUnit` from Task 1.
- Produces: `ruleBasedMeasurementChecks(current: Measurements, history: Measurements[] = [], unit: MeasurementUnit = 'cm'): MeasurementFlag[]` — unchanged return shape, new optional third parameter. `checkMeasurementAnomalies` is not changed in this task (it has no caller anywhere in the app — out of scope per the spec; only `ruleBasedMeasurementChecks` itself needs updating, and `checkMeasurementAnomalies`'s own call to it can stay with the default `'cm'` unit).

- [ ] **Step 1: Write the failing tests**

```ts
import { test, expect, vi, afterEach } from 'vitest';
import i18n from 'i18next';
import { ruleBasedMeasurementChecks } from './aiService';

afterEach(() => { vi.restoreAllMocks(); });

test('out-of-range flag interpolates the value/min/max converted to the active unit', () => {
  const spy = vi.spyOn(i18n, 't');
  ruleBasedMeasurementChecks({ chest: 200 }, [], 'inch');
  const call = spy.mock.calls.find(([key]) => key === 'measurements.flag_out_of_range');
  expect(call?.[1]).toMatchObject({
    value: 78.7,  // 200 / 2.54, rounded to 0.1
    min: 33.5,    // 85 / 2.54
    max: 55.1,    // 140 / 2.54
    unit: 'measurements.unit_inch',
  });
});

test('defaults to cm (unconverted) when no unit is passed', () => {
  const spy = vi.spyOn(i18n, 't');
  ruleBasedMeasurementChecks({ chest: 200 });
  const call = spy.mock.calls.find(([key]) => key === 'measurements.flag_out_of_range');
  expect(call?.[1]).toMatchObject({ value: 200, min: 85, max: 140, unit: 'measurements.unit_cm' });
});

test('new fields are checked against their own ranges', () => {
  const flags = ruleBasedMeasurementChecks({ handWidth: 5 }); // below the sane minimum
  expect(flags.some((f) => f.field === 'handWidth')).toBe(true);
});

test('waist and hips are no longer checked', () => {
  const flags = ruleBasedMeasurementChecks({ waist: 1, hips: 1 }); // would have flagged under the old ranges
  expect(flags).toHaveLength(0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- aiService --run`
Expected: FAIL — `ruleBasedMeasurementChecks` doesn't accept a third argument yet; `waist`/`hips` still flag; `handWidth` isn't in `SANE_RANGES`.

- [ ] **Step 3: Implement the changes**

`SANE_RANGES`: remove `waist`/`hips` entries, add `handWidth: [18, 28]`, `midSleeveWidth: [10, 18]`, `cuffLength: [5, 12]` (estimated ranges per the spec, flagged there as adjustable).

`ruleBasedMeasurementChecks(current, history = [], unit: MeasurementUnit = 'cm')`: in the range-check block (58-81), convert `val`, `range[0]`, `range[1]` through `cmToDisplayUnit(x, unit)` before passing them as `value`/`min`/`max` to `i18n.t('measurements.flag_out_of_range', {...})`, and add `unit: unitLabelKey(unit)` to that same interpolation object. The `flag_invalid_value` message (line 66) is unaffected (it only ever shows a `<= 0` value, which is the same number regardless of unit).

`labelOf` (174-183): add `handWidth: 'measurements.label.handWidth'`, `midSleeveWidth: 'measurements.label.midSleeveWidth'`, `cuffLength: 'measurements.label.cuffLength'` to its map, matching the existing (already-unresolved — `measurements.label.*` keys don't exist in any locale file today, confirmed during planning) convention for this specific map. Do not add these three keys to the locale files — that would fix a pre-existing, out-of-scope issue affecting every other field in this same map.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- aiService --run`
Expected: PASS, 4/4

- [ ] **Step 5: Commit**

```bash
git add src/services/aiService.ts src/services/aiService.test.ts
git commit -m "feat: update measurement sanity ranges and unit-aware warning messages"
```

---

### Task 9: Settings — tenant measurement unit control

**Files:**
- Modify: `src/components/Settings.tsx` (profile tab form, ~line 630 area; `onSave`, lines 340-410)
- Modify: `server.ts:1217-1283` (GET `/api/tenant/settings`), `server.ts:1285-1356` (POST `/api/tenant/settings`)
- Modify: `src/i18n/locales/{ar,en,ur}.json`

**Interfaces:**
- Consumes: `MeasurementUnit`, `isValidMeasurementUnit` from Task 1.

No new automated test: `server.ts`'s route handlers have no existing test harness in this project (confirmed during planning — none of the four `src/server/*.test.ts` files test an Express route directly), and `Settings.tsx` has no existing test file, consistent with every other large screen component touched in this plan. Verified by typecheck + a manual check (Step 5).

- [ ] **Step 1: Add the unit field to the profile tab form in `Settings.tsx`**

Near the existing address/city fields in the `activeTab === 'profile'` form (~line 670-680 area), add a labeled `<select>` (two options: cm/inch) registered as `register('measurementUnit')`, titled with a new key `settings_page.profile.measurement_unit`. Follow the existing field markup pattern in that form (label + `HelpCircle` icon row, as used for `store_name`/`phone`).

- [ ] **Step 2: Thread the field through `onSave` (lines 340-410)**

Add `measurementUnit: data.measurementUnit` to the POST body sent to `/api/tenant/settings` (line ~358-369), and `measurement_unit: data.measurementUnit` to `updatePayload` in the direct-Supabase fallback path (line ~379-395).

- [ ] **Step 3: Update `server.ts`'s GET handler (1217-1283)**

Add `measurementUnit: isValidMeasurementUnit(tenant.measurement_unit) ? tenant.measurement_unit : 'inch'` to the response body (alongside `taxSettings`/`notificationSettings`).

- [ ] **Step 4: Update `server.ts`'s POST handler (1285-1356)**

Mirror the existing `vatRate` validation pattern (lines 1315-1320): if `data.measurementUnit !== undefined && !isValidMeasurementUnit(data.measurementUnit)`, return `400` with an Arabic error message (e.g. `'وحدة القياس يجب أن تكون سم أو إنش'`). Otherwise add `measurement_unit: data.measurementUnit` to `updatePayload` only when it was provided (don't overwrite the column with `undefined` when the field is absent from the request body).

- [ ] **Step 5: Add the locale key and verify**

Add `settings_page.profile.measurement_unit` to all three locale files: ar `"وحدة القياس الافتراضية للمقاسات"`, en `"Default Measurement Unit"`, ur `"پیمائش کی ڈیفالٹ اکائی"`.

Run: `npm run lint` — expect no errors.

Manually on staging: open Settings → الملف الشخصي, change the unit, save, reload the page, confirm the selection persisted; then open a customer's measurement editor and confirm the displayed unit label matches.

- [ ] **Step 6: Commit**

```bash
git add src/components/Settings.tsx server.ts src/i18n/locales/ar.json src/i18n/locales/en.json src/i18n/locales/ur.json
git commit -m "feat: add tenant measurement unit setting"
```
