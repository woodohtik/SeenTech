/**
 * categoryService -- فئات المخزون/الموردين القابلة للتخصيص لكل مستأجر
 * (seen-ux-fixes-batch-task.md #9). تحل محل القوائم الثابتة في
 * InventoryManager.tsx و Suppliers.tsx: كل مستأجر يمكنه إضافة فئة، إخفاء
 * فئة لا يحتاجها، وإعادة ترتيب القائمة. العناصر/الموردون الحاليون الذين
 * تحمل صفوفهم فئة مُخفاة لاحقاً يبقون يعملون طبيعياً -- الإخفاء يؤثر فقط
 * على قوائم الاختيار الجديدة، لا على البيانات الموجودة.
 *
 * SQL: supabase/migrations/20261012000000_tenant_categories.sql
 */

import { supabase } from '../lib/supabase/client';

export type CategoryScope = 'inventory' | 'supplier';

export interface TenantCategory {
  id: string;
  tenant_id: string;
  scope: CategoryScope;
  category_key: string;
  label_ar: string;
  display_order: number;
  is_hidden: boolean;
  is_custom: boolean;
}

export interface CategorySeed {
  category_key: string;
  label_ar: string;
}

/** القائمة الثابتة القديمة -- تُستخدم فقط لتبذير الصفوف أول مرة لنشاط mens_tailoring (الافتراضي). */
export const LEGACY_INVENTORY_CATEGORY_SEED: CategorySeed[] = [
  { category_key: 'fabric', label_ar: 'أقمشة' },
  { category_key: 'ready_made', label_ar: 'جاهز' },
  { category_key: 'thread', label_ar: 'خيوط' },
  { category_key: 'button', label_ar: 'أزرار' },
  { category_key: 'lining', label_ar: 'بطانات' },
  { category_key: 'accessories', label_ar: 'إكسسوارات' },
];

/** القائمة الثابتة القديمة لفئات الموردين -- نفس فكرة التبذير أول مرة. */
export const LEGACY_SUPPLIER_CATEGORY_SEED: CategorySeed[] = [
  { category_key: 'fabric', label_ar: 'أقمشة' },
  { category_key: 'accessories', label_ar: 'إكسسوارات' },
  { category_key: 'thread', label_ar: 'خيوط' },
  { category_key: 'button', label_ar: 'أزرار' },
  { category_key: 'lining', label_ar: 'بطانات' },
];

/**
 * يجلب فئات المستأجر لنطاق معيّن، ويبذرها أول مرة من seed (القائمة الثابتة
 * لنشاط mens_tailoring، أو فئات النشاط من vertical_inventory_categories
 * لأي نشاط آخر) إن لم توجد أي صفوف بعد. مرتّبة بـdisplay_order.
 */
export async function listCategories(
  tenantId: string,
  scope: CategoryScope,
  seed: CategorySeed[],
): Promise<TenantCategory[]> {
  const { data, error } = await supabase
    .from('tenant_categories')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('scope', scope)
    .order('display_order');
  if (error) throw error;
  if (data && data.length > 0) return data as TenantCategory[];

  const rows = seed.map((c, i) => ({
    tenant_id: tenantId,
    scope,
    category_key: c.category_key,
    label_ar: c.label_ar,
    display_order: i,
    is_custom: false,
  }));
  const { data: inserted, error: insertError } = await supabase
    .from('tenant_categories')
    .insert(rows)
    .select('*');
  if (insertError) {
    // سباق محتمل: تبذير آخر (تبويب آخر مفتوح لنفس المستأجر) سبقنا -- فقط أعد الجلب.
    const { data: retry } = await supabase
      .from('tenant_categories')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('scope', scope)
      .order('display_order');
    return (retry || []) as TenantCategory[];
  }
  return ((inserted || []) as TenantCategory[]).sort((a, b) => a.display_order - b.display_order);
}

/** فئات ظاهرة فقط (لقوائم الاختيار) -- الفئات المخفاة تبقى في الإدارة فقط. */
export function visibleCategories(categories: TenantCategory[]): TenantCategory[] {
  return categories.filter((c) => !c.is_hidden);
}

function slugify(labelAr: string): string {
  const base = labelAr
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^\p{L}\p{N}_]/gu, '');
  const suffix = Date.now().toString(36);
  return `custom_${base || 'cat'}_${suffix}`;
}

/** يضيف فئة جديدة مخصّصة في آخر القائمة، ويرجع الصف الجديد (لاستخدام category_key فوراً). */
export async function addCategory(
  tenantId: string,
  scope: CategoryScope,
  labelAr: string,
  existing: TenantCategory[],
): Promise<TenantCategory> {
  const nextOrder = existing.length > 0 ? Math.max(...existing.map((c) => c.display_order)) + 1 : 0;
  const { data, error } = await supabase
    .from('tenant_categories')
    .insert({
      tenant_id: tenantId,
      scope,
      category_key: slugify(labelAr),
      label_ar: labelAr.trim(),
      display_order: nextOrder,
      is_custom: true,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as TenantCategory;
}

export async function renameCategory(id: string, labelAr: string): Promise<void> {
  const { error } = await supabase.from('tenant_categories').update({ label_ar: labelAr.trim() }).eq('id', id);
  if (error) throw error;
}

export async function setCategoryHidden(id: string, isHidden: boolean): Promise<void> {
  const { error } = await supabase.from('tenant_categories').update({ is_hidden: isHidden }).eq('id', id);
  if (error) throw error;
}

/** يبدّل ترتيب فئتين متجاورتين (أزرار أعلى/أسفل في واجهة الإدارة). */
export async function swapCategoryOrder(a: TenantCategory, b: TenantCategory): Promise<void> {
  const [{ error: e1 }, { error: e2 }] = await Promise.all([
    supabase.from('tenant_categories').update({ display_order: b.display_order }).eq('id', a.id),
    supabase.from('tenant_categories').update({ display_order: a.display_order }).eq('id', b.id),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
}
