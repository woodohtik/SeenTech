export interface ThobeMeasurements {
  collar: number;
  chest: number;
  shoulders: number;
  sleeves: number;
  length: number;
  bottomWidth: number;
}

export interface Measurements {
  length?: number;
  shoulder?: number;
  chest?: number;
  waist?: number;
  hips?: number;
  sleeve?: number;
  neck?: number;
  // Visual/Sector specific fields
  collarType?: string; // الياقة
  cuffType?: string;   // الكبك
  pocketType?: string; // الجيب
  chestStyle?: string; // الصدر
  shoulderStyle?: string; // الكتف
  thobeMeasurements?: ThobeMeasurements;
  // New fields for customization
  closureType?: 'zipper' | 'buttons'; // سحاب/أزرار
  closureVisibility?: 'hidden' | 'visible'; // مخفي/ظاهر
}

export interface Styles {
  neckShape?: 'round' | 'v-neck' | 'square';
  sleeveStyle?: 'normal' | 'cuff' | 'wide';
  pocketType?: 'none' | 'single' | 'double';
  address?: string;
  city?: string;
  latitude?: string | number;
  longitude?: string | number;
}

export interface TaxSettings {
  enabled: boolean;
  trn: string;
  legalName: string;
  vatRate: number;
}

export interface Tenant {
  id: string;
  customerId?: string;
  name: string;
  ownerEmail: string;
  phone: string;
  address?: string;
  vatNumber?: string;
  commercialRegister?: string;
  status: 'active' | 'inactive' | 'pending' | 'suspended' | 'onboarding';
  planId: string;
  inventoryStrategy: 'centralized' | 'decentralized';
  createdAt: string;
  logoUrl?: string;
  defaultLayout?: 'sidebar' | 'grid';
  isTest?: boolean; // For deleting test data
  taxSettings?: TaxSettings;
  currencySymbol?: string;
}

export interface SaaSMetrics {
  mrr: number;
  arr: number;
  churnRate: number;
  totalTenants: number;
  activeTenants: number;
  totalRevenue: number;
  updatedAt: string;
}

export interface Plan {
  id: string;
  name: string;
  price: number;
  features: string[];
  maxStaff: number;
  maxOrders: number;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  measurements: Measurements;
  styles?: Styles;
  notes?: string;
  tenantId: string;
  isTest?: boolean;
  createdAt: string;
  companyName?: string; // For B2B
  trn?: string; // For B2B
  isB2B?: boolean;
}

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

export interface ShiftPayout {
  id: string;
  amount: number;
  reason: string;
  time: string;
}

export interface ShiftDeposit {
  id: string;
  amount: number;
  reason: string;
  time: string;
}

export interface ShiftTotals {
  cash: number;
  card: number;
  bank_transfer: number;
  credit: number;
  cashReturns: number;
  totalReturns: number;
  returnCount: number;
  expenses: number;
  totalDeposits: number;
  taxes: number;
  totalSales: number;
  grossSales: number;
  discounts: number;
}

export interface Shift {
  id: string;
  tenantId: string;
  staffId: string;
  staffName: string;
  openingBalance: number;
  closingBalance?: number;
  actualCash?: number;
  expectedCash?: number;
  discrepancy?: number;
  discrepancyReason?: string;
  payouts?: ShiftPayout[];
  deposits?: ShiftDeposit[];
  totals?: ShiftTotals;
  startTime: string;
  endTime?: string;
  status: 'open' | 'closed';
  notes?: string;
}

export type PermissionKey = 
  | 'customers.view' | 'customers.create' | 'customers.edit' | 'customers.delete'
  | 'orders.view' | 'orders.create' | 'orders.edit' | 'orders.delete'
  | 'inventory.view' | 'inventory.create' | 'inventory.edit' | 'inventory.delete' | 'inventory.reconcile'
  | 'inventory.transfer' | 'inventory.receive'
  | 'branches.view' | 'branches.manage'
  | 'staff.view' | 'staff.create' | 'staff.edit' | 'staff.delete' | 'staff.manage' | 'staff.permissions'
  | 'reports.view' | 'reports.export'
  | 'settings.view' | 'settings.edit' | 'settings.tax' | 'settings.whatsapp' | 'settings.billing' | 'settings.notifications' | 'settings.manage'
  | 'dashboard.view' | 'dashboard.revenue' | 'dashboard.orders' | 'dashboard.inventory' | 'dashboard.customers'
  | 'shifts.view' | 'shifts.manage'
  | 'action.refund'
  | 'action.discount'
  | 'suppliers.manage';

export type PermissionsMap = Record<PermissionKey, boolean>;

export interface Role {
  id: string;
  tenantId: string;
  roleKey: string;
  name: string;
  description: string;
  permissions: PermissionsMap;
  isDefault: boolean;
  createdAt: string;
}

