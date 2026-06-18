/**
 * أنواع طبقة التوسّع — الأنشطة (verticals)، الموديولات، الـconfig، والماركت بليس.
 * تُقابل: MIGRATION_extensibility_stage1/2.sql و MARKETPLACE_foundation.sql.
 */

export type VerticalKey = 'mens_tailoring' | 'womens_tailoring' | 'furniture' | string;
export type ModuleKey =
  | 'pos' | 'orders' | 'inventory' | 'invoicing' | 'customers'
  | 'marketplace_b2c' | 'supplier_marketplace' | string;

export interface Vertical { key: VerticalKey; name_ar: string; name_en?: string; is_active: boolean; sort: number; }

export interface WorkflowStage {
  vertical_key: VerticalKey; stage_key: string; label_ar: string; sort: number; is_terminal: boolean;
}

export type FieldType = 'text' | 'number' | 'select' | 'bool';
export interface FieldSchema {
  vertical_key: VerticalKey; field_key: string; label_ar: string;
  field_type: FieldType; options?: string[] | null; applies_to: 'order_item' | 'inventory_item' | 'customer'; sort: number;
}

export interface InventoryCategoryConfig { vertical_key: VerticalKey; category_key: string; label_ar: string; sort: number; }

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
