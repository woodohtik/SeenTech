/**
 * أنواع طبقة التوسّع — الأنشطة (verticals)، الموديولات، الـconfig، والماركت بليس.
 * تُقابل: supabase/migrations/20260910060000_backfill_extensibility_verticals.sql
 * و supabase/legacy-setup/MARKETPLACE_foundation.sql (غير مُفعَّلة حالياً في الواجهة).
 */

export type VerticalKey = 'mens_tailoring' | 'womens_tailoring' | 'furniture' | string;
export type ModuleKey =
  | 'pos' | 'orders' | 'inventory' | 'invoicing' | 'customers'
  | 'marketplace_b2c' | 'supplier_marketplace' | string;

/** ready: open at sign-up; beta: platform admin only; coming_soon: shown as «قريباً», not selectable
 *  (seen-verticals-readiness-task.md Phase 0 -- enforced by a database trigger too). */
export type VerticalReadiness = 'ready' | 'beta' | 'coming_soon';
/**
 * What a vertical can do (verticals.capabilities, seen-verticals-readiness-task.md
 * Phase 1) -- the screens branch on these instead of "men's tailoring or not".
 */
export interface VerticalCapabilities {
  /** Which body-measurement set the orders and customers use; null = none. */
  body_measurements: 'thobe' | 'womens' | null;
  /** Fabric is chosen per order line and deducted at the consuming stage. */
  fabric_consumption: boolean;
  /** Items in a length category are sold by metre / yard / roll. */
  sells_by_length: boolean;
  /** Order lines carry width x depth x height. */
  order_dimensions: boolean;
  /** The shop takes orders at all (a fabric store sells from the POS only). */
  orders_module: boolean;
  /** «خياط» or «فني» for the workshop staff. */
  workshop_term: 'tailor' | 'technician';
  /** «ثوب» or «قطعة» for an order line. */
  item_term: 'thobe' | 'piece';
}

export interface Vertical {
  key: VerticalKey; name_ar: string; name_en?: string; name_ur?: string | null; is_active: boolean; sort: number;
  readiness?: VerticalReadiness; capabilities?: VerticalCapabilities | null;
}

/** Where an order stands, whatever the vertical calls the stage. */
export type OrderPhase = 'received' | 'in_progress' | 'ready' | 'delivered' | 'cancelled';

export interface WorkflowStage {
  vertical_key: VerticalKey; stage_key: string; label_ar: string; sort: number; is_terminal: boolean;
  /** Phase 1 columns (absent on a database before 20261231000001). */
  phase?: OrderPhase;
  /** The order_status enum value this stage writes to orders.status. */
  legacy_status?: string;
  /** Material (fabric) is deducted when an order reaches this stage. */
  consumes_materials?: boolean;
  label_en?: string | null;
  label_ur?: string | null;
}

export type FieldType = 'text' | 'number' | 'select' | 'bool';
export interface FieldSchema {
  vertical_key: VerticalKey; field_key: string; label_ar: string;
  field_type: FieldType; options?: string[] | null; applies_to: 'order_item' | 'inventory_item' | 'customer'; sort: number;
  label_en?: string | null;
  label_ur?: string | null;
  /** Translations of `options`, same order; the stored value stays Arabic. */
  options_i18n?: { en?: string[]; ur?: string[] } | null;
}

export type MeasureKind = 'length' | 'count';
export interface InventoryCategoryConfig {
  vertical_key: VerticalKey; category_key: string; label_ar: string; sort: number;
  label_en?: string | null;
  label_ur?: string | null;
  measure_kind?: MeasureKind;
}

// ---------- الماركت بليس ----------
export type ListingStatus = 'draft' | 'published' | 'paused' | 'archived';
export type MpOrderStatus = 'pending' | 'confirmed' | 'preparing' | 'shipped' | 'delivered' | 'cancelled' | 'refunded';
export type SupplierOrderStatus = 'rfq' | 'quoted' | 'accepted' | 'fulfilled' | 'cancelled';

export interface Buyer { id: string; uid: string; name?: string; phone?: string; email?: string; default_address?: any; }
export interface Listing {
  id: string; tenant_id: string; vertical_key?: VerticalKey; title: string; description?: string;
  price: number; currency: string; images: string[]; attributes: Record<string, any>;
  inventory_item_id?: string | null; status: ListingStatus; is_custom_order: boolean;
}
export interface MarketplaceOrder {
  id: string; buyer_id: string; tenant_id: string; status: MpOrderStatus;
  total_amount: number; currency: string; ship_address?: any; linked_order_id?: string | null; placed_at: string;
}
export interface SupplierAccount {
  id: string; uid: string; company_name: string; contact_person?: string; phone?: string; email?: string;
  tax_number?: string; categories: string[]; is_verified: boolean; is_active: boolean;
}
export interface SupplierListing {
  id: string; supplier_id: string; title: string; category_key?: string; unit?: string;
  price: number; moq: number; images: string[]; attributes: Record<string, any>; status: ListingStatus;
}
export interface SupplierOrder {
  id: string; tenant_id: string; supplier_id: string; status: SupplierOrderStatus;
  total_amount: number; currency: string; notes?: string; linked_purchase_order_id?: string | null;
}
