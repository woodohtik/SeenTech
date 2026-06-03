export type UserId = string;
export type UUID = string;
export type Timestamptz = string;
export type Numeric = string | number;
export type Inet = string;

export type TenantStatus         = 'active' | 'inactive' | 'pending';
export type InventoryStrategy    = 'centralized' | 'decentralized';
export type LayoutMode           = 'sidebar' | 'grid';

export type SaasUserRole         = 'super_admin' | 'support_tech' | 'billing_admin';

export type UserRole =
    | 'super_admin'
    | 'support_tech'
    | 'billing_admin'
    | 'owner'
    | 'admin'
    | 'manager'
    | 'cashier'
    | 'tailor'
    | 'accountant'
    | 'branch_manager'
    | 'warehouse_manager';

export type StaffStatus          = 'active' | 'inactive';
export type BranchType           = 'warehouse' | 'store';

export type InventoryCategory =
    | 'fabric'
    | 'thread'
    | 'button'
    | 'lining'
    | 'accessories'
    | 'ready_made'
    | 'other';

export type InventoryUnit =
    | 'meter'
    | 'yard'
    | 'roll'
    | 'bolt'
    | 'piece'
    | 'spool'
    | 'box';

export type InventoryBaseUnit    = 'meter' | 'piece';

export type PaymentMethod =
    | 'cash'
    | 'network'
    | 'bank_transfer'
    | 'cash_on_delivery'
    | 'partial';

export type OrderStatus =
    | 'measurements_taken'
    | 'cutting'
    | 'sewing'
    | 'embroidery'
    | 'ironing_packaging'
    | 'ready'
    | 'partial_delivered'
    | 'delivered'
    | 'cancelled';

export type OrderItemType        = 'custom' | 'ready_made';
export type ClosureType          = 'zipper' | 'buttons';
export type ClosureVisibility    = 'hidden' | 'visible';
export type CollarPadding        = 'hard' | 'soft';

export type PurchaseOrderStatus  = 'draft' | 'confirmed' | 'sent' | 'received' | 'returned';

export type TransferStatus =
    | 'draft'
    | 'pending'
    | 'in_transit'
    | 'completed'
    | 'rejected'
    | 'cancelled';

export type StockMovementType =
    | 'addition'
    | 'deduction'
    | 'transfer_in'
    | 'transfer_out'
    | 'reconciliation'
    | 'adjustment'
    | 'sale';

export type ShiftStatus          = 'open' | 'closed';
export type ShiftEntryType       = 'payout' | 'deposit';

export type TailorRequestStatus  = 'pending' | 'approved' | 'rejected';

export type NotificationType     = 'inventory' | 'order' | 'system' | 'alert';
export type NotificationStatus   = 'unread' | 'read';

export type InvoiceType = 'simplified_b2c' | 'standard_b2b' | 'credit_note' | 'debit_note';

export type InvoiceStatus =
    | 'draft'
    | 'issued'
    | 'paid'
    | 'partially_paid'
    | 'refunded'
    | 'cancelled';

export type SalesReturnStatus    = 'pending' | 'approved' | 'rejected' | 'completed';

export type AuditLogType         = 'deletion' | 'security' | 'system';

export type PermissionKey = string;
export type PermissionsMap = Record<PermissionKey, boolean>;
export type PermissionOverridesMap = Record<PermissionKey, boolean | null>;

export interface ThobeMeasurements {
    length?: Numeric;
    shoulder?: Numeric;
    sleeve?: Numeric;
    cuff?: Numeric;
    chest?: Numeric;
    waist?: Numeric;
    hip?: Numeric;
    collar?: Numeric;
    neck?: Numeric;
    wrist?: Numeric;
    thigh?: Numeric;
    [extra: string]: Numeric | undefined;
}

export interface Measurements {
    thobe?: ThobeMeasurements;
    [garment: string]: Record<string, Numeric | undefined> | undefined;
}

export interface Styles {
    neckShape?: string;
    sleeveStyle?: string;
    pocketType?: string;
    collarType?: string;
    cuffType?: string;
    chestStyle?: string;
    latitude?: string | number;
    longitude?: string | number;
    address?: string;
    city?: string;
    [extra: string]: string | number | undefined;
}

