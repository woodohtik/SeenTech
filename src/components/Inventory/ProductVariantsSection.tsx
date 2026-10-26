import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, X, Layers } from "lucide-react";
import { cn } from "../../lib/utils";
import { useToast } from "../../contexts/ToastContext";
import { useConfirm } from "../../contexts/ConfirmContext";
import { Branch, ProductVariant } from "../../types";
import { listVariants, createVariant, updateVariant, deleteVariant } from "../../services/variantService";
import VariantAttributeBuilder, { type GeneratedRow } from "./VariantAttributeBuilder";

/**
 * seen-ux-fixes-batch-task.md item 10 -- lets a merchant define per-item
 * variants (e.g. a fabric in several colors/sizes), each with its own
 * SKU/barcode/price adjustment and opening stock. Rendered only inside
 * EditItemModal (an item must already exist -- item_id is a required FK on
 * inventory_variants).
 *
 * Adding variants goes through the shared VariantAttributeBuilder
 * (attribute name + value list -> generated combination rows); here it runs
 * in "persist" mode (`onSaveAll`), creating each row immediately via
 * variantService.createVariant since the item already has an id. Editing an
 * already-saved variant stays a direct single-row field form below.
 */

interface ProductVariantsSectionProps {
  tenantId: string;
  itemId: string;
  branches: Branch[];
  /** Base item's own SKU, used only to pre-fill a suggested per-row SKU. */
  baseSku?: string;
}

interface OptionRow {
  key: string;
  value: string;
}

interface EditFormState {
  name: string;
  options: OptionRow[];
  sku: string;
  barcode: string;
  priceAdjustment: string;
}

const EMPTY_EDIT_FORM: EditFormState = {
  name: "",
  options: [{ key: "", value: "" }],
  sku: "",
  barcode: "",
  priceAdjustment: "0",
};

function optionsToRecord(rows: OptionRow[]): Record<string, string> {
  const record: Record<string, string> = {};
  rows.forEach((row) => {
    if (row.key.trim()) record[row.key.trim()] = row.value.trim();
  });
  return record;
}

