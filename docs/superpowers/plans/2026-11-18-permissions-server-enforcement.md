# Server-Side Permissions Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce the 11 financially/security-critical keys of `roles.permissions` on the server (4 RPCs, 3 DELETE policies, 2 SELECT policies, 1 permissions-admin gate, 1 billing gate), replacing their current hardcoded `staff.role` enum checks.

**Architecture:** One new STABLE SECURITY DEFINER function `app_has_permission(p_permission_key text)` resolves the three-layer model (role default → tenant custom role → per-user override) the client already implements in `permissionService.ts`, backed by a second function `app_default_permission(p_role text, p_permission_key text)` holding the hardcoded fallback table for `staff.role_id IS NULL` rows. Every target then calls `app_has_permission('<key>')` instead of (or in addition to) its old `v_role NOT IN (...)` check.

**Tech Stack:** PostgreSQL/Supabase migrations, pgTAP tests (`supabase test db --linked`, run against the linked staging project — local Docker is unavailable on this machine, so every task's test command targets staging, inside pgTAP's own transaction rollback).

**Spec:** `docs/superpowers/specs/2026-11-18-permissions-server-enforcement-design.md`

## Global Constraints

- Scope is exactly these 11 permission keys, no others: `payments.collect`, `action.refund`, `action.discount`, `orders.delete`, `customers.delete`, `inventory.delete`, `staff.permissions`, `settings.billing`, `suppliers.manage`, `inventory.reconcile`, `shifts.manage`.
- `app_has_permission` and `app_default_permission` are `STABLE SECURITY DEFINER`, `SET search_path = public` — same pattern as `app_current_role()`.
- Any unexpected error inside `app_has_permission`/`app_default_permission` must propagate (fail-closed) — never caught and defaulted to `true`.
- `owner` and `app_is_super_admin()` always return `true` from `app_has_permission`, checked before any table lookup.
- The default-permission table in `app_default_permission` must match this exact matrix from the spec (✅=true, ❌=false), one row per `staff.role` enum value:

  | role | payments.collect | action.refund | action.discount | orders.delete | customers.delete | inventory.delete | staff.permissions | settings.billing | suppliers.manage | inventory.reconcile | shifts.manage |
  |---|---|---|---|---|---|---|---|---|---|---|---|
  | admin | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ |
  | manager | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ |
  | branch_manager | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
  | accountant | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
  | warehouse_manager | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ |
  | cashier | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
  | tailor | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

  (`owner` is short-circuited before this table is ever consulted; it needs no row.)
- Every migration follows the project's existing header-comment convention (cite the finding, cite the old check being replaced, cite this plan).
- Every task's test file lives in `supabase/tests/`, named `<task_topic>_test.sql`, structured like `supabase/tests/supplier_balance_role_guard_test.sql` (fixtures under `SET session_replication_role = replica`, `SET LOCAL ROLE authenticated` + `SET LOCAL request.jwt.claims` per scenario, `BEGIN`/`ROLLBACK`, `plan(N)` / `finish()`).
- No migration in this plan is pushed anywhere outside the already-linked **staging** project without a separate, explicit human approval per the project's own standing rule — this plan's own test command pushes to staging as part of running pgTAP (see Global Constraints test command below), but promoting to production is explicitly out of scope for every task here.

## Review Focus

- A `staff` row with `role_id` pointing at a **custom tenant role that only sets a few keys** in its `permissions` JSONB (the other 43-11=32 keys absent, not `false`) must fall through to `app_default_permission` for any of the 11 keys that JSONB object doesn't mention — not silently return `false` because the key is merely absent from the object. Task 1's tests must cover a role row with a partial JSONB object, not just an empty `{}` or a fully-populated one.
- A `user_permission_overrides` row whose `overrides` JSONB sets a key to `false` must win over a role default of `true` (the documented "override wins" rule) — and a row that exists but doesn't mention the key being checked must fall through to the role-level result, not to `false`. Task 1's tests must cover both an overriding-to-false row and a row present-but-silent-on-this-key.
- `create_pos_sale`'s `action.discount = false` path must reject a `discount_value` of exactly `0` sent as `fixed`/`percent` type successfully (no discount requested, nothing to block) but reject any `discount_value > 0` — an off-by-the-wrong-comparison here either blocks legitimate no-discount sales or lets a zero-permission cashier discount after all. Task 2's tests must include a `discount_value: 0` case that succeeds under `action.discount = false`.
- `close_shift` closing **your own** shift must stay permission-check-free regardless of `shifts.manage` (today's behavior: only closing *someone else's* shift is gated) — Task 3's tests must prove a `tailor` (who has `shifts.manage = false` in the default table) can still close their own shift.
- The `issue_supplier_payment`/`increment_supplier_balance` behavior change (branch_manager/warehouse_manager gaining real access) must be proven with both of those two specific roles, not just one representative role, since they reach `suppliers.manage = true` by different paths (explicit role list vs. default table) — Task 5's tests must include both.