export interface UserPermissionOverride {
  id: string; // staffId
  tenantId: string;
  overrides: Partial<PermissionsMap>;
  updatedAt: string;
}

export interface Staff {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: UserRole;
  status: 'active' | 'inactive';
  pin?: string;
  mustChangePin?: boolean;
  tenantId: string;
  branchId?: string; // Linked to a specific branch
  isTest?: boolean;
  createdAt: string;
}

export interface Branch {
  id: string;
  name: string;
  location: string;
  phone: string;
  type: 'warehouse' | 'store';
  tenantId: string;
  isMain?: boolean; // Master Warehouse
  createdAt: string;
}

export interface Supplier {
  id: string;
  name: string;
  contactPerson: string;
  email: string;
  phone: string;
  address: string;
  taxNumber?: string;
  category: string;
  balance: number; // Outstanding debt
  tenantId: string;
  isTest?: boolean;
  createdAt: string;
}

export interface PurchaseOrderItem {
  itemId: string;
  name: string;
  quantity: number; // in bulk unit
  unit: string;
  conversionRate: number;
  baseQuantity: number; // quantity * conversionRate
  pricePerUnit: number; // price per bulk unit
  total: number;
}

export interface PurchaseOrder {
  id: string;
  supplierId: string;
  supplierName: string;
  tenantId: string;
  branchId: string;
  items: PurchaseOrderItem[];
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  status: 'draft' | 'confirmed' | 'sent' | 'received' | 'returned';
  orderType: 'purchase' | 'return';
  poNumber?: string;
  po_number?: string;
  orderDate: string;
  expectedDate?: string;
  receivedDate?: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseReturn {
  id: string;
  purchaseOrderId: string;
  supplierId: string;
  tenantId: string;
  branchId: string;
  items: PurchaseOrderItem[];
  totalAmount: number;
  reason: string;
  returnDate: string;
  createdBy: string;
  createdAt: string;
}

export interface InventoryVariant {
  id: string;
  sku: string;
  barcode: string;
  name: string; // e.g., "White", "Large"
  options: Record<string, string>; // e.g., { color: "White", size: "L" }
  priceAdjustment?: number;
  updatedAt: string;
}

export type ProductTaxType = 'inclusive' | 'exclusive' | 'exempt';

export interface InventoryItem {
  id: string;
  name: string;
  nameEn?: string; // English name for bilingual invoices
  description?: string;
  category: 'fabric' | 'thread' | 'button' | 'lining' | 'accessories' | 'ready-made' | 'other';
  unit: 'meter' | 'yard' | 'roll' | 'bolt' | 'piece' | 'spool' | 'box';
  baseUnit: 'meter' | 'piece'; // The normalized unit
  conversionRate: number; // How many baseUnits per unit (e.g., 1 yard = 0.9144 meters)
  minThreshold: number;
  pricePerUnit: number; // For 'exclusive' this is base price. For 'inclusive' it includes tax.
  taxType: ProductTaxType;
  supplierId?: string;
  tenantId: string;
  sku: string;
  barcode: string;
  quantity: number; // Total quantity across all branches, or central warehouse quantity
  images?: string[];
  mainImage?: string; // Primary image for displays
  // Style properties for ready-made garments
  collarType?: string;
  cuffType?: string;
  pocketType?: string;
  chestStyle?: string;
  isTest?: boolean;
  showInPos?: boolean;
  openingBalance?: number;
  updatedAt: string;
}

export interface BranchInventory {
  id: string; // branchId_itemId
  branchId: string;
  itemId: string;
  quantity: number;
  tenantId: string;
  updatedAt: string;
}

export type TransferStatus = 'draft' | 'pending' | 'in_transit' | 'completed' | 'rejected' | 'cancelled';

export interface StockTransfer {
  id: string;
  fromBranchId: string;
  toBranchId: string;
  items: {
    itemId: string;
    itemName: string;
    requestedQuantity: number;
    shippedQuantity?: number;
    receivedQuantity?: number;
  }[];
  status: TransferStatus;
  requestedBy: string; // staffId
  requestedByName: string;
  shippedBy?: string;
  receivedBy?: string;
  notes?: string;
  remarks?: string;
  tenantId: string;
  createdAt: string;
  shippedAt?: string;
  receivedAt?: string;
  updatedAt: string;
}

export interface StockLedger {
  id: string;
  itemId: string;
  branchId: string;
  type: 'addition' | 'deduction' | 'transfer_in' | 'transfer_out' | 'reconciliation' | 'adjustment' | 'sale';
  previousQuantity: number;
  newQuantity: number;
  change: number;
  referenceId?: string; // orderId or transferId
  staffId: string;
  staffName: string;
  tenantId: string;
  createdAt: string;
}

export interface InventoryReconciliation {
  id: string;
  itemId: string;
  itemName: string;
  previousQuantity: number;
  actualQuantity: number;
  difference: number;
  reason: string;
  staffId: string;
  staffName: string;
  tenantId: string;
  createdAt: string;
}

export interface Tailor {
  id: string;
  name: string;
  phone: string;
  email: string;
  role: UserRole;
  isApproved: boolean;
}

export interface TailorRequest {
  id: string;
  customerId?: string;
  name: string;
  phone: string;
  email: string;
  uid: string;
  status: 'pending' | 'approved' | 'rejected';
  onboardingStep?: number;
  shopName?: string;
  shopPhone?: string;
  address?: string;
  createdAt: string;
}

export interface OrderItem {
  id?: string;
  type: 'custom' | 'ready_made';
  status?: OrderStatus; // For custom items
  
