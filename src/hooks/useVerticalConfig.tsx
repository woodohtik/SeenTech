/**
 * useVerticalConfig — طبقة المجال المدفوعة بالـconfig (verticals) للواجهة.
 *
 * تحمّل نشاط المستأجر الحالي (mens_tailoring / womens_tailoring / furniture /
 * fabric_store / specialty_clothing) ومراحل عمله وحقوله المخصصة وفئات مخزونه
 * وقدراته مرة واحدة عند تحميل التطبيق، وتوفّرها عبر Context بدل استدعاء
 * verticalService من كل مكوّن على حدة.
 *
 * SQL: supabase/migrations/20260910060000_backfill_extensibility_verticals.sql،
 * و20261231000001_verticals_capabilities.sql (القدرات، معنى المراحل، الترجمة).
 * الخدمة: services/verticalService.ts.
 *
 * seen-verticals-readiness-task.md Phase 1:
 * - `capabilities` يحدد ما يفعله النشاط (المقاسات، القماش، البيع بالطول...)؛
 *   الشاشات تتفرع عليه بدل `isLegacyVertical` تدريجياً. `isLegacyVertical`
 *   باقٍ مؤقتاً ومشتق: vertical === 'mens_tailoring'.
 * - الإعدادات تُحفظ لكل محل (lastKnownCache) وتُعرض فوراً منها، ثم تُحدَّث.
 * - لا رجوع صامت إلى «رجالي» لمحل نشاطه معروف: إن تعذّر الجلب ولا نسخة
 *   محفوظة ونشاط المحل غير رجالي، يصبح `unavailable = true` (الشاشات تُظهر
 *   «تعذّر تحميل إعدادات نشاطك» وتمنع إنشاء الطلبات حتى يعود الاتصال). محل
 *   رجالي بلا نسخة يعمل كما كان دائماً.
 */

import React, { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  getTenantVertical, getVertical, getWorkflowStages, getFieldSchemas, getInventoryCategories,
  DEFAULT_VERTICAL, DEFAULT_MODULES, MENS_CAPABILITIES, effectiveModules,
} from '../services/verticalService';
import { getLastKnown, saveLastKnown } from '../lib/offline/lastKnownCache';
import { setLengthCategories } from '../utils/itemUnits';
import type {
  VerticalKey, ModuleKey, WorkflowStage, FieldSchema, InventoryCategoryConfig, VerticalCapabilities, Vertical,
} from '../types/expansion';

export interface VerticalConfigValue {
  vertical: VerticalKey;
  /** The vertical's row (names in three languages, readiness). */
  verticalInfo: Vertical | null;
  modules: ModuleKey[];
  /** What this vertical does -- branch on these, not on the vertical's name. */
  capabilities: VerticalCapabilities;
  /** مراحل سير عمل الطلب لهذا النشاط، مرتّبة — تُستخدم بدل enum order_status. */
  workflowStages: WorkflowStage[];
  /** الحقول المخصصة لصنف الطلب (applies_to='order_item') لهذا النشاط. */
  orderItemFields: FieldSchema[];
  /** فئات المخزون لهذا النشاط — تُستخدم بدل enum inventory_category. */
  inventoryCategories: InventoryCategoryConfig[];
  /** ما زال الجلب الأول جارياً (لا تعتمد على القوائم أعلاه قبل أن تصبح false). */
  loading: boolean;
  /**
   * The shop's vertical is not men's tailoring and its settings could not be
   * loaded (no connection, nothing saved): do not create orders with defaults.
   */
  unavailable: boolean;
  /** true فقط لـ mens_tailoring — مؤقت، استبدله بالقدرة المناسبة. */
  isLegacyVertical: boolean;
}

type SavedConfig = Pick<VerticalConfigValue,
  'vertical' | 'verticalInfo' | 'modules' | 'capabilities' | 'workflowStages' | 'orderItemFields' | 'inventoryCategories'>;

const CACHE_KEY = 'vertical_config';

const EMPTY_STATE: VerticalConfigValue = {
  vertical: DEFAULT_VERTICAL,
  verticalInfo: null,
  modules: [],
  capabilities: MENS_CAPABILITIES,
  workflowStages: [],
  orderItemFields: [],
  inventoryCategories: [],
  loading: true,
  unavailable: false,
  isLegacyVertical: true,
};

