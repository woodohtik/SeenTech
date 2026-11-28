import { VERTICAL_SHOPS } from './shops';

const q = (v: string | number | boolean | null) =>
  v === null ? 'NULL' : typeof v === 'string' ? `'${v.replace(/'/g, "''")}'` : String(v);

/** The old inventory_category enum value for a vertical's category key (as supabase/seed/verticals_test_shops.sql). */
const legacyCategory = (key: string) =>
  ['fabric', 'thread', 'button', 'lining', 'accessories', 'ready_made', 'other'].includes(key) ? key : 'other';

/**
 * The SQL (inside seed.ts's one transaction, triggers set aside) for the
 * vertical test shops: shop, main branch, the vertical's categories, an
 * owner, a customer, a length item and a piece item in stock, and -- where
 * the vertical has orders -- one order at its first stage.
 */
export function verticalShopsSql(ownerUid: Record<string, string>): string {
  return VERTICAL_SHOPS.map((s) => `
DELETE FROM public.tenants WHERE id = ${q(s.tenantId)};
INSERT INTO public.users (id, email, display_name) VALUES (${q(ownerUid[s.ownerEmail])}, ${q(s.ownerEmail)}, 'المالك')
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
INSERT INTO public.tenants (id, name, owner_email, owner_uid, phone, status, subscription_status, is_test, vertical, vat_number, is_tax_enabled, default_tax_rate)
  VALUES (${q(s.tenantId)}, ${q(s.name)}, ${q(s.ownerEmail)}, ${q(ownerUid[s.ownerEmail])}, '0500000000', 'active', 'active', true, ${q(s.vertical)}, '310000000000003', true, 15);
INSERT INTO public.branches (id, tenant_id, name, location, is_main) VALUES (${q(s.branchId)}, ${q(s.tenantId)}, 'الفرع الرئيسي', 'الرياض', true);
INSERT INTO public.tenant_categories (tenant_id, scope, category_key, label_ar, display_order, is_custom, measure_kind)
  SELECT ${q(s.tenantId)}, 'inventory', c.category_key, c.label_ar, row_number() OVER (ORDER BY c.sort) - 1, false, c.measure_kind
    FROM public.vertical_inventory_categories c WHERE c.vertical_key = ${q(s.vertical)};
INSERT INTO public.staff (id, tenant_id, uid, name, email, role, status, branch_id, must_change_pin)
  VALUES (${q(s.ownerStaffId)}, ${q(s.tenantId)}, ${q(ownerUid[s.ownerEmail])}, 'المالك', ${q(s.ownerEmail)}, 'owner', 'active', ${q(s.branchId)}, false);
INSERT INTO public.customers (id, tenant_id, name, phone) VALUES (${q(s.customer.id)}, ${q(s.tenantId)}, ${q(s.customer.name)}, ${q(s.customer.phone)});
INSERT INTO public.inventory_items (id, tenant_id, name, sku, category, category_key, unit, base_unit, conversion_rate, price_per_unit, min_threshold) VALUES
  (${q(s.lengthItem.id)}, ${q(s.tenantId)}, ${q(s.lengthItem.name)}, ${q(`GV-${s.vertical}-L`)}, ${q(legacyCategory(s.lengthItem.categoryKey))}, ${q(s.lengthItem.categoryKey)}, 'meter', 'meter', 1, ${s.lengthItem.price}, 0),
  (${q(s.pieceItem.id)}, ${q(s.tenantId)}, ${q(s.pieceItem.name)}, ${q(`GV-${s.vertical}-P`)}, ${q(legacyCategory(s.pieceItem.categoryKey))}, ${q(s.pieceItem.categoryKey)}, 'piece', 'piece', 1, ${s.pieceItem.price}, 0);
INSERT INTO public.branch_inventory (tenant_id, branch_id, item_id, quantity) VALUES
  (${q(s.tenantId)}, ${q(s.branchId)}, ${q(s.lengthItem.id)}, ${s.lengthItem.stock}),
  (${q(s.tenantId)}, ${q(s.branchId)}, ${q(s.pieceItem.id)}, ${s.pieceItem.stock});
${s.order ? `INSERT INTO public.orders (id, tenant_id, customer_id, customer_name, order_number, delivery_date, total_amount, paid_amount, status, status_key, kind, branch_id, created_by)
  SELECT ${q(s.order.id)}, ${q(s.tenantId)}, ${q(s.customer.id)}, ${q(s.customer.name)}, ${s.order.number}, now() + interval '9 days', 115, 115,
         (COALESCE(st.legacy_status::text, 'measurements_taken'))::public.order_status, ${q(s.order.firstStage)}, 'tailoring', ${q(s.branchId)}, ${q(s.ownerStaffId)}
    FROM (SELECT legacy_status FROM public.vertical_workflow_stages WHERE vertical_key = ${q(s.vertical)} AND stage_key = ${q(s.order.firstStage)}) st;` : ''}
`).join('\n');
}