export interface ShiftTotals {
    cash?: Numeric;
    card?: Numeric;
    network?: Numeric;
    bank_transfer?: Numeric;
    returns?: Numeric;
    discounts?: Numeric;
    taxes?: Numeric;
    gross?: Numeric;
    net?: Numeric;
    order_count?: number;
    [extra: string]: Numeric | number | undefined;
}

export type VariantOptions = Record<string, string | number | boolean>;

export interface ImageRef {
    url: string;
    path?: string;
    alt?: string;
    width?: number;
    height?: number;
}

export interface User {
    id: UserId;
    email: string;
    display_name: string | null;
    phone: string | null;
    photo_url: string | null;
    email_verified: boolean;
    disabled: boolean;
    last_sign_in_at: Timestamptz | null;
    created_at: Timestamptz;
    updated_at: Timestamptz;
}

export interface Plan {
    id: string;
    name: string;
    price: Numeric;
    features: string[];
    max_staff: number;
    max_orders: number;
    is_active: boolean;
    created_at: Timestamptz;
    updated_at: Timestamptz;
}

export interface Tenant {
    id: UUID;
    legacy_id: string | null;
    customer_id: string | null;
    owner_uid: UserId | null;
    name: string;
    owner_email: string;
    phone: string;
    address: string | null;
    vat_number: string | null;
    commercial_register: string | null;
    is_tax_enabled: boolean;
    default_tax_rate: Numeric;
    status: TenantStatus;
    plan_id: string | null;
    inventory_strategy: InventoryStrategy;
    logo_url: string | null;
    default_layout: LayoutMode;
    is_test: boolean;
    currency_symbol?: string | null;
    created_at: Timestamptz;
    updated_at: Timestamptz;
}

export interface SaasUser {
    uid: UserId;
    name: string;
    email: string;
    role: SaasUserRole;
    is_active: boolean;
    mfa_enabled: boolean;
    created_at: Timestamptz;
    updated_at: Timestamptz;
}

export interface SaasSetting<V = unknown> {
    key: string;
    value: V;
    updated_by: UserId | null;
    updated_at: Timestamptz;
}

export interface SaasSecurityLog {
    id: number;
    user_id: UserId | null;
    user_email: string | null;
    action: string;
    details: string | null;
    ip_address: Inet | null;
    user_agent: string | null;
    occurred_at: Timestamptz;
}

export interface TailorRequest {
    id: UUID;
    uid: UserId | null;
    customer_id: string | null;
    name: string;
    phone: string;
    email: string;
    shop_name: string | null;
    shop_phone: string | null;
    address: string | null;
    onboarding_step: number | null;
    status: TailorRequestStatus;
    approved_by: UserId | null;
    approved_at: Timestamptz | null;
    tenant_id: UUID | null;
    created_at: Timestamptz;
    updated_at: Timestamptz;
}

export interface Branch {
    id: UUID;
    tenant_id: UUID;
    name: string;
    location: string;
    phone: string | null;
    type: BranchType;
    is_main: boolean;
    is_active: boolean;
    created_at: Timestamptz;
    updated_at: Timestamptz;
}

export interface Role {
    id: UUID;
    tenant_id: UUID | null;
    role_key: string;
    name: string;
    description: string | null;
    permissions: PermissionsMap;
    is_default: boolean;
    is_system: boolean;
    created_at: Timestamptz;
    updated_at: Timestamptz;
}

export interface Staff {
    id: UUID;
    tenant_id: UUID;
    uid: UserId | null;
    name: string;
    email: string;
    phone: string | null;
    role: UserRole;
    role_id: UUID | null;
    branch_id: UUID | null;
    status: StaffStatus;
    pin_hash: string | null;
    must_change_pin: boolean;
    is_test: boolean;
    created_at: Timestamptz;
    updated_at: Timestamptz;
}

export interface UserPermissionOverride {
    staff_id: UUID;
    tenant_id: UUID;
    overrides: PermissionOverridesMap;
    updated_by: UserId | null;
    updated_at: Timestamptz;
}

export interface Customer {
    id: UUID;
    tenant_id: UUID;
    name: string;
    phone: string;
    email: string | null;
    vat_number: string | null;
    company_name: string | null;
    measurements: Measurements;
    styles: Styles;
    notes: string | null;
    is_test: boolean;
    created_at: Timestamptz;
    updated_at: Timestamptz;
}