export default function ProductVariantsSection({ tenantId, itemId, branches, baseSku }: ProductVariantsSectionProps) {
  const { t } = useTranslation();
  const { success: toastSuccess, handleError } = useToast();
  const { confirm } = useConfirm();
  const queryClient = useQueryClient();
  const queryKey = ["product-variants", itemId];

  const { data: variants = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => listVariants(itemId),
    enabled: !!itemId,
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditFormState>(EMPTY_EDIT_FORM);
  const [savingEdit, setSavingEdit] = useState(false);
  const [isBuilding, setIsBuilding] = useState(false);

  const totalStock = (variant: ProductVariant) =>
    Object.values(variant.stockByBranch || {}).reduce((sum, qty) => sum + qty, 0);

  const startEdit = (variant: ProductVariant) => {
    const rows = Object.entries(variant.options || {}).map(([key, value]) => ({ key, value }));
    setEditForm({
      name: variant.name,
      options: rows.length > 0 ? rows : [{ key: "", value: "" }],
      sku: variant.sku,
      barcode: variant.barcode || "",
      priceAdjustment: String(variant.priceAdjustment ?? 0),
    });
    setEditingId(variant.id);
    setIsBuilding(false);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm(EMPTY_EDIT_FORM);
  };

  const updateEditOptionRow = (index: number, field: "key" | "value", value: string) => {
    setEditForm((prev) => ({
      ...prev,
      options: prev.options.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    }));
  };
  const addEditOptionRow = () => setEditForm((prev) => ({ ...prev, options: [...prev.options, { key: "", value: "" }] }));
  const removeEditOptionRow = (index: number) =>
    setEditForm((prev) => ({ ...prev, options: prev.options.filter((_, i) => i !== index) }));

  const handleSaveEdit = async () => {
    if (!editForm.name.trim() || !editForm.sku.trim()) {
      handleError(new Error(t("inventory.variants.name_sku_required", "الاسم ورمز SKU مطلوبان")));
      return;
    }
    setSavingEdit(true);
    try {
      await updateVariant(editingId as string, {
        name: editForm.name.trim(),
        options: optionsToRecord(editForm.options),
        sku: editForm.sku.trim(),
        barcode: editForm.barcode.trim() || undefined,
        priceAdjustment: Number(editForm.priceAdjustment) || 0,
      });
      queryClient.invalidateQueries({ queryKey });
      toastSuccess(t("inventory.variants.updated", "تم تحديث السمة"));
      cancelEdit();
    } catch (err) {
      handleError(err);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async (variant: ProductVariant) => {
    const ok = await confirm({
      description: t(
        "inventory.variants.confirm_delete",
        "حذف السمة سيؤدي لحذف سجل مخزونها نهائياً من كل الفروع. هذا الإجراء لا رجعة فيه."
      ),
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteVariant(variant.id);
      queryClient.invalidateQueries({ queryKey });
      toastSuccess(t("inventory.variants.deleted", "تم حذف السمة"));
    } catch (err) {
      handleError(err);
    }
  };

  const persistRows = async (rows: GeneratedRow[]) => {
    const succeeded: GeneratedRow[] = [];
    const failed: GeneratedRow[] = [];
    for (const row of rows) {
      try {
        await createVariant({
          tenantId,
          itemId,
          name: row.name,
          options: row.options,
          sku: row.sku.trim(),
          barcode: row.barcode.trim() || undefined,
          priceAdjustment: Number(row.priceAdjustment) || 0,
          openingStock: Number(row.openingStock) || 0,
          branches,
        });
        succeeded.push(row);
      } catch (err) {
        handleError(err);
        failed.push(row);
      }
    }
    queryClient.invalidateQueries({ queryKey });
    if (succeeded.length > 0) {
      toastSuccess(t("inventory.variants.bulk_added", { count: succeeded.length, defaultValue: `تمت إضافة ${succeeded.length} سمة` }));
    }
    return { succeeded, failed };
  };

  return (
    <div className="bg-surface-muted/50 p-6 rounded-2xl border border-border space-y-4">
      <div className="flex items-center gap-2">
        <Layers size={18} className="text-brand" />
        <h3 className="text-sm font-black text-content uppercase tracking-widest text-brand">
          {t("inventory.variants.section_title", "السمات (الألوان، المقاسات...)")}
        </h3>
      </div>

      {isLoading ? (
        <p className="text-xs text-content-muted">{t("common.loading", "جارٍ التحميل...")}</p>
      ) : (
        <div className="space-y-2">
          {variants.map((variant) => (
            <div
              key={variant.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-xl border border-border bg-surface"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-content">{variant.name}</span>
                  {Object.entries(variant.options || {}).map(([key, value]) => (
                    <span key={key} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-surface-muted text-content-muted">
                      {key}: {value}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-content-muted mt-1">
                  SKU: {variant.sku} · {t("inventory.variants.total_stock", "المخزون الإجمالي")}: {totalStock(variant)}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0 self-end sm:self-auto">
                <button
                  type="button"
                  onClick={() => startEdit(variant)}
                  className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-content-muted hover:text-content hover:bg-surface-muted"
                  aria-label={t("common.edit", "تعديل")}
                >
                  <Pencil size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(variant)}
                  className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-danger hover:bg-danger/10"
                  aria-label={t("common.delete", "حذف")}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}

          {variants.length === 0 && !isBuilding && !editingId && (
            <p className="text-xs text-content-muted">{t("inventory.variants.empty", "لا توجد سمات لهذا المنتج بعد.")}</p>
          )}
        </div>
      )}

      {/* Editing one already-saved variant. */}
      {editingId ? (
        <div className="p-4 rounded-xl border-2 border-brand/40 bg-brand/5 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-black text-content-muted uppercase px-1">
                {t("inventory.variants.name_label", "اسم السمة")}
              </label>
              <input
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                className="w-full px-4 py-2.5 bg-surface border border-border rounded-xl font-semibold text-content text-right outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-content-muted uppercase px-1">SKU</label>
              <input
                value={editForm.sku}
                onChange={(e) => setEditForm({ ...editForm, sku: e.target.value })}
                className="w-full px-4 py-2.5 bg-surface border border-border rounded-xl font-semibold text-content text-right outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-content-muted uppercase px-1 block">
              {t("inventory.variants.options_label", "الخصائص (مفتاح : قيمة)")}
            </label>
            {editForm.options.map((row, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  value={row.key}
                  onChange={(e) => updateEditOptionRow(index, "key", e.target.value)}
                  placeholder={t("inventory.variants.option_key_placeholder", "مثلاً: لون")}
                  className="flex-1 min-w-0 px-3 py-2 bg-surface border border-border rounded-lg text-sm font-semibold text-content text-right outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
                />
                <input
                  value={row.value}
                  onChange={(e) => updateEditOptionRow(index, "value", e.target.value)}
                  placeholder={t("inventory.variants.option_value_placeholder", "مثلاً: أزرق")}
                  className="flex-1 min-w-0 px-3 py-2 bg-surface border border-border rounded-lg text-sm font-semibold text-content text-right outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
                />
                <button
                  type="button"
                  onClick={() => removeEditOptionRow(index)}
                  className="min-w-[32px] min-h-[32px] flex items-center justify-center rounded-lg text-content-muted hover:bg-surface"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
            <button type="button" onClick={addEditOptionRow} className="text-xs font-bold text-brand hover:underline">
              + {t("inventory.variants.add_option", "إضافة خاصية")}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-black text-content-muted uppercase px-1">
                {t("inventory.barcode", "الباركود")}
              </label>
              <input
                value={editForm.barcode}
                onChange={(e) => setEditForm({ ...editForm, barcode: e.target.value })}
                className="w-full px-4 py-2.5 bg-surface border border-border rounded-xl font-semibold text-content text-right outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-content-muted uppercase px-1">
                {t("inventory.variants.price_adjustment", "فرق السعر")}
              </label>
              <input
                type="number"
                step="0.01"
                value={editForm.priceAdjustment}
                onChange={(e) => setEditForm({ ...editForm, priceAdjustment: e.target.value })}
                className="w-full px-4 py-2.5 bg-surface border border-border rounded-xl font-semibold text-content text-right outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleSaveEdit}
              disabled={savingEdit}
              className="px-4 py-2 rounded-lg bg-brand text-white font-bold text-sm disabled:opacity-50"
            >
              {savingEdit ? t("common.saving", "جارٍ الحفظ...") : t("common.save", "حفظ")}
            </button>
            <button type="button" onClick={cancelEdit} className="px-4 py-2 rounded-lg text-content-muted font-bold text-sm hover:bg-surface">
              {t("common.cancel", "إلغاء")}
            </button>
          </div>
        </div>
      ) : isBuilding ? (
        <VariantAttributeBuilder
          baseSku={baseSku}
          onCancel={() => setIsBuilding(false)}
          onSaveAll={persistRows}
          onSaved={() => setIsBuilding(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setIsBuilding(true)}
          className={cn(
            "w-full flex items-center justify-center gap-2 p-3 rounded-xl border-2 border-dashed border-border text-content-muted font-bold hover:border-brand/40 hover:text-brand transition-colors min-h-[44px]"
          )}
        >
          <Plus size={18} />
          {t("inventory.variants.add_new", "إضافة سمة جديدة")}
        </button>
      )}
    </div>
  );
}
