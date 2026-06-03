# SaaS Tailoring Platform Architecture Documentation

## 1. Dual-Layer RBAC System (Role-Based Access Control)

The platform implements a two-tier security model to isolate platform management from tenant operations.

### Level 1: SaaS Provider (Super Admin Level)
These roles manage the platform itself and provide support to subscribers.

| Role | Permissions | Description |
|------|-------------|-------------|
| **Super Admin** | Full Access | Complete control over the platform, subscribers, and advanced data management (deletions). |
| **Support Tech** | Read-Only | Can view subscriber data to provide technical assistance but cannot modify or delete records. |
| **Billing Admin** | Financial Access | Access restricted to subscriptions, invoices, and financial reports for the SaaS platform. |

### Level 2: Tenant/Subscriber Level
These roles operate within a single tenant's environment, isolated by `tenantId`.

| Role | Permissions | Description |
|------|-------------|-------------|
| **Owner** | Tenant Admin | Full control within their shop, manages staff accounts and shop settings. |
| **Cashier** | POS & Orders | Access to sales interface, order management, and customer records. |
| **Tailor** | Tasks & Measurements | Access restricted to assigned orders and garment measurements. |

---

## 2. Database Schema & Data Isolation

Data is isolated using a mandatory `tenantId` field on all operational records.

### Key Entities & Relationships
- **Tenants**: Stores shop metadata, owner info, and plan status.
- **Customers**: Linked to `tenantId`. Includes `isTest` flag for trial data.
- **Orders**: Linked to `tenantId` and `customerId`. Includes `isTest` flag.
- **Inventory**: Linked to `tenantId`. Includes `isTest` flag.
- **Audit Logs**: Global collection tracking sensitive Super Admin actions.

### Data Management Flags
- `isTest` (Boolean): Used to distinguish between trial/training data and real production data.
- `tenantId` (String): The primary partition key for data isolation.

---

## 3. Advanced Deletion Logic Flow

Before any data deletion is executed, the following verification steps are performed:

1. **Authentication**: Verify the user is a logged-in Super Admin.
2. **Authorization**: Verify the user has the `super_admin` role (Support Techs are blocked).
3. **Target Selection**: Select the specific `tenantId` for the operation.
4. **Dual Confirmation**:
   - **Step 1**: User selects the action (Delete Test Data or Factory Reset).
   - **Step 2**: For Factory Reset, the user must type the Tenant Name to confirm.
5. **Execution**:
   - **Delete Test Data**: Query `where('tenantId', '==', id).where('isTest', '==', true)` across all operational collections.
   - **Factory Reset**: Query `where('tenantId', '==', id)` across all operational collections.
6. **Audit Logging**: Record the action, timestamp, performer, and number of records deleted.

---

## 4. API Endpoints (Conceptual)

While implemented via Firestore SDK, the logic follows these conceptual patterns:

### DELETE `/api/admin/tenants/{tenantId}/test-data`
- **Purpose**: Removes all records marked with `isTest: true`.
- **Query**: `DELETE FROM collections WHERE tenantId = {tenantId} AND isTest = true`

### DELETE `/api/admin/tenants/{tenantId}/wipe`
- **Purpose**: Performs a factory reset for the tenant.
- **Query**: `DELETE FROM collections WHERE tenantId = {tenantId}`
- **Note**: Does not delete the Tenant record or Subscription.

---

## 5. Onboarding & Integration Logic

New subscribers must follow a strict onboarding flow where:
1. The `Tenant` record is created.
2. The `Owner` staff account is initialized.
3. Initial data integration (if any) is linked strictly via `customer_id` to ensure historical records are preserved and correctly partitioned under the new `tenantId`.
