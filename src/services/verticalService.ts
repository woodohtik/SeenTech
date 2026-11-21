/**
 * verticalService — قراءة طبقة المجال من الـconfig بدل القيم الثابتة (enums).
 * يجعل الواجهة تتكيّف مع نشاط المحل (رجالي/نسائي/أثاث) بلا كود لكل نشاط.
 * SQL: supabase/migrations/20260910060000_backfill_extensibility_verticals.sql
 * (original one-time setup archived at supabase/legacy-setup/MIGRATION_extensibility_stage1.sql + stage2.sql).
 */

import { supabase } from '../lib/supabase/client';
import { readTenantRow } from '../lib/tenantRow';
import type {
  Vertical, WorkflowStage, FieldSchema, InventoryCategoryConfig, ModuleKey, VerticalKey, VerticalCapabilities, OrderPhase,
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
  const { data, error } = await readTenantRow(tenantId); // shared read (lib/tenantRow)
  // Unreadable is not "men's tailoring": the caller decides (useVerticalConfig
  // keeps the shop's saved settings instead -- task file bug 6).
  if (error || !data) throw error || new Error('tenant row not found');
  return {
    vertical: (data?.vertical as VerticalKey) || DEFAULT_VERTICAL,
    modules: (data?.enabled_modules as ModuleKey[]) || DEFAULT_MODULES,
  };
}

/**
 * The shop's modules: tenants.enabled_modules (all of them by default),
 * narrowed by its activity -- an activity that takes no orders (a fabric
 * store) has no orders module (seen-verticals-readiness-task.md Phase 6).
 */
export function effectiveModules(stored: ModuleKey[] | null | undefined, capabilities: Pick<VerticalCapabilities, 'orders_module'>): ModuleKey[] {
  const base = Array.isArray(stored) && stored.length > 0 ? stored : DEFAULT_MODULES;
  return capabilities.orders_module === false ? base.filter((m) => m !== 'orders') : base;
}

/** True when the orders module is on, or while the shop's modules are not known yet (nothing hidden while loading). */
export function isOrdersModuleOn(modules: ModuleKey[]): boolean {
  return modules.length === 0 || modules.includes('orders');
}

/** هل موديول مفعّل لهذا المحل؟ (لإظهار/إخفاء أقسام الواجهة). */
export function isModuleEnabled(modules: ModuleKey[], key: ModuleKey): boolean {
  return Array.isArray(modules) && modules.includes(key);
}

/**
 * The men's-tailoring capabilities: what the app always did. Used for a
 * database before 20261231000001 (no capabilities column yet).
 */
export const MENS_CAPABILITIES: VerticalCapabilities = {
  body_measurements: 'thobe', fabric_consumption: true, sells_by_length: true, order_dimensions: false,
  orders_module: true, workshop_term: 'tailor', item_term: 'thobe',
};

/**
 * A vertical's row (names + capabilities). Throws when it cannot be read, so
 * useVerticalConfig can tell "no connection" from "no data" (it used to fall
 * back to men's tailoring silently -- seen-verticals-readiness-task.md bug 6).
 */
export async function getVertical(vertical: VerticalKey): Promise<Vertical | null> {
  const { data, error } = await supabase.from('verticals').select('*').eq('key', vertical).maybeSingle();
  if (error) throw error;
  return (data as Vertical) || null;
}

/** مراحل العمل لنشاط معيّن (مرتّبة) — تُستخدم بدل enum order_status. Throws when unreadable. */
export async function getWorkflowStages(vertical: VerticalKey): Promise<WorkflowStage[]> {
  const { data, error } = await supabase.from('vertical_workflow_stages').select('*').eq('vertical_key', vertical).order('sort');
  if (error) throw error;
  return (data || []) as WorkflowStage[];
}

/** schema حقول التخصيص لنشاط معيّن (لبناء النموذج ديناميكياً). */
export async function getFieldSchemas(
  vertical: VerticalKey, appliesTo: FieldSchema['applies_to'] = 'order_item',
): Promise<FieldSchema[]> {
  const { data, error } = await supabase.from('vertical_field_schemas')
    .select('*').eq('vertical_key', vertical).eq('applies_to', appliesTo).order('sort');
  if (error) throw error;
  return (data || []).map((r: any) => ({
    ...r, options: typeof r.options === 'string' ? safeParse(r.options) : r.options,
  })) as FieldSchema[];
}

