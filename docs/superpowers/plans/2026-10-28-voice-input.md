# Voice Input (Search, Measurements, Data Entry) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add voice input (Arabic only) to search boxes, the thobe measurement entry screen, and five specific data-entry fields, built on one shared Web Speech API primitive.

**Architecture:** A `useSpeechRecognition` hook wraps the browser's native `SpeechRecognition`/`webkitSpeechRecognition` (single-shot, `lang: 'ar-SA'`). A presentational `VoiceMicButton` renders nothing when the API is unsupported and otherwise calls an `onResult(transcript)` callback. Search boxes and data-entry fields each wire that callback straight into their existing `onChange`/`setValue`/`setFormData` call — no new state model anywhere. The measurement screen gets its own sequencing component, `VoiceMeasurementWizard`, that speaks each of the 8 field prompts via `speechSynthesis`, listens once per field, and fills the same `ThobeMeasurementSelector` inputs a manual edit would.

**Tech Stack:** Web Speech API (`SpeechRecognition`, `SpeechSynthesisUtterance`) — no new npm dependency, no backend change.

**Spec:** `docs/superpowers/specs/2026-10-28-voice-input-design.md`

## Global Constraints

- Voice recognition and TTS prompts are **Arabic only** (`ar-SA`), regardless of the merchant's selected UI language (en/ur included) — this is a spec decision, not a technical limit.
- No new **runtime/production** npm dependency (no external speech-to-text SaaS SDK, no paid API client) — Web Speech API is browser-native. No migration, no RPC, no server change — 100% client-side. New **devDependencies** for testing (e.g. `jsdom`, `@testing-library/react`) are in scope when a task's own tests need them.
- If `!('SpeechRecognition' in window) && !('webkitSpeechRecognition' in window)`, every voice affordance (mic buttons, the measurement wizard's trigger) must not render at all — never a disabled button or an error state for this case.
- A voice result **never overwrites a field with a value the user didn't confirm seeing**: text fields show the recognized text in the input immediately (so a wrong result is as obvious and as easy to fix as a typo); the measurement wizard's per-field confirm window (Task 6) is this same rule applied to a flow the user isn't watching every field of.
- No decimal word parsing in `parseArabicNumber` (e.g. "أربعين ونص") — explicit spec exclusion. Manual edit after the fact remains available for precision.

## Review Focus

- **Browser without Web Speech API (e.g. Firefox):** every voice affordance must be absent, not disabled — `VoiceMicButton` renders `null`; `ThobeMeasurementSelector`'s wizard trigger button is also absent. (Task 3, Task 6)
- **Microphone permission denied:** `useSpeechRecognition`'s `error` must become `'not-allowed'` and `isListening` must return to `false` — never stuck "listening" forever. (Task 1)
- **Arabic compound numbers, not just round tens:** `parseArabicNumber` must resolve "واحد وعشرون" (21), "مئة" alone (100), "مئة وخمسة" (105), not just "أربعون" (40). (Task 2)
- **Silence / no speech detected mid-wizard:** `useSpeechRecognition`'s `error` becomes `'no-speech'` — the wizard step must offer retry on that same field, never advance with a missing or stale value. (Task 1, Task 6)
- **Double-tap while already listening:** calling `start()` while `isListening === true` must not create a second concurrent `SpeechRecognition` instance (duplicate `onresult` firings, leaked listeners). (Task 1)

---

### Task 1: `useSpeechRecognition` hook

**Files:**
- Create: `src/hooks/useSpeechRecognition.ts`
- Test: `src/hooks/useSpeechRecognition.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type SpeechRecognitionErrorCode = 'no-speech' | 'not-allowed' | 'network' | 'other';
  interface UseSpeechRecognitionResult {
    isSupported: boolean;
    isListening: boolean;
    transcript: string | null;
    error: SpeechRecognitionErrorCode | null;
    start: () => void;
    stop: () => void;
  }
  function useSpeechRecognition(lang?: string): UseSpeechRecognitionResult
  ```
  `lang` defaults to `'ar-SA'` (Global Constraints). Every other task that needs speech recognition consumes exactly this hook with no arguments.

- [ ] **Step 1: Write the failing tests**

```ts
// src/hooks/useSpeechRecognition.test.ts
import { renderHook, act } from '@testing-library/react';
import { useSpeechRecognition } from './useSpeechRecognition';

class MockSpeechRecognition {
  lang = '';
  continuous = false;
  interimResults = false;
  onresult: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  abort = vi.fn();
}

let instances: MockSpeechRecognition[];
beforeEach(() => {
  instances = [];
  (window as any).SpeechRecognition = vi.fn(() => {
    const inst = new MockSpeechRecognition();
    instances.push(inst);
    return inst;
  });
});
afterEach(() => { delete (window as any).SpeechRecognition; });

test('isSupported is false when neither SpeechRecognition nor webkitSpeechRecognition exist', () => {
  delete (window as any).SpeechRecognition;
  const { result } = renderHook(() => useSpeechRecognition());
  expect(result.current.isSupported).toBe(false);
});

test('start() sets isListening, onresult sets transcript and clears isListening', () => {
  const { result } = renderHook(() => useSpeechRecognition());
  act(() => result.current.start());
  expect(result.current.isListening).toBe(true);
  expect(instances).toHaveLength(1);
  expect(instances[0].lang).toBe('ar-SA');
  act(() => instances[0].onresult!({ results: [[{ transcript: 'أربعين' }]] }));
  expect(result.current.transcript).toBe('أربعين');
  expect(result.current.isListening).toBe(false);
});

test('onerror with not-allowed sets error and clears isListening', () => {
  const { result } = renderHook(() => useSpeechRecognition());
  act(() => result.current.start());
  act(() => instances[0].onerror!({ error: 'not-allowed' }));
  expect(result.current.error).toBe('not-allowed');
  expect(result.current.isListening).toBe(false);
});

test('onerror with no-speech maps to the no-speech error code', () => {
  const { result } = renderHook(() => useSpeechRecognition());
  act(() => result.current.start());
  act(() => instances[0].onerror!({ error: 'no-speech' }));
  expect(result.current.error).toBe('no-speech');
});

test('calling start() while already listening does not create a second instance', () => {
  const { result } = renderHook(() => useSpeechRecognition());
  act(() => result.current.start());
  act(() => result.current.start());
  expect(instances).toHaveLength(1);
});

test('stop() aborts the active recognition and clears isListening', () => {
  const { result } = renderHook(() => useSpeechRecognition());
  act(() => result.current.start());
  act(() => result.current.stop());
  expect(instances[0].abort).toHaveBeenCalled();
  expect(result.current.isListening).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- useSpeechRecognition`
Expected: FAIL with "useSpeechRecognition is not defined" (or module not found)

- [ ] **Step 3: Implement `useSpeechRecognition` in `src/hooks/useSpeechRecognition.ts`**

Resolve the constructor once via `(window as any).SpeechRecognition || (window as any).webkitSpeechRecognition`; `isSupported` is `!!` that. `start()` is a no-op when `isListening` is already `true` (Review Focus: double-tap). Each `start()` creates a fresh instance (`continuous = false`, `interimResults = false`, `lang`), wires `onresult` (read `event.results[0][0].transcript`, set `transcript`, set `isListening = false`), `onerror` (map the native `event.error` string: `'not-allowed'` → `'not-allowed'`, `'no-speech'` → `'no-speech'`, `'network'` → `'network'`, anything else → `'other'`; set `isListening = false`), `onend` (set `isListening = false` if still true — covers the case where recognition ends with no result and no error). `stop()` calls `abort()` on the current instance if one exists and sets `isListening = false`. Clean up (`abort()`) on unmount via a `useEffect` cleanup.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- useSpeechRecognition`
Expected: PASS, all 6 tests

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useSpeechRecognition.ts src/hooks/useSpeechRecognition.test.ts
git commit -m "feat: add useSpeechRecognition hook for Arabic voice input"
```

---

### Task 2: `parseArabicNumber`

**Files:**
- Create: `src/utils/parseArabicNumber.ts`
- Test: `src/utils/parseArabicNumber.test.ts`

**Interfaces:**
- Produces: `function parseArabicNumber(text: string): number | null`
- Consumed by: Task 6 (measurement wizard), nothing else in this plan.

- [ ] **Step 1: Write the failing tests**

```ts
// src/utils/parseArabicNumber.test.ts
import { parseArabicNumber } from './parseArabicNumber';

test.each([
  ['40', 40],                          // browser already gave digits
  ['٤٠', 40],                          // Arabic-Indic digits
  ['أربعون', 40],
  ['أربعين', 40],                      // spoken accusative form, same value
  ['خمسة وأربعين', 45],
  ['واحد وعشرون', 21],
  ['مئة', 100],
  ['مئة وخمسة', 105],
  ['مئتان', 200],
  ['ثلاثمئة', 300],
  ['صفر', 0],
])('parses %s as %d', (input, expected) => {
  expect(parseArabicNumber(input)).toBe(expected);
});

test.each(['', 'كلام غير مفهوم', 'xyz'])('returns null for unparseable input %s', (input) => {
  expect(parseArabicNumber(input)).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- parseArabicNumber`
Expected: FAIL with "parseArabicNumber is not defined"

- [ ] **Step 3: Implement `parseArabicNumber` in `src/utils/parseArabicNumber.ts`**

Order of attempts, first match wins:
1. Normalize Arabic-Indic digits (٠-٩) to ASCII, trim, then `parseFloat`; if finite, return it.
2. Word lookup against this table (covers 0–300, the realistic measurement range per the spec):
   ```
   ones: صفر=0 واحد=1 اثنان=2 ثلاثة=3 أربعة=4 خمسة=5 ستة=6 سبعة=7 ثمانية=8 تسعة=9
   teens-as-tens-forms also accepted where spoken: احدى (1, in "احدى وعشرون"), اثنا/اثني (2, in "اثنا عشر")
   tens: عشرون/عشرين=20 ثلاثون/ثلاثين=30 أربعون/أربعين=40 خمسون/خمسين=50
         ستون/ستين=60 سبعون/سبعين=70 ثمانون/ثمانين=80 تسعون/تسعين=90
   teens (10-19 as single words): عشرة=10 أحد عشر=11 اثنا عشر=12 ثلاثة عشر=13
         أربعة عشر=14 خمسة عشر=15 ستة عشر=16 سبعة عشر=17 ثمانية عشر=18 تسعة عشر=19
   hundreds: مئة/مائة=100 مئتان/مئتين=200 ثلاثمئة=300
   ```
   Parsing algorithm: split the normalized text on whitespace and `و`; if the first token matches `hundreds`, consume it as a base and continue with the remainder (default remainder 0 if nothing follows); if remaining tokens match a `tens` entry plus a trailing `ones` entry (the "و" join, e.g. "خمسة وأربعين" → ones token appears *before* "و" and tens *after* — check both orders), sum them; a single remaining token checked against `teens`, `tens`, or `ones` in that order. Any token that matches nothing at any stage → return `null` for the whole input (Global Constraints: never guess a wrong number).
3. No match at any stage → `null`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- parseArabicNumber`
Expected: PASS, all cases

- [ ] **Step 5: Commit**

```bash
git add src/utils/parseArabicNumber.ts src/utils/parseArabicNumber.test.ts
git commit -m "feat: add Arabic spoken-number parser"
```

---

### Task 3: `VoiceMicButton`

**Files:**
- Create: `src/components/ui/VoiceMicButton.tsx`
- Test: `src/components/ui/VoiceMicButton.test.tsx`

**Interfaces:**
- Consumes: `useSpeechRecognition` (Task 1), exact shape as produced above.
- Produces:
  ```ts
  interface VoiceMicButtonProps {
    onResult: (transcript: string) => void;
    ariaLabel?: string; // defaults to a sensible Arabic label if omitted
  }
  function VoiceMicButton(props: VoiceMicButtonProps): JSX.Element | null
  ```
  This is the only thing Tasks 7 and 8 import.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/ui/VoiceMicButton.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { VoiceMicButton } from './VoiceMicButton';

afterEach(() => { delete (window as any).SpeechRecognition; delete (window as any).webkitSpeechRecognition; });

test('renders nothing when the browser has no SpeechRecognition', () => {
  const { container } = render(<VoiceMicButton onResult={() => {}} />);
  expect(container).toBeEmptyDOMElement();
});

test('clicking the button starts listening, and a result calls onResult once', () => {
  class MockSR { lang=''; continuous=false; interimResults=false; onresult:any; onerror:any; onend:any; start(){} abort(){} }
  (window as any).SpeechRecognition = vi.fn(() => new MockSR());
  const onResult = vi.fn();
  render(<VoiceMicButton onResult={onResult} />);
  const button = screen.getByRole('button');
  fireEvent.click(button);
  expect(onResult).not.toHaveBeenCalled(); // no transcript yet, just started listening
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- VoiceMicButton`
Expected: FAIL with "VoiceMicButton is not defined"

- [ ] **Step 3: Implement `VoiceMicButton` in `src/components/ui/VoiceMicButton.tsx`**

```tsx
export function VoiceMicButton({ onResult, ariaLabel }: VoiceMicButtonProps) {
  const { isSupported, isListening, transcript, start } = useSpeechRecognition();
  useEffect(() => { if (transcript) onResult(transcript); }, [transcript]);
  if (!isSupported) return null;
  return (
    <button type="button" onClick={start} aria-label={ariaLabel ?? 'إدخال صوتي'}
      className={cn('cursor-pointer transition-colors', isListening && 'text-brand animate-pulse')}>
      <Mic size={18} />
    </button>
  );
}
```
Use the `Mic` icon already available from `lucide-react` (already a project dependency). The pulsing/brand-colored state while `isListening` is the only visual feedback that recognition is active — no separate "listening..." text needed at this size.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- VoiceMicButton`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/VoiceMicButton.tsx src/components/ui/VoiceMicButton.test.tsx
git commit -m "feat: add VoiceMicButton, the shared voice-input trigger"
```

---

### Task 4: `measurementWizardSteps` sequencing logic

**Files:**
- Create: `src/utils/measurementWizardSteps.ts`
- Test: `src/utils/measurementWizardSteps.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type ThobePart = 'neck' | 'chest' | 'waist' | 'hips' | 'shoulder' | 'sleeve' | 'length' | 'bottomWidth';
  const MEASUREMENT_WIZARD_ORDER: ThobePart[]; // exact order below
  function getNextMeasurementStep(currentIndex: number): ThobePart | null;
  ```
  `ThobePart` must be the exact same string union already defined in `src/components/ThobeMeasurementSelector.tsx:15` — do not redefine it differently; re-export or duplicate verbatim. `MEASUREMENT_WIZARD_ORDER` uses the same order as that file's existing `ThobePart` union: `['neck', 'chest', 'waist', 'hips', 'shoulder', 'sleeve', 'length', 'bottomWidth']`.
- Consumed by: Task 6.

- [ ] **Step 1: Write the failing tests**

```ts
// src/utils/measurementWizardSteps.test.ts
import { getNextMeasurementStep, MEASUREMENT_WIZARD_ORDER } from './measurementWizardSteps';

test('starts at the first field', () => {
  expect(getNextMeasurementStep(-1)).toBe('neck');
});

test('advances through all 8 fields in order', () => {
  expect(MEASUREMENT_WIZARD_ORDER).toEqual(['neck', 'chest', 'waist', 'hips', 'shoulder', 'sleeve', 'length', 'bottomWidth']);
  expect(getNextMeasurementStep(0)).toBe('chest');
  expect(getNextMeasurementStep(6)).toBe('bottomWidth');
});

test('returns null after the last field', () => {
  expect(getNextMeasurementStep(7)).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- measurementWizardSteps`
Expected: FAIL with "getNextMeasurementStep is not defined"

- [ ] **Step 3: Implement in `src/utils/measurementWizardSteps.ts`**

`MEASUREMENT_WIZARD_ORDER` is the literal 8-element array above. `getNextMeasurementStep(currentIndex)` returns `MEASUREMENT_WIZARD_ORDER[currentIndex + 1] ?? null`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- measurementWizardSteps`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/measurementWizardSteps.ts src/utils/measurementWizardSteps.test.ts
git commit -m "feat: add measurement voice-wizard field sequencing"
```

---

### Task 5: `VoiceMeasurementWizard` + wiring into `ThobeMeasurementSelector`

**Files:**
- Create: `src/components/VoiceMeasurementWizard.tsx`
- Modify: `src/components/ThobeMeasurementSelector.tsx:445` (insert trigger button; see exact anchor below)
- Test: manual only (see Task rationale below) — no new automated test file for this task.

**Interfaces:**
- Consumes:
  - `useSpeechRecognition` (Task 1), `parseArabicNumber` (Task 2), `getNextMeasurementStep`/`MEASUREMENT_WIZARD_ORDER` (Task 4).
  - `ThobeMeasurementSelector`'s existing `PART_LABELS: Record<ThobePart, string>` (file-local, line 17) and `onChange: (values: Measurements) => void` prop (line 11) — the wizard must fill fields through this exact same prop, not a parallel path.
- Produces:
  ```ts
  interface VoiceMeasurementWizardProps {
    values: Measurements;
    onChange: (values: Measurements) => void;
    onClose: () => void;
  }
  function VoiceMeasurementWizard(props: VoiceMeasurementWizardProps): JSX.Element
  ```

This task has no new pure logic beyond what Tasks 1/2/4 already cover and test — it is the wiring of three already-tested primitives into a sequence driven by `speechSynthesis` (which, like `SpeechRecognition`, does not exist in the `jsdom` test environment, so the component itself cannot be meaningfully unit-tested here; see the plan's Spec section on testing). Manual QA on `staging` is the verification for this task specifically, same as the plan's spec says for voice generally.

- [ ] **Step 1: Implement `VoiceMeasurementWizard` in `src/components/VoiceMeasurementWizard.tsx`**

State: `stepIndex` (starts at `-1`), `lastResult: { part: ThobePart; value: number } | null`, `awaitingRetry: boolean`.

On mount and whenever `stepIndex` advances: resolve `part = getNextMeasurementStep(stepIndex)`; if `null`, call `onClose()` (all 8 done). Otherwise: build the Arabic-only prompt text as `'قل مقاس ' + arabicT(PART_LABELS[part])`, where `arabicT` is `i18n.getFixedT('ar')` (Global Constraints: TTS/recognition stay Arabic regardless of the merchant's own UI language) imported from `i18next`. Speak it:
```ts
const utterance = new SpeechSynthesisUtterance(promptText);
utterance.lang = 'ar-SA';
utterance.onend = () => recognition.start();
utterance.onerror = () => recognition.start(); // graceful degradation per spec: skip straight to listening
if ('speechSynthesis' in window) window.speechSynthesis.speak(utterance);
else recognition.start();
```
On `transcript` change: `const value = parseArabicNumber(transcript)`. If `null` → set a "لم أفهم، حاول مرة أخرى" message for the current `part` with a retry button that calls `recognition.start()` again for the same `part` (do not advance `stepIndex`). If a number → call `onChange({ ...values, [part]: value })`, show `✓ {label}: {value}` for 1.5s (`setTimeout`), then advance `stepIndex` by 1 — unless the user taps the shown value within that window, which opens the existing manual number input for that field instead of advancing (Global Constraints: a voice result is always visibly confirmable/correctable). On `error === 'no-speech'`: same retry-this-field path as an unparseable transcript. A "إلغاء" button at any time calls `window.speechSynthesis.cancel()`, the hook's `stop()`, and `onClose()`.

- [ ] **Step 2: Add the trigger button in `ThobeMeasurementSelector.tsx`**

Add local state `const [wizardOpen, setWizardOpen] = useState(false);` near the existing state (line 41-43). Immediately before the `.map()` that renders the 8 field cards (the block closing at line 445), insert, only when `!readOnly`:
```tsx
{useSpeechRecognition().isSupported && (
  <button type="button" onClick={() => setWizardOpen(true)} className="/* match existing button styling in this file */">
    <Mic size={16} /> {t('measurements.voice_fill_button', 'تعبئة المقاسات بالصوت')}
  </button>
)}
{wizardOpen && (
  <VoiceMeasurementWizard values={values} onChange={onChange} onClose={() => setWizardOpen(false)} />
)}
```
Calling `useSpeechRecognition()` here only to read `isSupported` starts no recognition session by itself (Task 1's hook never calls `start()` on its own) — this is the same cheap support-check every other consumer uses to decide whether to render a voice affordance at all (Global Constraints).

- [ ] **Step 3: Manual verification**

Run the app locally (or on `staging` after deploy), open a customer/order's measurement entry, confirm: the "تعبئة المقاسات بالصوت" button is present in Chrome and absent in Firefox; starting the wizard speaks the first prompt, fills the neck field on a recognized number, and after all 8 the wizard closes with every field populated and still manually editable.

- [ ] **Step 4: Commit**

```bash
git add src/components/VoiceMeasurementWizard.tsx src/components/ThobeMeasurementSelector.tsx
git commit -m "feat: add voice measurement wizard to ThobeMeasurementSelector"
```

---

### Task 6: Voice search in POS, Orders, Customers, Inventory

**Files:**
- Modify: `src/components/POS.tsx:1739-1748` (search `IconInput`'s `endIcon`)
- Modify: `src/components/Orders.tsx:2415-2424` (search `IconInput`'s `endIcon`)
- Modify: `src/components/Customers.tsx:761-772` (search `IconInput`'s `endIcon`)
- Modify: `src/components/Inventory/InventoryManager.tsx:661-668` (search `IconInput`, currently no `endIcon`)
- Test: manual only — these are mechanical wirings of `VoiceMicButton` (already tested in Task 3) into existing, already-tested filter state; no new pure logic is introduced. The project's existing test suite has no React-component-render tests for any of these four files today (its convention is pure-function unit tests only — see `src/utils/*.test.ts`), so this task does not introduce the first one.

**Interfaces:**
- Consumes: `VoiceMicButton` (Task 3), exact props as produced there.

- [ ] **Step 1: POS.tsx — add the mic alongside the existing barcode-scanner `endIcon`**

`POS.tsx:1739-1748`'s `endIcon` is currently a single `<button>` that opens the barcode scanner. Wrap both buttons in a flex row:
```tsx
endIcon={
  <div className="flex items-center gap-2">
    <VoiceMicButton onResult={setSearchQuery} />
    <button type="button" onClick={() => setIsScannerOpen(true)} aria-label={t('pos.scan_barcode')}
      className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded cursor-pointer">
      <Barcode size={18} />
    </button>
  </div>
}
```
Import `VoiceMicButton` from `./ui/VoiceMicButton`.

- [ ] **Step 2: Orders.tsx — same wrap around its barcode-scanner `endIcon`**

Same change as Step 1, at `Orders.tsx:2415-2424`, with `onResult={setSearch}` (Orders' search state setter).

- [ ] **Step 3: Customers.tsx — add the mic alongside the conditional clear button**

`Customers.tsx:764-772`'s `endIcon` is currently `search ? <clear button> : undefined`. Change to always include the mic, with the clear button only when `search` is non-empty:
```tsx
endIcon={
  <div className="flex items-center gap-2">
    <VoiceMicButton onResult={setSearch} />
    {search && (
      <button type="button" onClick={() => setSearch('')} className="text-content-muted hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded cursor-pointer">
        <X size={16} />
      </button>
    )}
  </div>
}
```

- [ ] **Step 4: InventoryManager.tsx — add the mic as the search field's first `endIcon`**

`InventoryManager.tsx:661-668` has no existing `endIcon`. Add `endIcon={<VoiceMicButton onResult={setSearchTerm} />}`.

- [ ] **Step 5: Manual verification**

On each of the 4 screens (Chrome): confirm the mic icon appears next to the search box (alongside the barcode icon where one already exists), tapping it and speaking a product/customer/order name fills the search box and the existing filter narrows the list exactly as typing would.

- [ ] **Step 6: Commit**

```bash
git add src/components/POS.tsx src/components/Orders.tsx src/components/Customers.tsx src/components/Inventory/InventoryManager.tsx
git commit -m "feat: add voice search to POS, Orders, Customers, Inventory"
```

---

### Task 7: Voice entry for the 5 chosen data-entry fields

**Files:**
- Modify: `src/components/Customers.tsx:1696-1701` (customer name, `react-hook-form`)
- Modify: `src/components/Customers.tsx:1784` (customer notes `<textarea>`, `react-hook-form`)
- Modify: `src/components/Orders.tsx:3307-3312` (order notes `<textarea>`, `react-hook-form`)
- Modify: `src/components/AddEmployeeModal.tsx:237-242` (employee name, `react-hook-form`)
- Modify: `src/components/Inventory/ProductFormFields.tsx:96-109` (product name, plain `formData`/`setFormData` — not `react-hook-form`, not `IconInput`)
- Test: manual only — same rationale as Task 6 (mechanical wiring of an already-tested primitive, no new pure logic, matches the project's existing no-component-render-tests convention).

**Interfaces:**
- Consumes: `VoiceMicButton` (Task 3).

- [ ] **Step 1: Customers.tsx name field — add `setValue` to this form's existing `useForm()` destructure if not already present, then wire the mic**

Check the `const { ... } = useForm(...)` destructure above this field (it already uses `setValue` for the phone/trn fields at lines ~1710/~1742, per the existing code — reuse that same `setValue`, do not add a second one). Add `endIcon={<VoiceMicButton onResult={(text) => setValue('name', text)} />}` to the `IconInput` at line 1696.

- [ ] **Step 2: Customers.tsx notes field — wrap the textarea with the mic**

Line 1784's `<textarea id="customer-notes" {...register('notes')} .../>` is not an `IconInput`, so there's no `endIcon` slot. Wrap it: `<div className="relative"><textarea .../><div className="absolute top-2 end-2"><VoiceMicButton onResult={(text) => setValue('notes', text)} /></div></div>`.

- [ ] **Step 3: Orders.tsx notes field — same textarea wrap**

Same pattern as Step 2, at `Orders.tsx:3311`'s `<textarea {...register('notes')} .../>`, using that form's own `setValue('notes', text)`.

- [ ] **Step 4: AddEmployeeModal.tsx name field — add `setValue`, wire the mic**

This file's `useForm()` destructure (line 58) does not currently include `setValue` — add it: `const { register, handleSubmit, control, formState: { errors }, reset, setValue } = useForm({...})`. Add `endIcon={<VoiceMicButton onResult={(text) => setValue('name', text)} />}` to the `IconInput` at line 237.

- [ ] **Step 5: ProductFormFields.tsx name field — wrap the plain input with the mic**

Line 96-109's `<input value={formData.name} onChange={...} .../>` is a plain input, not `IconInput`. Wrap in a `relative` positioned div with the mic absolutely placed inside it (same pattern as Step 2), with `onResult={(text) => setFormData({ ...formData, name: text })}` (reusing this component's existing `formData`/`setFormData` props — do not introduce new state).

- [ ] **Step 6: Manual verification**

On each of the 5 fields (Chrome): tap the mic, speak a short phrase, confirm the field's displayed value updates exactly as typing would, and that the field remains freely editable afterward.

- [ ] **Step 7: Commit**

```bash
git add src/components/Customers.tsx src/components/Orders.tsx src/components/AddEmployeeModal.tsx src/components/Inventory/ProductFormFields.tsx
git commit -m "feat: add voice entry to customer, product, employee, and order fields"
```

---

## Testing Note (applies across all tasks)

Web Speech API (`SpeechRecognition`, `speechSynthesis`) does not exist in this project's test environment (`vitest` + `jsdom`). Tasks 1-4 are fully covered by real TDD because their logic (the hook's state machine against a mocked constructor, the number parser, the button's render-or-not decision, the field sequencing) is pure or trivially mockable. Tasks 5-7 wire those already-tested primitives into existing screens with no new logic of their own, matching this project's existing convention of unit-testing pure functions rather than rendering full screens (`src/utils/*.test.ts`, `src/lib/offline/*.test.ts` — no React Testing Library component tests exist anywhere in the current suite) — manual verification on `staging` is each task's actual gate, consistent with how this plan's spec scoped testing from the start.