export interface Supplier {
    id: UUID;
    tenant_id: UUID;
    name: string;
    contact_person: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    tax_number: string | null;
    category: string | null;
    balance: Numeric;
    is_active: boolean;
    created_at: Timestamptz;
    updated_at: Timestamptz;
}

export interface InventoryItem {
    id: UUID;
    tenant_id: UUID;
    supplier_id: UUID | null;
    name: string;
    description: string | null;
    category: InventoryCategory;
    unit: InventoryUnit;
    base_unit: InventoryBaseUnit;
    conversion_rate: Numeric;
    min_threshold: Numeric;
    price_per_unit: Numeric;
    sku: string;
    barcode: string | null;
    quantity: Numeric;
    images: ImageRef[];
    collar_type: string | null;
    cuff_type: string | null;
    pocket_type: string | null;
    chest_style: string | null;
    is_test: boolean;
    show_in_pos: boolean;
    opening_balance: Numeric;
    created_at: Timestamptz;
    updated_at: Timestamptz;
}

export interface InventoryVariant {
    id: UUID;
    tenant_id: UUID;
    item_id: UUID;
    sku: string;
    barcode: string | null;
    name: string;
    options: VariantOptions;
    price_adjustment: Numeric;
    created_at: Timestamptz;
    updated_at: Timestamptz;
}

export interface BranchInventory {
    id: UUID;
    tenant_id: UUID;
    branch_id: UUID;
    item_id: UUID;
    variant_id: UUID | null;
    quantity: Numeric;
    reserved: Numeric;
    updated_at: Timestamptz;
}

export interface StockTransfer {
    id: UUID;
    tenant_id: UUID;
    from_branch_id: UUID;
    to_branch_id: UUID;
    status: TransferStatus;
    requested_by: UUID | null;
    requested_by_name: string | null;
    shipped_by: UUID | null;
    received_by: UUID | null;
    notes: string | null;
    remarks: string | null;
    shipped_at: Timestamptz | null;
    received_at: Timestamptz | null;
    created_at: Timestamptz;
    updated_at: Timestamptz;
}

export interface StockTransferItem {
    id: UUID;
    tenant_id: UUID;
    transfer_id: UUID;
    item_id: UUID;
    item_name: string;
    requested_quantity: Numeric;
    shipped_quantity: Numeric | null;
    received_quantity: Numeric | null;
    created_at: Timestamptz;
}

export interface StockLedgerEntry {
    id: number;
    tenant_id: UUID;
    branch_id: UUID;
    item_id: UUID;
    variant_id: UUID | null;
    type: StockMovementType;
    previous_quantity: Numeric;
    new_quantity: Numeric;
    change: Numeric;
    reference_id: UUID | null;
    reference_type: string | null;
    staff_id: UUID | null;
    staff_name: string | null;
    created_at: Timestamptz;
}

export interface InventoryReconciliation {
    id: UUID;
    tenant_id: UUID;
    branch_id: UUID | null;
    item_id: UUID;
    item_name: string;
    previous_quantity: Numeric;
    actual_quantity: Numeric;
    difference: Numeric;
    reason: string;
    staff_id: UUID | null;
    staff_name: string | null;
    created_at: Timestamptz;
}

export interface PurchaseOrder {
    id: UUID;
    tenant_id: UUID;
    branch_id: UUID | null;
    supplier_id: UUID;
    po_number: string;
    total_amount: Numeric;
    paid_amount: Numeric;
    remaining_amount: Numeric;
    status: PurchaseOrderStatus;
    order_type: 'purchase' | 'return';
    order_date: Timestamptz;
    expected_date: Timestamptz | null;
    received_date: Timestamptz | null;
    notes: string | null;
    created_by: UUID | null;
    created_at: Timestamptz;
    updated_at: Timestamptz;
}

export interface PurchaseOrderItem {
    id: UUID;
    tenant_id: UUID;
    purchase_order_id: UUID;
    item_id: UUID | null;
    name: string;
    quantity: Numeric;
    unit: InventoryUnit;
    conversion_rate: Numeric;
    base_quantity: Numeric;
    price_per_unit: Numeric;
    total: Numeric;
}

