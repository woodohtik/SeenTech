# Plans Catalog Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a super admin create, edit, activate/deactivate, and safely delete rows in the existing `plans` table from a new "الباقات" tab in `SuperAdminDashboard.tsx`.

**Architecture:** Pure client-side CRUD against `plans` via `supabase-js`, relying entirely on the RLS policies that already exist (`plans_public_read`, `plans_super_admin_write`). No new migration, no new backend route. A new sibling component `PlanFormModal` (same file, following this codebase's established pattern of defining modal sub-components after the default export) handles create/edit; the list view and delete-guard live inline in the existing `plans`/`financials` data already fetched by `fetchData()`.

**Tech Stack:** React + TypeScript, Supabase JS client, existing `useToast`/`useConfirm` hooks, Tailwind utility classes matching this file's existing tab styling.

**Spec:** `docs/superpowers/specs/2026-10-20-plans-management-design.md`

## Global Constraints

- No new Supabase migration — `plans` table and its RLS (`plans_public_read`, `plans_super_admin_write`) already exist exactly as needed.
- Plan `id` format (new constraint introduced by this plan, not in the DB): `/^[a-z][a-z0-9_]{1,39}$/` — lowercase letters/digits/underscore, 2–40 chars, must start with a letter. Matches the existing seeded ids (`free`, `basic`).
- `price`, `max_staff`, `max_orders` must each be a non-negative number client-side before submit (DB has `CHECK (... >= 0)`; `max_staff`/`max_orders` must additionally be integers — the DB columns are `INTEGER`).
- `id` is immutable after creation (it's a PK referenced by `tenants.plan_id`) — the edit form must render it read-only.
- Deleting a plan must be blocked outright (not just confirmed) when `tenants.filter(t => t.planId === plan.id).length > 0` — `tenants` is already loaded in full (no pagination) by `fetchData()`, so no extra query is needed for this count.
- All new user-facing strings get real keys in `ar.json`, `en.json`, and `ur.json` (this project's established convention — no English-only or Arabic-only strings).
- Every Supabase call failure goes through `toastHandleError`/`toastError` (already destructured from `useToast()` in this file) — never a silent `console.error`.

## Review Focus

- A plan currently assigned to one or more tenants must be impossible to delete — the delete action must stop before calling `.delete()`, not merely warn after.
- Creating a plan with an `id` that already exists must surface a clear "duplicate ID" message, not a raw Postgres unique-violation error or a silent no-op.
- Negative or non-integer input in `price`/`max_staff`/`max_orders` must be rejected by client-side validation before any network call, with a field-level error message.
- Saving a plan with zero features (empty list) must succeed — an empty array is the schema's own default, not an invalid state.
- Toggling `is_active` must only flip that one column for that one plan — it must not alter, hide, or unassign any tenant currently on that plan.

---

### Task 1: Plan form validation (pure function, TDD)

**Files:**
- Create: `src/utils/planValidation.ts`
- Test: `src/utils/planValidation.test.ts`

**Interfaces:**
- Produces: `validatePlanForm(input: PlanFormInput, isEditing: boolean): PlanFormValidation` — consumed by Task 3's `PlanFormModal`.
  ```ts
  export interface PlanFormInput {
    id: string;
    name: string;
    price: string;        // raw form field, parsed inside
    maxStaff: string;
    maxOrders: string;
  }
  export type PlanFormField = 'id' | 'name' | 'price' | 'maxStaff' | 'maxOrders';
  export interface PlanFormValidation {
    valid: boolean;
    errors: Partial<Record<PlanFormField, string>>;
  }
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// src/utils/planValidation.test.ts
import { describe, it, expect } from 'vitest';
import { validatePlanForm } from './planValidation';

describe('validatePlanForm', () => {
  it('accepts a fully valid new-plan input', () => {
    const result = validatePlanForm({ id: 'pro', name: 'Pro', price: '249', maxStaff: '10', maxOrders: '5000' }, false);
    expect(result).toEqual({ valid: true, errors: {} });
  });

  it('requires a non-empty id when creating', () => {
    const result = validatePlanForm({ id: '', name: 'Pro', price: '249', maxStaff: '10', maxOrders: '5000' }, false);
    expect(result.valid).toBe(false);
    expect(result.errors.id).toBeTruthy();
  });

  it('rejects an id that does not match the slug pattern', () => {
    const result = validatePlanForm({ id: 'Pro Plan!', name: 'Pro', price: '249', maxStaff: '10', maxOrders: '5000' }, false);
    expect(result.valid).toBe(false);
    expect(result.errors.id).toBeTruthy();
  });

  it('does not require id when editing (field is locked, not re-validated)', () => {
    const result = validatePlanForm({ id: '', name: 'Pro', price: '249', maxStaff: '10', maxOrders: '5000' }, true);
    expect(result.errors.id).toBeUndefined();
  });

  it('requires a non-empty name', () => {
    const result = validatePlanForm({ id: 'pro', name: '', price: '249', maxStaff: '10', maxOrders: '5000' }, false);
    expect(result.valid).toBe(false);
    expect(result.errors.name).toBeTruthy();
  });

  it('rejects a negative price', () => {
    const result = validatePlanForm({ id: 'pro', name: 'Pro', price: '-1', maxStaff: '10', maxOrders: '5000' }, false);
    expect(result.valid).toBe(false);
    expect(result.errors.price).toBeTruthy();
  });

  it('rejects a non-numeric price', () => {
    const result = validatePlanForm({ id: 'pro', name: 'Pro', price: 'abc', maxStaff: '10', maxOrders: '5000' }, false);
    expect(result.valid).toBe(false);
    expect(result.errors.price).toBeTruthy();
  });

  it('accepts price of exactly 0 (free plan)', () => {
    const result = validatePlanForm({ id: 'free', name: 'Free', price: '0', maxStaff: '1', maxOrders: '100' }, false);
    expect(result.valid).toBe(true);
  });

  it('rejects a negative maxStaff', () => {
    const result = validatePlanForm({ id: 'pro', name: 'Pro', price: '0', maxStaff: '-1', maxOrders: '5000' }, false);
    expect(result.valid).toBe(false);
    expect(result.errors.maxStaff).toBeTruthy();
  });

  it('rejects a non-integer maxStaff', () => {
    const result = validatePlanForm({ id: 'pro', name: 'Pro', price: '0', maxStaff: '2.5', maxOrders: '5000' }, false);
    expect(result.valid).toBe(false);
    expect(result.errors.maxStaff).toBeTruthy();
  });

  it('rejects a negative maxOrders', () => {
    const result = validatePlanForm({ id: 'pro', name: 'Pro', price: '0', maxStaff: '1', maxOrders: '-5' }, false);
    expect(result.valid).toBe(false);
    expect(result.errors.maxOrders).toBeTruthy();
  });

  it('accepts maxStaff of exactly 0', () => {
    const result = validatePlanForm({ id: 'pro', name: 'Pro', price: '0', maxStaff: '0', maxOrders: '0' }, false);
    expect(result.valid).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/utils/planValidation.test.ts`
Expected: FAIL — `planValidation.ts` does not exist yet.

- [ ] **Step 3: Implement `validatePlanForm` in `src/utils/planValidation.ts`**

Export the `PlanFormInput`, `PlanFormField`, `PlanFormValidation` types shown above, plus `export const PLAN_ID_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;`. Implement `validatePlanForm`:
- When `isEditing` is `false`: `id` must be non-empty and match `PLAN_ID_PATTERN`, else set `errors.id`. When `isEditing` is `true`, skip `id` validation entirely (field is locked in the UI).
- `name`: trimmed, must be non-empty, else `errors.name`.
- `price`: `Number(input.price)` must be finite and `>= 0`, else `errors.price`.
- `maxStaff`, `maxOrders`: each must parse as a finite integer `>= 0` (reject decimals, e.g. via `Number.isInteger`), else the matching error key.
- `valid` is `true` iff `errors` has no keys.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/utils/planValidation.test.ts`
Expected: PASS, all 12 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/utils/planValidation.ts src/utils/planValidation.test.ts
git commit -m "feat(plans): add pure form validation for the plans-catalog admin screen"
```

---

### Task 2: Plans tab — list view, refresh, and active/inactive toggle

**Files:**
- Modify: `src/components/SuperAdminDashboard.tsx:60` (`TabType` union), `:790-805` (tabs array + nothing else in that block), new tab content block added next to the existing `{activeTab === 'security' && (...)}` block.
- Modify: `src/i18n/locales/ar.json`, `en.json`, `ur.json` — add the `saas.*` keys this task introduces (see Step 3).

**Interfaces:**
- Consumes: existing `plansList: any[]`, `setPlansList`, `fetchData(): Promise<void>`, `tenants: Tenant[]` (each with `.planId`), `toastSuccess`, `toastError`, `toastHandleError` (from `useToast()`), `cn` from `'../lib/utils'`, `PriceDisplay` from `'./PriceDisplay'`.
- Produces: two new pieces of state this task owns and later tasks consume —
  `const [planModalMode, setPlanModalMode] = useState<'create' | 'edit' | null>(null);`
  `const [editingPlan, setEditingPlan] = useState<any | null>(null);`
  Task 3 opens the create modal via `setPlanModalMode('create')` and the edit modal via `setEditingPlan(plan); setPlanModalMode('edit')`. Task 4 reads `plansList`/`tenants` the same way this task does for its own delete-guard count.

- [ ] **Step 1: Add `'plans'` to `TabType`**

In `src/components/SuperAdminDashboard.tsx:60`, change:
```ts
type TabType = 'overview' | 'tenants' | 'financials' | 'performance' | 'security' | 'plans';
```

- [ ] **Step 2: Add the tab button**

In the tabs array (the `[{ id: 'overview', ... }, ...]` literal rendered just above `<AnimatePresence mode="wait">`), add one entry, placed after `'security'`:
```ts
{ id: 'plans', label: t('saas.menu_plans', 'الباقات'), icon: CreditCard },
```
(`CreditCard` is already imported in this file's icon import block and unused elsewhere — no new import needed.)

- [ ] **Step 3: Add the new locale keys**

Add to the `"saas"` section of `src/i18n/locales/ar.json`, `en.json`, `ur.json` (alphabetically among existing `saas.*` keys — check each file for the nearest neighbors before inserting):
- `menu_plans`: ar `"الباقات"`, en `"Plans"`, ur `"پیکیجز"`
- `plans_tab_title`: ar `"إدارة الباقات"`, en `"Manage Plans"`, ur `"پیکیجز کا انتظام"`
- `plans_tab_subtitle`: ar `"إنشاء وتعديل باقات الاشتراك المتاحة للتجّار"`, en `"Create and edit the subscription plans available to merchants"`, ur `"تاجروں کے لیے دستیاب سبسکرپشن پیکیجز بنائیں اور ترمیم کریں"`
- `plans_new_button`: ar `"+ باقة جديدة"`, en `"+ New Plan"`, ur `"+ نیا پیکیج"`
- `plans_col_name`: ar `"الاسم"`, en `"Name"`, ur `"نام"`
- `plans_col_price`: ar `"السعر"`, en `"Price"`, ur `"قیمت"`
- `plans_col_max_staff`: ar `"الحد الأقصى للموظفين"`, en `"Max Staff"`, ur `"زیادہ سے زیادہ عملہ"`
- `plans_col_max_orders`: ar `"الحد الأقصى للطلبات"`, en `"Max Orders"`, ur `"زیادہ سے زیادہ آرڈرز"`
- `plans_max_orders_hint`: ar `"غير مُفعَّل آلياً حالياً"`, en `"Not enforced automatically yet"`, ur `"ابھی خودکار طور پر نافذ نہیں"`
- `plans_col_features`: ar `"الميزات"`, en `"Features"`, ur `"خصوصیات"`
- `plans_col_status`: ar `"الحالة"`, en `"Status"`, ur `"حیثیت"`
- `plans_col_actions`: ar `"إجراءات"`, en `"Actions"`, ur `"اقدامات"`
- `plans_status_active`: ar `"نشطة"`, en `"Active"`, ur `"فعال"`
- `plans_status_inactive`: ar `"معطَّلة"`, en `"Inactive"`, ur `"غیر فعال"`
- `plans_toggle_success`: ar `"تم تحديث حالة الباقة"`, en `"Plan status updated"`, ur `"پیکیج کی حیثیت اپ ڈیٹ ہو گئی"`
- `plans_toggle_failed`: ar `"فشل تحديث حالة الباقة"`, en `"Failed to update plan status"`, ur `"پیکیج کی حیثیت اپ ڈیٹ کرنے میں ناکامی"`

- [ ] **Step 4: Validate the three locale JSON files parse**

Run: `node -e "['ar','en','ur'].forEach(l => JSON.parse(require('fs').readFileSync('./src/i18n/locales/'+l+'.json','utf8')))"`
Expected: no output, exit code 0.

- [ ] **Step 5: Add the tab content block**

Immediately after the existing `{activeTab === 'security' && ( ... )}` block (and before the closing `</AnimatePresence>`), add:
```tsx
{activeTab === 'plans' && (
  <motion.div
    key="plans"
    initial={{ opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -10 }}
    className="space-y-6"
  >
    <div className="bg-surface p-6 rounded-[2rem] border border-border shadow-sm flex items-center justify-between">
      <div>
        <h3 className="text-lg font-black text-content">{t('saas.plans_tab_title')}</h3>
        <p className="text-content-muted font-bold text-xs mt-1">{t('saas.plans_tab_subtitle')}</p>
      </div>
      <button
        onClick={() => setPlanModalMode('create')}
        className="bg-brand text-white px-5 py-2.5 rounded-xl font-bold text-sm hover:bg-brand/90 transition-all cursor-pointer"
      >
        {t('saas.plans_new_button')}
      </button>
    </div>

    <div className="bg-surface rounded-[2rem] border border-border shadow-sm overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-surface-muted text-[10px] font-black text-content-muted uppercase tracking-widest border-b border-border">
            <th className="p-4 text-start">{t('saas.plans_col_name')}</th>
            <th className="p-4 text-center">{t('saas.plans_col_price')}</th>
            <th className="p-4 text-center">{t('saas.plans_col_max_staff')}</th>
            <th className="p-4 text-center">{t('saas.plans_col_max_orders')}</th>
            <th className="p-4 text-center">{t('saas.plans_col_features')}</th>
            <th className="p-4 text-center">{t('saas.plans_col_status')}</th>
            <th className="p-4 text-center">{t('saas.plans_col_actions')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {plansList.map((plan) => (
            <tr key={plan.id}>
              <td className="p-4 font-bold text-content">{plan.name}</td>
              <td className="p-4 text-center font-mono"><PriceDisplay amount={plan.price} /></td>
              <td className="p-4 text-center font-mono">{plan.max_staff}</td>
              <td className="p-4 text-center">
                <span className="font-mono">{plan.max_orders}</span>
                <span className="block text-[9px] text-content-muted font-bold mt-0.5">{t('saas.plans_max_orders_hint')}</span>
              </td>
              <td className="p-4 text-center text-content-muted font-bold">{(plan.features || []).length}</td>
              <td className="p-4 text-center">
                <button
                  onClick={() => handleTogglePlanActive(plan)}
                  className={cn(
                    "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wide cursor-pointer",
                    plan.is_active ? "bg-success/10 text-success" : "bg-danger/10 text-danger"
                  )}
                >
                  {plan.is_active ? t('saas.plans_status_active') : t('saas.plans_status_inactive')}
                </button>
              </td>
              <td className="p-4 text-center">
                <div className="flex items-center justify-center gap-2">
                  <button
                    onClick={() => { setEditingPlan(plan); setPlanModalMode('edit'); }}
                    className="p-2 text-content-muted hover:text-content bg-surface-muted hover:bg-border rounded-xl transition-all cursor-pointer"
                  >
                    <Settings size={14} />
                  </button>
                  <button
                    onClick={() => handleDeletePlan(plan)}
                    className="p-2 text-content-muted hover:text-danger bg-surface-muted hover:bg-danger/10 rounded-xl transition-all cursor-pointer"
                  >
                    <X size={14} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </motion.div>
)}
```
- [ ] **Step 6: Add a stub `handleDeletePlan` so the button above compiles**

```ts
const handleDeletePlan = async (plan: any) => {
  // Replaced with the real in-use guard in Task 4.
};
```

- [ ] **Step 7: Implement `handleTogglePlanActive`**

Add alongside the other handlers in the component body:
```ts
const handleTogglePlanActive = async (plan: any) => {
  const { error } = await supabase.from('plans').update({ is_active: !plan.is_active }).eq('id', plan.id);
  if (error) {
    toastHandleError(error, t('saas.plans_toggle_failed'));
    return;
  }
  toastSuccess(t('saas.plans_toggle_success'));
  await fetchData();
};
```

- [ ] **Step 8: Type-check**

Run: `npm run lint`
Expected: no TypeScript errors (a temporary unused-parameter warning on the `handleDeletePlan` stub is acceptable since it's replaced in Task 4, but confirm `tsc --noEmit` still exits 0).

- [ ] **Step 9: Manual verification**

Start the dev server, log in as a super admin, open the new "الباقات" tab: confirm the two seeded plans (`free`, `basic`) render with correct price/limits/feature-count, and clicking a status badge flips it between نشطة/معطَّلة and persists after a page refresh. Open the "tenants" tab and find a tenant currently on the plan you just toggled inactive — confirm that tenant's own plan assignment and access are completely unaffected (toggling `is_active` only changes that one column on the `plans` row).

- [ ] **Step 10: Commit**

```bash
git add src/components/SuperAdminDashboard.tsx src/i18n/locales/ar.json src/i18n/locales/en.json src/i18n/locales/ur.json
git commit -m "feat(plans): add plans-catalog tab with list view and active toggle"
```

---

### Task 3: Create/edit modal (`PlanFormModal`)

**Files:**
- Create (as a sibling component in the same file, matching this session's established pattern for `CustomerImportModal`/`ProductImportModal`/`SupplierImportModal`): append `PlanFormModal` to the end of `src/components/SuperAdminDashboard.tsx`.
- Modify: `src/components/SuperAdminDashboard.tsx` — render `<PlanFormModal>` conditionally from the state Task 2 introduced; add locale keys (Step 5 below).

**Interfaces:**
- Consumes: `validatePlanForm`, `PlanFormInput`, `PLAN_ID_PATTERN` from `../utils/planValidation` (Task 1); `planModalMode`, `setPlanModalMode`, `editingPlan`, `setEditingPlan`, `fetchData`, `toastSuccess`, `toastHandleError` (Task 2 / file-level).
- Produces: nothing further tasks consume — this is the last task besides delete.

- [ ] **Step 1: Add the locale keys**

Add to `"saas"` in all three locale files:
- `plan_modal_title_create`: ar `"باقة جديدة"`, en `"New Plan"`, ur `"نیا پیکیج"`
- `plan_modal_title_edit`: ar `"تعديل الباقة"`, en `"Edit Plan"`, ur `"پیکیج میں ترمیم کریں"`
- `plan_field_id`: ar `"المعرّف (id)"`, en `"ID"`, ur `"شناخت کنندہ (ID)"`
- `plan_field_id_locked_hint`: ar `"لا يمكن تعديل المعرّف بعد الإنشاء"`, en `"The ID cannot be changed after creation"`, ur `"تخلیق کے بعد ID تبدیل نہیں ہو سکتی"`
- `plan_field_name`: ar `"الاسم"`, en `"Name"`, ur `"نام"`
- `plan_field_price`: ar `"السعر (ر.س)"`, en `"Price (SAR)"`, ur `"قیمت (SAR)"`
- `plan_field_max_staff`: ar `"الحد الأقصى للموظفين"`, en `"Max Staff"`, ur `"زیادہ سے زیادہ عملہ"`
- `plan_field_max_staff_hint`: ar `"٠ يعني عدم السماح بأي موظف نشط"`, en `"0 means no active staff allowed"`, ur `"0 کا مطلب ہے کوئی فعال عملہ کی اجازت نہیں"`
- `plan_field_max_orders`: ar `"الحد الأقصى للطلبات"`, en `"Max Orders"`, ur `"زیادہ سے زیادہ آرڈرز"`
- `plan_field_max_orders_hint`: ar `"هذا الحقل غير مُفعَّل آلياً في النظام حالياً — تخزين فقط"`, en `"Not enforced automatically yet — stored only"`, ur `"ابھی خودکار طور پر نافذ نہیں — صرف محفوظ ہوتا ہے"`
- `plan_field_features`: ar `"الميزات"`, en `"Features"`, ur `"خصوصیات"`
- `plan_feature_add`: ar `"+ إضافة ميزة"`, en `"+ Add Feature"`, ur `"+ خصوصیت شامل کریں"`
- `plan_feature_placeholder`: ar `"مثال: دعم فني على مدار الساعة"`, en `"e.g. 24/7 support"`, ur `"مثال: 24/7 سپورٹ"`
- `plan_field_active`: ar `"نشطة"`, en `"Active"`, ur `"فعال"`
- `plan_save`: ar `"حفظ"`, en `"Save"`, ur `"محفوظ کریں"`
- `plan_create_success`: ar `"تم إنشاء الباقة بنجاح"`, en `"Plan created successfully"`, ur `"پیکیج کامیابی سے بن گیا"`
- `plan_update_success`: ar `"تم تحديث الباقة بنجاح"`, en `"Plan updated successfully"`, ur `"پیکیج کامیابی سے اپ ڈیٹ ہو گیا"`
- `plan_save_failed`: ar `"فشل حفظ الباقة"`, en `"Failed to save plan"`, ur `"پیکیج محفوظ کرنے میں ناکامی"`
- `plan_duplicate_id`: ar `"هذا المعرّف مستخدَم بالفعل لباقة أخرى"`, en `"This ID is already used by another plan"`, ur `"یہ ID پہلے سے کسی اور پیکیج کے لیے استعمال ہو رہی ہے"`

- [ ] **Step 2: Validate the three locale JSON files parse**

Run: `node -e "['ar','en','ur'].forEach(l => JSON.parse(require('fs').readFileSync('./src/i18n/locales/'+l+'.json','utf8')))"`
Expected: no output, exit code 0.

- [ ] **Step 3: Implement `PlanFormModal`**

Append after the default export, following the file's existing modal-sibling-component convention:
```tsx
const PlanFormModal = ({
  mode,
  plan,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  plan: any | null;
  onClose: () => void;
  onSaved: () => void;
}) => { /* ... */ };
```
State: `id`, `name`, `price`, `maxStaff`, `maxOrders` as strings (controlled inputs feeding `validatePlanForm`); `features: string[]` (seeded from `plan?.features || []` when editing); `isActive: boolean` (seeded from `plan?.is_active ?? true`); `errors: PlanFormValidation['errors']`; `saving: boolean`.

Features editor: render one text input per `features[i]` with a remove button, plus a `+ Add Feature` button that pushes `''`; filter out empty/whitespace-only entries on submit before saving.

On submit:
1. Call `validatePlanForm({ id, name, price, maxStaff, maxOrders }, mode === 'edit')`. If `!valid`, set `errors` and stop (no network call).
2. Build the payload: `{ name: name.trim(), price: Number(price), max_staff: Number(maxStaff), max_orders: Number(maxOrders), features: features.map(f => f.trim()).filter(Boolean), is_active: isActive }`.
3. If `mode === 'create'`: `supabase.from('plans').insert({ id, ...payload })`. On error with Postgres code `'23505'` (unique violation), set `errors.id` to `t('saas.plan_duplicate_id')` and stop; on any other error, `toastHandleError(error, t('saas.plan_save_failed'))`.
4. If `mode === 'edit'`: `supabase.from('plans').update(payload).eq('id', plan.id)`. On error, `toastHandleError(error, t('saas.plan_save_failed'))`.
5. On success: `toastSuccess(t(mode === 'create' ? 'saas.plan_create_success' : 'saas.plan_update_success'))`, call `onSaved()` (which the parent wires to `fetchData` + closing the modal), and `onClose()`.

Render the `id` field as `readOnly` (with `plan_field_id_locked_hint` shown beneath it) whenever `mode === 'edit'`.

- [ ] **Step 4: Wire the modal into the parent**

In `SuperAdminDashboard.tsx`, inside the `plans` tab block (or as a sibling `<AnimatePresence>` at the same level as other top-level modals in this file), add:
```tsx
{planModalMode && (
  <PlanFormModal
    mode={planModalMode}
    plan={planModalMode === 'edit' ? editingPlan : null}
    onClose={() => { setPlanModalMode(null); setEditingPlan(null); }}
    onSaved={fetchData}
  />
)}
```

- [ ] **Step 5: Type-check**

Run: `npm run lint`
Expected: exits 0.

- [ ] **Step 6: Manual verification**

In the browser: click "+ باقة جديدة", submit with an empty name — confirm a field-level error appears and no network call fires (check the Network tab). Fill in a new unique id/name/price/limits with **zero** features and save — confirm it succeeds with feature count 0 (an empty array is the schema's own default, not an error). Create a second new plan, this time with two features, save — confirm it appears in the list with feature count 2. Try creating a third plan reusing the `free` id — confirm the "duplicate ID" message appears on the `id` field specifically and no plan is created. Edit the two-feature plan you created (confirm the ID input is read-only), change its price, save — confirm the list reflects the new price.

- [ ] **Step 7: Commit**

```bash
git add src/components/SuperAdminDashboard.tsx src/i18n/locales/ar.json src/i18n/locales/en.json src/i18n/locales/ur.json
git commit -m "feat(plans): add create/edit modal for the plans catalog"
```

---

### Task 4: Delete with in-use guard

**Files:**
- Modify: `src/components/SuperAdminDashboard.tsx` — replace the `handleDeletePlan` stub from Task 2 with the real implementation; add locale keys.

**Interfaces:**
- Consumes: `tenants` (Task 2's existing state, each row has `.planId`), `confirm` (from `useConfirm()`, already destructured at the top of this component), `fetchData`, `toastSuccess`, `toastHandleError`.

- [ ] **Step 1: Add the locale keys**

Add to `"saas"` in all three locale files:
- `plan_delete_blocked`: ar `"لا يمكن حذف هذه الباقة -- {{count}} تاجر مرتبط بها حالياً. عطّلها بدلاً من ذلك."`, en `"This plan can't be deleted -- {{count}} merchant(s) currently use it. Deactivate it instead."`, ur `"یہ پیکیج حذف نہیں ہو سکتا -- اس وقت {{count}} تاجر اسے استعمال کر رہے ہیں۔ اس کے بجائے اسے غیر فعال کریں۔"`
- `plan_delete_confirm`: ar `"هل أنت متأكد من حذف باقة \"{{name}}\"؟ هذا الإجراء لا يمكن التراجع عنه."`, en `"Delete the \"{{name}}\" plan? This cannot be undone."`, ur `"کیا آپ \"{{name}}\" پیکیج حذف کرنا چاہتے ہیں؟ یہ واپس نہیں ہو سکتا۔"`
- `plan_delete_success`: ar `"تم حذف الباقة بنجاح"`, en `"Plan deleted successfully"`, ur `"پیکیج کامیابی سے حذف ہو گیا"`
- `plan_delete_failed`: ar `"فشل حذف الباقة"`, en `"Failed to delete plan"`, ur `"پیکیج حذف کرنے میں ناکامی"`

- [ ] **Step 2: Validate the three locale JSON files parse**

Run: `node -e "['ar','en','ur'].forEach(l => JSON.parse(require('fs').readFileSync('./src/i18n/locales/'+l+'.json','utf8')))"`
Expected: no output, exit code 0.

- [ ] **Step 3: Implement `handleDeletePlan`**

Replace the Task 2 stub with:
```ts
const handleDeletePlan = async (plan: any) => {
  const subscriberCount = tenants.filter(t => t.planId === plan.id).length;
  if (subscriberCount > 0) {
    toastError(t('saas.plan_delete_blocked', { count: subscriberCount }));
    return;
  }
  if (!(await confirm({ description: t('saas.plan_delete_confirm', { name: plan.name }), danger: true }))) return;

  const { error } = await supabase.from('plans').delete().eq('id', plan.id);
  if (error) {
    toastHandleError(error, t('saas.plan_delete_failed'));
    return;
  }
  toastSuccess(t('saas.plan_delete_success'));
  await fetchData();
};
```
(`confirm({ description, danger: true })` matches the exact call shape already used elsewhere in this file, e.g. the tenant-suspension confirm.)

- [ ] **Step 4: Type-check**

Run: `npm run lint`
Expected: exits 0.

- [ ] **Step 5: Manual verification (the core safety property of this whole feature)**

In the browser: try to delete the `free` or `basic` seeded plan (both have real tenants on staging) — confirm the blocked message appears with the correct tenant count and no confirm dialog ever opens. Create a new throwaway test plan with no tenants, delete it — confirm the `useConfirm` dialog appears, confirming deletes it, and it disappears from the list.

- [ ] **Step 6: Commit**

```bash
git add src/components/SuperAdminDashboard.tsx src/i18n/locales/ar.json src/i18n/locales/en.json src/i18n/locales/ur.json
git commit -m "feat(plans): block deleting a plan that still has subscribed tenants"
```
