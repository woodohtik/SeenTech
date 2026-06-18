/**
 * verticalService — قراءة طبقة المجال من الـconfig بدل القيم الثابتة (enums).
 * يجعل الواجهة تتكيّف مع نشاط المحل (رجالي/نسائي/أثاث) بلا كود لكل نشاط.
 * SQL: MIGRATION_extensibility_stage1.sql + stage2.sql.
 */

import { supabase } from '../lib/supabase/client';
import type {
  Vertical, WorkflowStage, FieldSchema, InventoryCategoryConfig, ModuleKey, VerticalKey,
} from '../types/expansion';

export const DEFAULT_VERTICAL: VerticalKey = 'mens_tailoring';
export const DEFAULT_MODULES: ModuleKey[] = ['pos', 'orders', 'inventory', 'invoicing', 'customers'];

/** قائمة الأنشطة المتاحة (للـonboarding واختيار النشاط). */
export async function listVerticals(): Promise<Vertical[]> {
  const { data } = await supabase.from('verticals').select('*').eq('is_active', true).order('sort');
  return (data || []) as Vertical[];
}

/** نشاط المحل + موديولاته المفعّلة (مع رجوع آمن للافتراضات). */
export async function getTenantVertical(tenantId: string): Promise<{ vertical: VerticalKey; modules: ModuleKey[] }> {
  const { data } = await supabase.from('tenants').select('vertical, enabled_modules').eq('id', tenantId).maybeSingle();
  return {
    vertical: (data?.vertical as VerticalKey) || DEFAULT_VERTICAL,
    modules: (data?.enabled_modules as ModuleKey[]) || DEFAULT_MODULES,
  };
}

/** هل موديول مفعّل لهذا المحل؟ (لإظهار/إخفاء أقسام الواجهة). */
export function isModuleEnabled(modules: ModuleKey[], key: ModuleKey): boolean {
  return Array.isArray(modules) && modules.includes(key);
}

/** مراحل العمل لنشاط معيّن (مرتّبة) — تُستخدم بدل enum order_status. */
export async function getWorkflowStages(vertical: VerticalKey): Promise<WorkflowStage[]> {
  const { data } = await supabase.from('vertical_workflow_stages').select('*').eq('vertical_key', vertical).order('sort');
  return (data || []) as WorkflowStage[];
}

/** schema حقول التخصيص لنشاط معيّن (لبناء النموذج ديناميكياً). */
export async function getFieldSchemas(
  vertical: VerticalKey, appliesTo: FieldSchema['applies_to'] = 'order_item',
): Promise<FieldSchema[]> {
  const { data } = await supabase.from('vertical_field_schemas')
    .select('*').eq('vertical_key', vertical).eq('applies_to', appliesTo).order('sort');
  return (data || []).map((r: any) => ({
    ...r, options: typeof r.options === 'string' ? safeParse(r.options) : r.options,
  })) as FieldSchema[];
}

/** فئات المخزون لنشاط معيّن — تُستخدم بدل enum inventory_category. */
export async function getInventoryCategories(vertical: VerticalKey): Promise<InventoryCategoryConfig[]> {
  const { data } = await supabase.from('vertical_inventory_categories').select('*').eq('vertical_key', vertical).order('sort');
  return (data || []) as InventoryCategoryConfig[];
}

function safeParse(s: string): any { try { return JSON.parse(s); } catch { return null; } }