export interface PurchaseReturn {
    id: UUID;
    tenant_id: UUID;
    purchase_order_id: UUID;
    supplier_id: UUID;
    branch_id: UUID | null;
    return_number: string;
    total_amount: Numeric;
    reason: string | null;
    return_date: Timestamptz;
    created_by: UUID | null;
    created_at: Timestamptz;
}

export interface PurchaseReturnItem {
    id: UUID;
    tenant_id: UUID;
    purchase_return_id: UUID;
    item_id: UUID | null;
    name: string;
    quantity: Numeric;
    unit: InventoryUnit;
    conversion_rate: Numeric;
    base_quantity: Numeric;
    price_per_unit: Numeric;
    total: Numeric;
}

export interface Shift {
    id: UUID;
    tenant_id: UUID;
    branch_id: UUID | null;
    staff_id: UUID;
    staff_name: string;
    opening_balance: Numeric;
    closing_balance: Numeric | null;
    actual_cash: Numeric | null;
    expected_cash: Numeric | null;
    discrepancy: Numeric | null;
    discrepancy_reason: string | null;
    totals: ShiftTotals;
    status: ShiftStatus;
    notes: string | null;
    start_time: Timestamptz;
    end_time: Timestamptz | null;
    created_at: Timestamptz;
    updated_at: Timestamptz;
}

export interface ShiftEntry {
    id: UUID;
    tenant_id: UUID;
    shift_id: UUID;
    entry_type: ShiftEntryType;
    amount: Numeric;
    reason: string;
    occurred_at: Timestamptz;
    created_by: UUID | null;
    created_at: Timestamptz;
}

export interface Order {
    id: UUID;
    tenant_id: UUID;
    branch_id: UUID | null;
    shift_id: UUID | null;
    customer_id: UUID | null;
    customer_name: string;
    order_number: number;
    status: OrderStatus;
    payment_method: PaymentMethod;
    total_amount: Numeric;
    paid_amount: Numeric;
    remaining_amount: Numeric;
    tax_rate: Numeric;
    tax_amount: Numeric;
    discount_amount: Numeric;
    order_date: Timestamptz;
    delivery_date: Timestamptz;
    qr_code: string | null;
    images: ImageRef[];
    notes: string | null;
    created_by: UUID | null;
    is_test: boolean;
    created_at: Timestamptz;
    updated_at: Timestamptz;
}

export interface OrderItem {
    id: UUID;
    tenant_id: UUID;
    order_id: UUID;
    type: OrderItemType;
    status: OrderStatus | null;
    item_id: UUID | null;
    variant_id: UUID | null;
    name: string | null;
    image: string | null;
    garment_type: string | null;
    fabric: string | null;
    fabric_id: UUID | null;
    quantity: Numeric;
    selected_unit: InventoryUnit | null;
    consumed_meters: Numeric | null;
    price: Numeric;
    closure_type: ClosureType | null;
    closure_visibility: ClosureVisibility | null;
    collar_type: string | null;
    cuff_type: string | null;
    pocket_type: string | null;
    chest_style: string | null;
    collar_padding: CollarPadding | null;
    additions: string | null;
    embroidery: string | null;
    measurements: Measurements;
    created_at: Timestamptz;
}

export interface OrderHistoryEntry {
    id: number;
    tenant_id: UUID;
    order_id: UUID;
    status: OrderStatus;
    notes: string | null;
    updated_by_staff: UUID | null;
    updated_by_uid: UserId | null;
    updated_by_name: string | null;
    updated_at: Timestamptz;
}

export interface Payment {
    id: UUID;
    tenant_id: UUID;
    order_id: UUID | null;
    invoice_id: UUID | null;
    shift_id: UUID | null;
    amount: Numeric;
    method: PaymentMethod;
    reference: string | null;
    received_by: UUID | null;
    received_at: Timestamptz;
    notes: string | null;
}

export interface TaxInvoice {
    id: UUID;
    tenant_id: UUID;
    order_id: UUID | null;
    invoice_number: string;
    invoice_type: InvoiceType;
    reference_invoice_id: UUID | null;
    issued_at: Timestamptz;
    status: InvoiceStatus;
    customer_id: UUID | null;
    customer_name: string | null;
    subtotal: Numeric;
    tax_rate: Numeric;
    tax_amount: Numeric;
    discount_amount: Numeric;
    total_amount: Numeric;
    paid_amount: Numeric;
    qr_payload: string | null;
    vat_number: string | null;
    pdf_url: string | null;
    notes: string | null;
    created_at: Timestamptz;
    updated_at: Timestamptz;
}

