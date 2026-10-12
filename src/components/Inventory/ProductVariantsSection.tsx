import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, X, Layers } from "lucide-react";
import { cn } from "../../lib/utils";
import { useToast } from "../../contexts/ToastContext";
import { useConfirm } from "../../contexts/ConfirmContext";
import { Branch, ProductVariant } from "../../types";
import { listVariants, createVariant, updateVariant, deleteVariant } from "../../services/variantService";

/**
 * seen-ux-fixes-batch-task.md item 10 -- lets a merchant define per-item
 * variants (e.g. a fabric in several colors/sizes), each with its own
 * SKU/barcode/price adjustment and opening stock. Rendered only inside
 * EditItemModal (an item must already exist -- item_id is a required FK on
 * inventory_variants), never inside AddItemModal.
 */

interface ProductVariantsSectionProps {
  tenantId: string;
  itemId: string;
  branches: Branch[];
}

interface OptionRow {
  key: string;
  value: string;
}

interface VariantFormState {
  name: string;
  options: OptionRow[];
  sku: string;
  barcode: string;
  priceAdjustment: string;
  openingStock: string;
}

const EMPTY_FORM: VariantFormState = {
  name: "",
  options: [{ key: "", value: "" }],
  sku: "",
  barcode: "",
  priceAdjustment: "0",
  openingStock: "0",
};

function optionsToRecord(rows: OptionRow[]): Record<string, string> {
  const record: Record<string, string> = {};
  rows.forEach((row) => {
    if (row.key.trim()) record[row.key.trim()] = row.value.trim();
  });
  return record;
}

export default function ProductVariantsSection({ tenantId, itemId, branches }: ProductVariantsSectionProps) {
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

  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<VariantFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const totalStock = (variant: ProductVariant) =>
    Object.values(variant.stockByBranch || {}).reduce((sum, qty) => sum + qty, 0);

  const startAdd = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setIsAdding(true);
  };

  const startEdit = (variant: ProductVariant) => {
    const rows = Object.entries(variant.options || {}).map(([key, value]) => ({ key, value }));
    setForm({
      name: variant.name,
      options: rows.length > 0 ? rows : [{ key: "", value: "" }],
      sku: variant.sku,
      barcode: variant.barcode || "",
      priceAdjustment: String(variant.priceAdjustment ?? 0),
      openingStock: "0",
    });
    setEditingId(variant.id);
    setIsAdding(true);
  };

  const cancelForm = () => {
    setIsAdding(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const updateOptionRow = (index: number, field: "key" | "value", value: string) => {
    setForm((prev) => ({
      ...prev,
      options: prev.options.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    }));
  };

  const addOptionRow = () => setForm((prev) => ({ ...prev, options: [...prev.options, { key: "", value: "" }] }));
  const removeOptionRow = (index: number) =>
    setForm((prev) => ({ ...prev, options: prev.options.filter((_, i) => i !== index) }));

  const handleSave = async () => {
    if (!form.name.trim() || !form.sku.trim()) {
      handleError(new Error(t("inventory.variants.name_sku_required", "الاسم ورمز SKU مطلوبان")));
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await updateVariant(editingId, {
          name: form.name.trim(),
          options: optionsToRecord(form.options),
          sku: form.sku.trim(),
          barcode: form.barcode.trim() || undefined,
          priceAdjustment: Number(form.priceAdjustment) || 0,
        });
      } else {
        await createVariant({
          tenantId,
          itemId,
          name: form.name.trim(),
          options: optionsToRecord(form.options),
          sku: form.sku.trim(),
          barcode: form.barcode.trim() || undefined,
          priceAdjustment: Number(form.priceAdjustment) || 0,
          openingStock: Number(form.openingStock) || 0,
          branches,
        });
      }
      queryClient.invalidateQueries({ queryKey });
      toastSuccess(editingId ? t("inventory.variants.updated", "تم تحديث السمة") : t("inventory.variants.added", "تمت إضافة السمة"));
      cancelForm();
    } catch (err) {
      handleError(err);
    } finally {
      setSaving(false);
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

  return (
    <div className="bg-surface-muted/50 p-6 rounded-[2rem] border border-border space-y-4">
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

          {variants.length === 0 && !isAdding && (
            <p className="text-xs text-content-muted">{t("inventory.variants.empty", "لا توجد سمات لهذا المنتج بعد.")}</p>
          )}
        </div>
      )}

      {isAdding ? (
        <div className="p-4 rounded-xl border-2 border-brand/40 bg-brand/5 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-black text-content-muted uppercase px-1">
                {t("inventory.variants.name_label", "اسم السمة")}
              </label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={t("inventory.variants.name_placeholder", "مثلاً: أزرق - L")}
                className="w-full px-4 py-2.5 bg-surface border border-border rounded-xl font-semibold text-content text-right outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-content-muted uppercase px-1">SKU</label>
              <input
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
                className="w-full px-4 py-2.5 bg-surface border border-border rounded-xl font-semibold text-content text-right outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-content-muted uppercase px-1 block">
              {t("inventory.variants.options_label", "الخصائص (مفتاح : قيمة)")}
            </label>
            {form.options.map((row, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  value={row.key}
                  onChange={(e) => updateOptionRow(index, "key", e.target.value)}
                  placeholder={t("inventory.variants.option_key_placeholder", "مثلاً: لون")}
                  className="flex-1 min-w-0 px-3 py-2 bg-surface border border-border rounded-lg text-sm font-semibold text-content text-right outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
                />
                <input
                  value={row.value}
                  onChange={(e) => updateOptionRow(index, "value", e.target.value)}
                  placeholder={t("inventory.variants.option_value_placeholder", "مثلاً: أزرق")}
                  className="flex-1 min-w-0 px-3 py-2 bg-surface border border-border rounded-lg text-sm font-semibold text-content text-right outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
                />
                <button
                  type="button"
                  onClick={() => removeOptionRow(index)}
                  className="min-w-[32px] min-h-[32px] flex items-center justify-center rounded-lg text-content-muted hover:bg-surface"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addOptionRow}
              className="text-xs font-bold text-brand hover:underline"
            >
              + {t("inventory.variants.add_option", "إضافة خاصية")}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-black text-content-muted uppercase px-1">
                {t("inventory.barcode", "الباركود")}
              </label>
              <input
                value={form.barcode}
                onChange={(e) => setForm({ ...form, barcode: e.target.value })}
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
                value={form.priceAdjustment}
                onChange={(e) => setForm({ ...form, priceAdjustment: e.target.value })}
                className="w-full px-4 py-2.5 bg-surface border border-border rounded-xl font-semibold text-content text-right outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
              />
            </div>
            {!editingId && (
              <div className="space-y-1">
                <label className="text-[10px] font-black text-content-muted uppercase px-1">
                  {t("inventory.variants.opening_stock", "المخزون الافتتاحي")}
                </label>
                <input
                  type="number"
                  min="0"
                  value={form.openingStock}
                  onChange={(e) => setForm({ ...form, openingStock: e.target.value })}
                  className="w-full px-4 py-2.5 bg-surface border border-border rounded-xl font-semibold text-content text-right outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
                />
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-brand text-white font-bold text-sm disabled:opacity-50"
            >
              {saving ? t("common.saving", "جارٍ الحفظ...") : t("common.save", "حفظ")}
            </button>
            <button
              type="button"
              onClick={cancelForm}
              className="px-4 py-2 rounded-lg text-content-muted font-bold text-sm hover:bg-surface"
            >
              {t("common.cancel", "إلغاء")}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={startAdd}
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