/** فئات المخزون لنشاط معيّن — تُستخدم بدل enum inventory_category. */
export async function getInventoryCategories(vertical: VerticalKey): Promise<InventoryCategoryConfig[]> {
  const { data, error } = await supabase.from('vertical_inventory_categories').select('*').eq('vertical_key', vertical).order('sort');
  if (error) throw error;
  return (data || []) as InventoryCategoryConfig[];
}

function safeParse(s: string): any { try { return JSON.parse(s); } catch { return null; } }

// The label helpers live in a module with no database client (pure code such
// as the dashboard calculation imports them); re-exported here for callers.
export { localizedLabel, localizedVerticalName, localizedOptions } from '../utils/verticalLabels';

/** The phase of a stage key in a vertical's stages (null when unknown or on an older database). */
export function stagePhase(stageKey: string | null | undefined, stages: WorkflowStage[]): OrderPhase | null {
  if (!stageKey) return null;
  return stages.find((s) => s.stage_key === stageKey)?.phase ?? null;
}

// -----------------------------------------------------------------------------
// توافق عكسي: orders.status و inventory_items.category أعمدة enum حقيقية في
// Postgres (order_status / inventory_category) بقائمة قيم ثابتة — لا يمكن
// كتابة أي stage_key/category_key جديد فيها مباشرة (سيفشل الاستعلام). كل مكان
// يكتب الحالة/الفئة الجديدة في status_key/category_key (نص حر) يجب أيضًا أن
// يكتب قيمة enum-صالحة في العمود القديم عبر هاتين الدالتين، حتى لا تنكسر أي
// تقارير/استعلامات قديمة تعتمد عليه (mens_tailoring/womens_tailoring تُطابقان
// قيم الـenum تمامًا فتُعاد كما هي؛ أي stage/فئة جديدة كليًا من نشاط جديد
// تُصنَّف لأقرب دلو عام بدل رفض الكتابة بخطأ).
const ORDER_STATUS_ENUM = new Set([
  'measurements_taken', 'cutting', 'sewing', 'embroidery', 'ironing_packaging',
  'ready', 'partial_delivered', 'delivered', 'cancelled',
]);
const INVENTORY_CATEGORY_ENUM = new Set([
  'fabric', 'thread', 'button', 'lining', 'accessories', 'ready_made', 'other',
]);

/**
 * The order_status value for a stage key when the stage's own legacy_status is
 * not known (a database before 20261231000001). An enum stage key is itself;
 * any other is "received" -- never 'ready' any more: a sofa at design approval
 * used to be stored as ready (seen-verticals-readiness-task.md bug 1).
 */
export function mapStageKeyToLegacyStatus(stageKey: string, isTerminal: boolean): string {
  if (ORDER_STATUS_ENUM.has(stageKey)) return stageKey;
  return isTerminal ? 'delivered' : 'measurements_taken';
}

/** يحوّل category_key (حر) إلى أقرب قيمة صالحة لعمود inventory_items.category القديم. */
export function mapCategoryKeyToLegacyCategory(categoryKey: string): string {
  return INVENTORY_CATEGORY_ENUM.has(categoryKey) ? categoryKey : 'other';
}

/**
 * نفس mapStageKeyToLegacyStatus لكن تبحث بنفسها عن is_terminal داخل workflowStages
 * (مصدرها useVerticalConfig) بدل أن يمرّرها الطرف المستدعي يدوياً في كل مكان يكتب فيه
 * orders.status/order_items.status.
 */
export function legacyOrderStatusFor(stageKey: string, workflowStages: WorkflowStage[]): string {
  const stage = workflowStages.find((s) => s.stage_key === stageKey);
  // The stage says which status it writes (Phase 1); men's stages are the enum itself.
  if (stage?.legacy_status) return stage.legacy_status;
  if (ORDER_STATUS_ENUM.has(stageKey)) return stageKey;
  if (stage) return mapStageKeyToLegacyStatus(stageKey, stage.is_terminal);
  throw new Error(`Unknown order stage "${stageKey}" for this shop's activity`);
}