export interface SalesReturn {
    id: UUID;
    tenant_id: UUID;
    invoice_id: UUID;
    order_id: UUID | null;
    return_number: string;
    status: SalesReturnStatus;
    reason: string | null;
    total_amount: Numeric;
    refunded_amount: Numeric;
    refund_method: PaymentMethod | null;
    processed_by: UUID | null;
    returned_at: Timestamptz;
    created_at: Timestamptz;
}

export interface SalesReturnItem {
    id: UUID;
    tenant_id: UUID;
    return_id: UUID;
    order_item_id: UUID | null;
    item_id: UUID | null;
    name: string;
    quantity: Numeric;
    unit_price: Numeric;
    total: Numeric;
}

export interface AppNotification {
    id: UUID;
    tenant_id: UUID;
    title: string;
    message: string;
    type: NotificationType;
    status: NotificationStatus;
    target_staff: UUID | null;
    metadata: Record<string, unknown>;
    is_test: boolean;
    created_at: Timestamptz;
    read_at: Timestamptz | null;
}

export interface EmployeeActivityLog {
    id: number;
    tenant_id: UUID;
    staff_id: UUID | null;
    staff_name: string | null;
    branch_id: UUID | null;
    branch_name: string | null;
    action: string;
    details: string | null;
    previous_value: unknown | null;
    new_value: unknown | null;
    ip_address: Inet | null;
    user_agent: string | null;
    occurred_at: Timestamptz;
}

export interface AuditLog {
    id: number;
    tenant_id: UUID | null;
    target_tenant_id: UUID | null;
    action: string;
    performed_by: UserId | null;
    performed_by_email: string | null;
    details: string | null;
    type: AuditLogType;
    metadata: Record<string, unknown>;
    occurred_at: Timestamptz;
}

export interface SecurityLog {
    id: number;
    tenant_id: UUID;
    staff_id: UUID | null;
    uid: UserId | null;
    action: string;
    permission: string | null;
    module: string | null;
    ip_address: Inet | null;
    user_agent: string | null;
    occurred_at: Timestamptz;
}

export type TablesMap = {
    users: User;
    plans: Plan;
    tenants: Tenant;
    saas_users: SaasUser;
    saas_settings: SaasSetting;
    saas_security_logs: SaasSecurityLog;
    tailor_requests: TailorRequest;
    branches: Branch;
    roles: Role;
    staff: Staff;
    user_permission_overrides: UserPermissionOverride;
    customers: Customer;
    suppliers: Supplier;
    inventory_items: InventoryItem;
    inventory_variants: InventoryVariant;
    branch_inventory: BranchInventory;
    stock_transfers: StockTransfer;
    stock_transfer_items: StockTransferItem;
    stock_ledger: StockLedgerEntry;
    inventory_reconciliations: InventoryReconciliation;
    purchase_orders: PurchaseOrder;
    purchase_order_items: PurchaseOrderItem;
    purchase_returns: PurchaseReturn;
    purchase_return_items: PurchaseReturnItem;
    shifts: Shift;
    shift_entries: ShiftEntry;
    orders: Order;
    order_items: OrderItem;
    order_history: OrderHistoryEntry;
    payments: Payment;
    tax_invoices: TaxInvoice;
    sales_returns: SalesReturn;
    sales_return_items: SalesReturnItem;
    notifications: AppNotification;
    employee_activity_logs: EmployeeActivityLog;
    audit_logs: AuditLog;
    security_logs: SecurityLog;
};

export type Database = {
    public: {
        Tables: {
            [K in keyof TablesMap]: {
                Row: TablesMap[K];
                Insert: Partial<TablesMap[K]>;
                Update: Partial<TablesMap[K]>;
            };
        };
        Views: {
            [_ in never]: never
        };
        Functions: {
            [_ in never]: never
        };
        Enums: {
            [_ in never]: never
        };
        CompositeTypes: {
            [_ in never]: never
        };
    };
}