  // Ready-made fields
  itemId?: string; // Reference to InventoryItem
  name?: string;
  nameEn?: string;
  image?: string; // Image URL for the item
  
  // Custom fields
  garmentType?: string;
  fabric?: string;
  fabricId?: string; // Reference to InventoryItem
  
  quantity: number; // Quantity in selected unit
  selectedUnit?: string; // The unit selected by the user (yard, roll, etc.)
  consumedMeters?: number; // Calculated meters (quantity * conversionRate)
  price: number;
  basePrice?: number; // Price without tax
  taxAmount?: number;
  taxType?: ProductTaxType;
  
  // Customization fields
  closureType?: 'zipper' | 'buttons';
  closureVisibility?: 'hidden' | 'visible';
  collarType?: string;
  cuffType?: string;
  pocketType?: string;
  chestStyle?: string;
  collarPadding?: 'hard' | 'soft';
  additions?: string;
  embroidery?: string;
}

export type PaymentMethod = 'cash' | 'network' | 'bank_transfer' | 'cash_on_delivery' | 'partial';

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

export interface OrderHistory {
  status: OrderStatus;
  updatedAt: string;
  updatedBy: string;
  updatedByUid?: string;
  notes?: string;
}

export interface Order {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone?: string;
  tenantId: string;
  branchId?: string;
  shiftId?: string;
  items: OrderItem[];
  subTotalAmount?: number; // Pre-tax amount
  totalAmount: number; // Includes tax
  paidAmount: number;
  discountAmount?: number;
  remainingAmount: number;
  paymentMethod: PaymentMethod;
  status: OrderStatus;
  orderDate: string;
  deliveryDate: string;
  taxAmount?: number;
  taxRate?: number;
  isB2B?: boolean;
  b2bCompanyName?: string;
  b2bTRN?: string;
  createdBy: string;
  notes?: string;
  qrCode?: string;
  images?: string[];
  orderNumber?: number;
  history: OrderHistory[];
  isTest?: boolean;
  updatedAt?: string;
  assignedTo?: string;
}

export interface TaxInvoice {
  id: string;
  invoiceNumber: string;
  orderId: string;
  tenantId: string;
  customerId?: string;
  customerName: string;
  items: OrderItem[];
  subTotal: number;
  taxRate: number;
  taxAmount: number;
  totalAmount: number; // Grand Total
  isB2B: boolean;
  b2bCompanyName?: string;
  b2bTRN?: string;
  sellerName: string;
  sellerTRN: string;
  qrCodeBase64: string; // ZATCA Base64 string
  issuedAt: string;
  createdBy: string;
  status: 'valid' | 'cancelled';
}

export interface CreditNote {
  id: string;
  creditNoteNumber: string;
  originalInvoiceId: string;
  invoiceNumber: string;
  tenantId: string;
  reason: string;
  refundedAmount: number;
  refundedTax: number;
  issuedAt: string;
  createdBy: string;
}

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  type: 'inventory' | 'order' | 'system' | 'alert';
  status: 'unread' | 'read';
  tenantId: string;
  isTest?: boolean;
  createdAt: string;
}

export interface EmployeeActivityLog {
  id: string;
  tenantId: string;
  staffId: string;
  staffName: string;
  branchId?: string;
  branchName?: string;
  action: 'login' | 'open_shift' | 'close_shift' | 'create_invoice' | 'create_credit_note' | 'delete_invoice' | 'edit_measurements' | 'delete_order' | 'add_supplier' | 'adjust_inventory' | 'print_invoice' | 'manual_price_edit' | string;
  details: string;
  previousValue?: any;
  newValue?: any;
  timestamp: string;
}

export interface AuditLog {
  id: string;
  action: string;
  performedBy: string;
  performedByEmail: string;
  targetTenantId?: string;
  details: string;
  timestamp: string;
  type: 'deletion' | 'security' | 'system';
}