---

### Task 1: `app_has_permission` / `app_default_permission` core functions

**Files:**
- Create: `supabase/migrations/20261205000000_app_has_permission.sql`
- Create: `supabase/tests/app_has_permission_test.sql`

**Interfaces:**
- Produces: `public.app_has_permission(p_permission_key TEXT) RETURNS BOOLEAN` — callable by `authenticated`, used by every later task.
- Produces: `public.app_default_permission(p_role TEXT, p_permission_key TEXT) RETURNS BOOLEAN` — callable only by `app_has_permission` itself (not exposed to `authenticated`), used by no other task directly.
- Consumes: `public.app_is_super_admin()`, `public.app_current_role()`, `public.app_current_staff_id()` (all pre-existing).

- [ ] **Step 1: Write the failing pgTAP test file**

`supabase/tests/app_has_permission_test.sql`, fixtures: one tenant; one `roles` row for that tenant with `role_key = 'custom_cashier'` and `permissions = '{"payments.collect": true}'::jsonb` (deliberately partial — only one key set); staff rows: `owner` (role, no `role_id`), a `cashier` with `role_id` pointing at that custom role, a `tailor` with `role_id IS NULL`; a `user_permission_overrides` row for the cashier with `overrides = '{"action.discount": false}'::jsonb` (overriding a key the custom role never mentions, so the role falls through to `app_default_permission('cashier', 'action.discount')` = `true`, and the override flips it to `false`) and a second staff (another cashier, call it "cashier two") with an overrides row of `'{"shifts.manage": false}'::jsonb` to prove a present override with no relation to the key under test does NOT affect that key (checking `payments.collect` for cashier-two must still resolve via the custom role's own `true`, unaffected by the unrelated override key). Cover, as `plan(8)`:
  1. `owner` → `app_has_permission('settings.billing')` is `true` (short-circuit, no table read needed).
  2. `cashier` (custom role sets `payments.collect: true`) → `app_has_permission('payments.collect')` is `true` (reads the role's own JSONB).
  3. `cashier` → `app_has_permission('action.refund')` (key absent from the custom role's JSONB) falls through to `app_default_permission('cashier', 'action.refund')` = `false` per the Global Constraints matrix.
  4. `cashier` → `app_has_permission('action.discount')` is `false` (override wins over the `true` the default table would otherwise give).
  5. `cashier-two` → `app_has_permission('payments.collect')` is still `true` (unrelated override key on the row doesn't affect this key).
  6. `tailor` (`role_id IS NULL`) → `app_has_permission('shifts.manage')` is `false` (pure default-table fallback, matches the matrix).
  7. `tailor` → `app_has_permission('orders.delete')` is `false` (same fallback, different key, proves the table isn't just returning `true`/`false` by accident of key name).
  8. A staff row with no matching session (`app_current_role()` returns `NULL` — simulate by never setting `request.jwt.claims`) → `app_has_permission('payments.collect')` is `false`, not an error.

- [ ] **Step 2: Run test to verify it fails**

Run: `supabase test db --linked supabase/tests/app_has_permission_test.sql`
Expected: FAIL — `function app_has_permission(text) does not exist`.

- [ ] **Step 3: Implement both functions in `supabase/migrations/20261205000000_app_has_permission.sql`**

`app_default_permission(p_role TEXT, p_permission_key TEXT) RETURNS BOOLEAN` — a single `CASE p_role WHEN 'admin' THEN (CASE p_permission_key WHEN ... END) ... END` (or an equivalent `VALUES` table joined on both columns) encoding exactly the Global Constraints matrix; any `(role, key)` pair not in the matrix, and any role not in the matrix (e.g. `owner`, which never reaches this function), returns `false`.

`app_has_permission(p_permission_key TEXT) RETURNS BOOLEAN` implementing the 3-layer resolution exactly as pseudocoded in the spec section 2: super_admin/owner short-circuit → resolve `staff.role_id` for `app_current_staff_id()` → if `role_id` is set, read `roles.permissions`, and use its value for `p_permission_key` only `IF v_permissions ? p_permission_key` (the `?` JSONB "key exists" operator — this is what makes Review Focus item 1 pass: an absent key, not merely a falsy one, triggers the default-table fallback) → otherwise call `app_default_permission(app_current_role(), p_permission_key)` → finally apply `user_permission_overrides.overrides` the same way (`?` existence check, not just truthiness) over whichever value layer 2 produced.

- [ ] **Step 4: Run test to verify it passes**

Run: `supabase test db --linked supabase/tests/app_has_permission_test.sql`
Expected: PASS — `8/8`.

- [ ] **Step 5: Push migration to staging and commit**

```bash
npx supabase db push
git add supabase/migrations/20261205000000_app_has_permission.sql supabase/tests/app_has_permission_test.sql
git commit -m "feat(permissions): add app_has_permission server-side resolver"
```

---

### Task 2: `create_pos_sale` — `payments.collect` and `action.discount`

**Files:**
- Create: `supabase/migrations/20261206000000_create_pos_sale_permission_checks.sql` (full `CREATE OR REPLACE FUNCTION public.create_pos_sale(...)`, copied from the current definition in `supabase/migrations/20261204000000_create_pos_sale_catalog_price_any_item_id.sql` with only the two additions below)
- Create: `supabase/tests/create_pos_sale_permission_checks_test.sql`

**Interfaces:**
- Consumes: `app_has_permission(text)` from Task 1.

- [ ] **Step 1: Write the failing pgTAP test file**

Fixtures: one tenant, an open shift, a `cashier` with `role_id IS NULL` (default table: `payments.collect = true`, `action.discount = true` — baseline must still work) and a second `cashier` ("cashier-no-discount") whose custom role sets `{"action.discount": false}` only. `plan(3)`:
  1. Baseline cashier calling `create_pos_sale` with `paid_amount > 0` and no discount → `lives_ok` (nothing regresses for the common case).
  2. cashier-no-discount calling `create_pos_sale` with `discount_value: 0` → `lives_ok` (Review Focus item 3 — zero discount is never blocked).
  3. cashier-no-discount calling `create_pos_sale` with `discount_value: 10` (any positive value) → `throws_matching` a new, specific Arabic message (choose and use consistently, e.g. `'لا تملك صلاحية منح خصم'`).

- [ ] **Step 2: Run test to verify it fails**

Run: `supabase test db --linked supabase/tests/create_pos_sale_permission_checks_test.sql`
Expected: FAIL on scenario 3 — `lives_ok` where `throws_matching` is expected (no discount gate exists yet).

- [ ] **Step 3: Add the two checks to `create_pos_sale`**

Immediately after the existing `v_staff := public.app_current_staff_id();` line: `IF NOT public.app_has_permission('payments.collect') THEN RAISE EXCEPTION '...' USING ERRCODE = '42501'; END IF;`. Immediately after `v_discount_value := GREATEST(...)` is computed (before it's used to derive `v_discount_gross`): `IF v_discount_value > 0 AND NOT public.app_has_permission('action.discount') THEN RAISE EXCEPTION 'لا تملك صلاحية منح خصم' USING ERRCODE = '42501'; END IF;`.

- [ ] **Step 4: Run test to verify it passes**

Run: `supabase test db --linked supabase/tests/create_pos_sale_permission_checks_test.sql`
Expected: PASS — `3/3`.

- [ ] **Step 5: Push migration to staging and commit**

```bash
npx supabase db push
git add supabase/migrations/20261206000000_create_pos_sale_permission_checks.sql supabase/tests/create_pos_sale_permission_checks_test.sql
git commit -m "feat(permissions): gate create_pos_sale on payments.collect/action.discount"
```

---

### Task 3: `close_shift` — `shifts.manage`

**Files:**
- Create: `supabase/migrations/20261207000000_close_shift_permission_check.sql` (full `CREATE OR REPLACE FUNCTION public.close_shift(...)`, copied from `supabase/migrations/20261128000000_shift_cash_single_source_of_truth.sql`, replacing only the role check)
- Create: `supabase/tests/close_shift_permission_check_test.sql`

**Interfaces:**
- Consumes: `app_has_permission(text)` from Task 1.

- [ ] **Step 1: Write the failing pgTAP test file**

Fixtures: owner, a `tailor` (default table: `shifts.manage = false`) with their own open shift, and a `manager` (default table: `shifts.manage = true`). `plan(3)`:
  1. `tailor` closes **their own** shift → `lives_ok` (Review Focus item 4 — closing your own shift is never gated by `shifts.manage`).
  2. `tailor` attempts to close the `manager`'s (someone else's) shift → `throws_matching` the existing error message (unchanged text, now reached via the new check).
  3. `manager` closes the `tailor`'s shift → `lives_ok` (has `shifts.manage = true`, so the cross-staff close succeeds).

- [ ] **Step 2: Run test to verify it fails**

Run: `supabase test db --linked supabase/tests/close_shift_permission_check_test.sql`
Expected: FAIL on scenario 3 — the current code's `v_role NOT IN ('owner','admin','manager')` already happens to allow `manager`, so this one in isolation may already pass; scenario 2 must still be checked to confirm it throws with the pre-existing message (regression guard, not a new failure) before Step 3 changes anything.

- [ ] **Step 3: Replace the role check in `close_shift`**

Change `IF v_staff IS DISTINCT FROM v_shift_staff AND (v_role IS NULL OR v_role NOT IN ('owner', 'admin', 'manager')) THEN` to `IF v_staff IS DISTINCT FROM v_shift_staff AND NOT public.app_has_permission('shifts.manage') THEN` (owner already short-circuits inside `app_has_permission` itself, so dropping the enum list here loses nothing).

- [ ] **Step 4: Run test to verify it passes**

Run: `supabase test db --linked supabase/tests/close_shift_permission_check_test.sql`
Expected: PASS — `3/3`.

- [ ] **Step 5: Push migration to staging and commit**

```bash
npx supabase db push
git add supabase/migrations/20261207000000_close_shift_permission_check.sql supabase/tests/close_shift_permission_check_test.sql
git commit -m "feat(permissions): gate close_shift cross-staff close on shifts.manage"
```

---

### Task 4: `approve_stock_take` — `inventory.reconcile`

**Files:**
- Create: `supabase/migrations/20261208000000_approve_stock_take_permission_check.sql` (full function, copied from `supabase/migrations/20261115030000_approve_stock_take_atomic.sql`, replacing only the role check)
- Create: `supabase/tests/approve_stock_take_permission_check_test.sql`

**Interfaces:**
- Consumes: `app_has_permission(text)` from Task 1.

- [ ] **Step 1: Write the failing pgTAP test file**

Fixtures: a draft stock-take row, a `cashier` (default table: `inventory.reconcile = false`), a `warehouse_manager` (default table: `inventory.reconcile = true`). `plan(2)`:
  1. `cashier` calls `approve_stock_take(..., p_status => 'Approved')` → `throws_matching` the existing error message.
  2. `warehouse_manager` calls the same → `lives_ok`.

- [ ] **Step 2: Run test to verify it fails**

Run: `supabase test db --linked supabase/tests/approve_stock_take_permission_check_test.sql`
Expected: FAIL on scenario 2 — today's enum check (`owner,admin,manager`) rejects `warehouse_manager`, who should succeed once this task's change lands.

- [ ] **Step 3: Replace the role check in `approve_stock_take`**

Change `IF p_status = 'Approved' AND (v_role IS NULL OR v_role NOT IN ('owner', 'admin', 'manager')) THEN` to `IF p_status = 'Approved' AND NOT public.app_has_permission('inventory.reconcile') THEN`.

- [ ] **Step 4: Run test to verify it passes**

Run: `supabase test db --linked supabase/tests/approve_stock_take_permission_check_test.sql`
Expected: PASS — `2/2`.

- [ ] **Step 5: Push migration to staging and commit**

```bash
npx supabase db push
git add supabase/migrations/20261208000000_approve_stock_take_permission_check.sql supabase/tests/approve_stock_take_permission_check_test.sql
git commit -m "feat(permissions): gate approve_stock_take approval on inventory.reconcile"
```

---

### Task 5: `issue_supplier_payment` + `increment_supplier_balance` — `suppliers.manage`

**Files:**
- Create: `supabase/migrations/20261209000000_supplier_rpcs_permission_check.sql` (both full functions, copied from `supabase/migrations/20261115060000_issue_supplier_payment_atomic.sql` and `supabase/migrations/20261121000000_supplier_balance_role_guard.sql`, replacing only their role checks)
- Create: `supabase/tests/supplier_rpcs_permission_check_test.sql`

**Interfaces:**
- Consumes: `app_has_permission(text)` from Task 1.

- [ ] **Step 1: Write the failing pgTAP test file**

Fixtures: a supplier with a balance, a `cashier` (default: `suppliers.manage = false`), a `branch_manager` (default: `suppliers.manage = true`), a `warehouse_manager` (default: `suppliers.manage = true`). `plan(4)` (Review Focus's last item — both roles, not one):
  1. `cashier` calls `issue_supplier_payment(...)` → `throws_matching` (unchanged rejection).
  2. `branch_manager` calls `issue_supplier_payment(...)` → `lives_ok` (the documented, approved behavior change).
  3. `warehouse_manager` calls `increment_supplier_balance(...)` → `lives_ok` (same behavior change, the other RPC).
  4. `cashier` calls `increment_supplier_balance(...)` → `throws_matching` (unchanged rejection, confirms the swap didn't accidentally open this one to everyone).

- [ ] **Step 2: Run test to verify it fails**

Run: `supabase test db --linked supabase/tests/supplier_rpcs_permission_check_test.sql`
Expected: FAIL on scenarios 2 and 3 — today's enum checks reject both `branch_manager` and `warehouse_manager`.

- [ ] **Step 3: Replace the role checks in both functions**

In `issue_supplier_payment`: change `IF v_role IS NULL OR v_role NOT IN ('owner', 'admin', 'manager', 'accountant') THEN` to `IF NOT public.app_has_permission('suppliers.manage') THEN`. In `increment_supplier_balance`: apply the equivalent replacement to its existing role check (read the current body in `supabase/migrations/20261121000000_supplier_balance_role_guard.sql` first — same substitution pattern, same permission key).

- [ ] **Step 4: Run test to verify it passes**

Run: `supabase test db --linked supabase/tests/supplier_rpcs_permission_check_test.sql`
Expected: PASS — `4/4`.

- [ ] **Step 5: Push migration to staging and commit**

```bash
npx supabase db push
git add supabase/migrations/20261209000000_supplier_rpcs_permission_check.sql supabase/tests/supplier_rpcs_permission_check_test.sql
git commit -m "feat(permissions): gate supplier payment RPCs on suppliers.manage"
```

---

### Task 6: DELETE policies — `orders.delete`, `customers.delete`, `inventory.delete`

**Files:**
- Create: `supabase/migrations/20261210000000_delete_policies_permission_based.sql`
- Create: `supabase/tests/delete_policies_permission_based_test.sql`

**Interfaces:**
- Consumes: `app_has_permission(text)` from Task 1.

- [ ] **Step 1: Write the failing pgTAP test file**

Fixtures: a tenant, an order row, a customer row, an inventory_items row, a `cashier` (defaults: all three `*.delete` keys `false`), an `admin` (defaults: all three `true`). `plan(6)`:
  1. `cashier` `DELETE FROM orders WHERE id = ...` → `throws_like '%row-level security%'`.
  2. `admin` same → `lives_ok`.
  3. `cashier` `DELETE FROM customers WHERE id = ...` → `throws_like '%row-level security%'` (new policy — today this has no role restriction at all, so this scenario currently fails the other way: it would `lives_ok` before this task).
  4. `admin` same → `lives_ok`.
  5. `cashier` `DELETE FROM inventory_items WHERE id = ...` → `throws_like '%row-level security%'` (same — new policy).
  6. `admin` same → `lives_ok`.

- [ ] **Step 2: Run test to verify it fails**

Run: `supabase test db --linked supabase/tests/delete_policies_permission_based_test.sql`
Expected: FAIL on scenarios 3 and 5 — no DELETE policy restricts `customers`/`inventory_items` by role today, so the cashier's delete currently succeeds instead of throwing.

- [ ] **Step 3: Add/replace the three DELETE policies**

For `orders`: `DROP POLICY IF EXISTS orders_tenant_delete ON orders;` (confirm the exact existing policy name first by reading the latest migration that created it) then `CREATE POLICY orders_tenant_delete ON orders FOR DELETE USING (app_is_super_admin() OR (tenant_id = app_current_tenant_id() AND app_has_permission('orders.delete')));`. For `customers` and `inventory_items` (no prior DELETE policy to drop — confirm via the same `tenant_tables` loop in `20240601000000_track_base_schema.sql`), add the equivalent new `CREATE POLICY <table>_tenant_delete ON <table> FOR DELETE USING (app_is_super_admin() OR (tenant_id = app_current_tenant_id() AND app_has_permission('<key>')));` for `customers.delete` and `inventory.delete` respectively.

- [ ] **Step 4: Run test to verify it passes**

Run: `supabase test db --linked supabase/tests/delete_policies_permission_based_test.sql`
Expected: PASS — `6/6`.

- [ ] **Step 5: Push migration to staging and commit**

```bash
npx supabase db push
git add supabase/migrations/20261210000000_delete_policies_permission_based.sql supabase/tests/delete_policies_permission_based_test.sql
git commit -m "feat(permissions): gate orders/customers/inventory_items DELETE on permission keys"
```

---

### Task 7: SELECT policies — `payments.view_prices`, `suppliers.manage`

**Files:**
- Create: `supabase/migrations/20261211000000_select_policies_permission_based.sql`
- Create: `supabase/tests/select_policies_permission_based_test.sql`

**Interfaces:**
- Consumes: `app_has_permission(text)` from Task 1.

- [ ] **Step 1: Write the failing pgTAP test file**

Fixtures: a tenant, a `payments` row, a `suppliers` row, a `supplier_transactions` row, a `tailor` (defaults: `payments.view_prices` absent from the matrix → **not** one of this plan's 11 keys — see Step 3 note), a `cashier` (defaults: `suppliers.manage = false`), an `admin` (defaults: `suppliers.manage = true`). `plan(4)`:
  1. `cashier` `SELECT * FROM suppliers WHERE tenant_id = ...` → returns 0 rows (`is(..., 0::bigint, ...)` on a `SELECT count(*)`), not an error (RLS SELECT failure mode).
  2. `admin` same → returns 1 row.
  3. `cashier` `SELECT * FROM supplier_transactions WHERE tenant_id = ...` → 0 rows.
  4. `admin` same → 1 row.

- [ ] **Step 2: Run test to verify it fails**

Run: `supabase test db --linked supabase/tests/select_policies_permission_based_test.sql`
Expected: FAIL on scenarios 1 and 3 — no SELECT restriction on `suppliers`/`supplier_transactions` today, so the cashier currently sees the row.

- [ ] **Step 3: Add the SELECT policies — `payments.view_prices` is NOT in this plan's 11-key scope; use `payments` tenant-match only, unchanged**

Re-read the spec's Section 1.1 list before writing this migration: `payments.view_prices` does not appear in the 11 approved keys (it was in the original brainstorming discussion as an example, not in the final approved list). Implement only the two policies the spec's Section 3 table actually names under this task — `suppliers` and `supplier_transactions` SELECT gated on `suppliers.manage`. For each: `DROP POLICY IF EXISTS <table>_tenant_read ON <table>;` then `CREATE POLICY <table>_tenant_read ON <table> FOR SELECT USING (app_is_super_admin() OR (tenant_id = app_current_tenant_id() AND app_has_permission('suppliers.manage')));` (confirm each policy's exact current name first by reading the `tenant_tables` loop in `20240601000000_track_base_schema.sql`). Do not touch `payments`'s SELECT policy in this task.

- [ ] **Step 4: Run test to verify it passes**

Run: `supabase test db --linked supabase/tests/select_policies_permission_based_test.sql`
Expected: PASS — `4/4`.

- [ ] **Step 5: Push migration to staging and commit**

```bash
npx supabase db push
git add supabase/migrations/20261211000000_select_policies_permission_based.sql supabase/tests/select_policies_permission_based_test.sql
git commit -m "feat(permissions): gate suppliers/supplier_transactions SELECT on suppliers.manage"
```

---

### Task 8: `staff.permissions` and `settings.billing` gates

**Files:**
- Create: `supabase/migrations/20261212000000_permissions_and_billing_admin_gates.sql`
- Create: `supabase/tests/permissions_and_billing_admin_gates_test.sql`

**Interfaces:**
- Consumes: `app_has_permission(text)` from Task 1.

- [ ] **Step 1: Write the failing pgTAP test file**

First, read `src/components/Staff.tsx`'s/`RolePermissionsSettings.tsx`'s exact current write path to `roles`/`user_permission_overrides` and the current `tenants_no_self_billing_escalation` trigger body (`supabase/migrations/20260908040000_tenants_no_self_billing_escalation.sql`) to know the exact policy/trigger names and columns being touched before writing fixtures. Fixtures: a tenant, an `admin` (defaults: `staff.permissions = true`, `settings.billing = false`), a `manager` (defaults: `staff.permissions = false`), a custom `roles` row for this tenant. `plan(4)`:
  1. `manager` `UPDATE roles SET permissions = '{}' WHERE id = ...` (the custom role) → rejected (match whatever mechanism Step 3 uses — RLS `throws_like '%row-level security%'` or trigger `throws_matching` a specific message).
  2. `admin` same → `lives_ok`.
  3. `admin` `UPDATE tenants SET plan_id = 'basic' WHERE id = ...` → rejected (has `staff.permissions` but not `settings.billing`; the existing `tenants_no_self_billing_escalation` trigger's own message, now reached via the permission check instead of the enum check — confirm its exact current message text while reading it in Step 1 and reuse it here).
  4. `owner` same → `lives_ok` (owner always passes via `app_has_permission`'s short-circuit).

- [ ] **Step 2: Run test to verify it fails**

Run: `supabase test db --linked supabase/tests/permissions_and_billing_admin_gates_test.sql`
Expected: FAIL on scenario 1 — today's check is `owner`-only from the client with no real RLS gate on `roles`, so `manager` currently succeeds.

- [ ] **Step 3: Add the `staff.permissions` gate and swap the `settings.billing` check**

For `roles` and `user_permission_overrides` UPDATE/INSERT: add (or tighten an existing) RLS policy requiring `app_has_permission('staff.permissions')` in addition to the existing tenant-match condition — match whichever of RLS-policy-only or RLS-plus-trigger shape the current code already uses for each table (read before writing, per Step 1). For `tenants_no_self_billing_escalation`: replace its internal role-enum check with `NOT public.app_has_permission('settings.billing')`, keeping its existing exception message and `app_is_super_admin()`/`current_user IN ('postgres','service_role')` exemptions untouched (same SECURITY-INVOKER lesson as every other guard trigger fixed earlier in this codebase — do not add `SECURITY DEFINER` to this trigger function if it doesn't already have it).

- [ ] **Step 4: Run test to verify it passes**

Run: `supabase test db --linked supabase/tests/permissions_and_billing_admin_gates_test.sql`
Expected: PASS — `4/4`.

- [ ] **Step 5: Push migration to staging and commit**

```bash
npx supabase db push
git add supabase/migrations/20261212000000_permissions_and_billing_admin_gates.sql supabase/tests/permissions_and_billing_admin_gates_test.sql
git commit -m "feat(permissions): gate role/override edits and billing changes on staff.permissions/settings.billing"
```

---

## After all tasks

Run the full pgTAP suite once more against staging to confirm no cross-task regression:

```bash
npx supabase test db --linked
```

Then run the existing non-SQL verification the project always runs before any staging-affecting change: `npx tsc --noEmit` and `npx vitest run` (no TypeScript files change in this plan, so both should be a no-op pass — if either fails, something outside this plan's stated scope broke, and that is itself a finding to report, not fix silently).

No task in this plan pushes anything to production. Production promotion requires the same explicit, separate founder approval every other migration batch in this project has required, after a live-in-browser check of at least the one deliberate behavior change (Task 5, `branch_manager`/`warehouse_manager` gaining real `issue_supplier_payment` access) with a real staff account of each of those two roles.
