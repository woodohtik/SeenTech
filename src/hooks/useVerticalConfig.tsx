/**
 * useVerticalConfig — طبقة المجال المدفوعة بالـconfig (verticals) للواجهة.
 *
 * تحمّل نشاط المستأجر الحالي (mens_tailoring / womens_tailoring / furniture /
 * fabric_store / specialty_clothing) ومراحل عمله وحقوله المخصصة وفئات مخزونه
 * مرة واحدة عند تحميل التطبيق، وتوفّرها عبر Context بدل استدعاء verticalService
 * من كل مكوّن على حدة (كل استدعاء كان سيكرّر نفس الجلبات الثلاث).
 *
 * SQL: MIGRATION_extensibility_stage1/2/3.sql. الخدمة: services/verticalService.ts.
 *
 * ملاحظة توافق: `isLegacyVertical` (true فقط لـ mens_tailoring، النشاط
 * الافتراضي والوحيد المُستخدَم فعلياً في الإنتاج حتى الآن) هي علامة يستخدمها
 * كل مكوّن يُهاجَر في المرحلة 3 ليقرر: يُبقي على سلوكه الثابت الحالي (enum
 * الطلبات/المخزون + أعمدة order_items المباشرة) بلا أي تغيير لهذا النشاط
 * تحديدًا، أو يتحوّل للمسار الديناميكي الجديد للأنشطة الأخرى. هذا يحقق
 * "توافق عكسي كامل" حرفيًا: لا يمر أي مستأجر mens_tailoring حالي بأي كود
 * جديد إطلاقًا، فمن المستحيل بنيويًا أن ينكسر شيء لديه.
 */

import React, { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  getTenantVertical, getWorkflowStages, getFieldSchemas, getInventoryCategories, DEFAULT_VERTICAL,
} from '../services/verticalService';
import type {
  VerticalKey, ModuleKey, WorkflowStage, FieldSchema, InventoryCategoryConfig,
} from '../types/expansion';

export interface VerticalConfigValue {
  vertical: VerticalKey;
  modules: ModuleKey[];
  /** مراحل سير عمل الطلب لهذا النشاط، مرتّبة — تُستخدم بدل enum order_status. */
  workflowStages: WorkflowStage[];
  /** الحقول المخصصة لصنف الطلب (applies_to='order_item') لهذا النشاط. */
  orderItemFields: FieldSchema[];
  /** فئات المخزون لهذا النشاط — تُستخدم بدل enum inventory_category. */
  inventoryCategories: InventoryCategoryConfig[];
  /** ما زال الجلب الأول جارياً (لا تعتمد على القوائم أعلاه قبل أن تصبح false). */
  loading: boolean;
  /** true فقط لـ mens_tailoring — انظر ملاحظة التوافق أعلاه. */
  isLegacyVertical: boolean;
}

const EMPTY_STATE: VerticalConfigValue = {
  vertical: DEFAULT_VERTICAL,
  modules: [],
  workflowStages: [],
  orderItemFields: [],
  inventoryCategories: [],
  loading: true,
  isLegacyVertical: true,
};

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
    // يبقى الأمر عند الافتراضي (mens_tailoring، isLegacyVertical=true) دون
    // أي استعلام، فلا تتأثر شاشات السوبر أدمن أو التهيئة بهذا الـhook إطلاقاً.
    if (!tenantId || tenantId === 'saas') {
      setState({ ...EMPTY_STATE, loading: false });
      return;
    }

    setState((s) => ({ ...s, loading: true }));

    (async () => {
      const { vertical, modules } = await getTenantVertical(tenantId);
      const [workflowStages, orderItemFields, inventoryCategories] = await Promise.all([
        getWorkflowStages(vertical),
        getFieldSchemas(vertical, 'order_item'),
        getInventoryCategories(vertical),
      ]);
      if (cancelled) return;
      setState({
        vertical,
        modules,
        workflowStages,
        orderItemFields,
        inventoryCategories,
        loading: false,
        isLegacyVertical: vertical === DEFAULT_VERTICAL,
      });
    })().catch((err) => {
      console.error('[useVerticalConfig] فشل تحميل إعدادات النشاط:', err);
      // فشل الجلب لا يجب أن يعطّل الصفحة — رجوع آمن لسلوك mens_tailoring
      // الثابت الحالي، وهو نفس ما يعمل عليه كل مستأجر إنتاج حالياً.
      if (!cancelled) setState({ ...EMPTY_STATE, loading: false });
    });

    return () => {
      cancelled = true;
    };
  }, [tenantId]);

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