function fromSaved(saved: SavedConfig): VerticalConfigValue {
  return { ...EMPTY_STATE, ...saved, loading: false, unavailable: false, isLegacyVertical: saved.vertical === DEFAULT_VERTICAL };
}

/** Loads a shop's vertical settings (exported for tests). Throws when they cannot be read. */
export async function loadVerticalConfig(tenantId: string): Promise<SavedConfig> {
  const { vertical, modules: storedModules } = await getTenantVertical(tenantId);
  const [verticalInfo, workflowStages, orderItemFields, inventoryCategories] = await Promise.all([
    getVertical(vertical),
    getWorkflowStages(vertical),
    getFieldSchemas(vertical, 'order_item'),
    getInventoryCategories(vertical),
  ]);
  // A database before 20261231000001 has no capabilities: men's tailoring
  // behaves as it always did; any other vertical gets none of the tailoring
  // tools rather than the men's ones.
  const capabilities: VerticalCapabilities = verticalInfo?.capabilities
    ?? (vertical === DEFAULT_VERTICAL ? MENS_CAPABILITIES : { ...MENS_CAPABILITIES, body_measurements: null, fabric_consumption: false, item_term: 'piece' });
  return {
    vertical,
    verticalInfo,
    // The shop's modules narrowed by its activity (Phase 6).
    modules: effectiveModules(storedModules, capabilities),
    capabilities,
    workflowStages,
    orderItemFields,
    inventoryCategories,
  };
}

/**
 * What to show when loading failed: the saved copy if there is one; else the
 * men's defaults only for a men's shop (or a shop whose vertical is unknown,
 * as before); else "unavailable".
 */
export function configAfterFailure(saved: SavedConfig | null, knownVertical: VerticalKey | null): VerticalConfigValue {
  if (saved && (!knownVertical || saved.vertical === knownVertical)) return fromSaved(saved);
  if (!knownVertical || knownVertical === DEFAULT_VERTICAL) {
    return { ...EMPTY_STATE, modules: DEFAULT_MODULES, loading: false };
  }
  return { ...EMPTY_STATE, vertical: knownVertical, loading: false, unavailable: true, isLegacyVertical: false };
}

const VerticalConfigContext = createContext<VerticalConfigValue>(EMPTY_STATE);

export function VerticalConfigProvider({
  tenantId,
  children,
}: {
  tenantId?: string | null;
  children: ReactNode;
}) {
  const [state, setState] = useState<VerticalConfigValue>(EMPTY_STATE);

  useEffect(() => {
    let cancelled = false;

    // لا مستأجر فعلي بعد (طور تسجيل الدخول/التهيئة، أو جلسة سوبر أدمن) —
    // يبقى الأمر عند الافتراضي دون أي استعلام.
    if (!tenantId || tenantId === 'saas') {
      setState({ ...EMPTY_STATE, loading: false });
      return;
    }

    // The saved copy first, so the screens draw with this shop's own stages
    // straight away (and offline); then the fresh settings.
    const saved = getLastKnown<SavedConfig>(tenantId, CACHE_KEY)?.data ?? null;
    setState(saved ? fromSaved(saved) : { ...EMPTY_STATE, loading: true });

    loadVerticalConfig(tenantId)
      .then((fresh) => {
        if (cancelled) return;
        saveLastKnown(tenantId, CACHE_KEY, fresh);
        setState(fromSaved(fresh));
      })
      .catch(async (err) => {
        console.error('[useVerticalConfig] فشل تحميل إعدادات النشاط:', err);
        if (cancelled) return;
        // The shop's vertical may still be known (the tenants row comes from
        // the identity snapshot even offline).
        let known: VerticalKey | null = null;
        try {
          known = (await getTenantVertical(tenantId)).vertical;
        } catch {
          known = null;
        }
        if (!cancelled) setState(configAfterFailure(saved, known));
      });

    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  // The shop's length categories, for isLengthCategory (utils/itemUnits).
  useEffect(() => {
    setLengthCategories(state.inventoryCategories);
  }, [state.inventoryCategories]);

  const value = useMemo(() => state, [state]);

  return (
    <VerticalConfigContext.Provider value={value}>
      {children}
    </VerticalConfigContext.Provider>
  );
}

/** يقرأ إعدادات نشاط المستأجر الحالي. آمن للاستدعاء خارج Provider (يرجع الافتراضي mens_tailoring بدل أن ينهار). */
export function useVerticalConfig(): VerticalConfigValue {
  return useContext(VerticalConfigContext);
}
