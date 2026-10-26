import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, X, Layers, ArrowRight } from "lucide-react";
import { cn } from "../../lib/utils";
import { useToast } from "../../contexts/ToastContext";
import { useConfirm } from "../../contexts/ConfirmContext";
import { Branch, ProductVariant } from "../../types";
import { listVariants, createVariant, updateVariant, deleteVariant } from "../../services/variantService";
import { generateVariantCombinations, type AttributeDraft } from "../../utils/variantCombinations";

/**
 * seen-ux-fixes-batch-task.md item 10 -- lets a merchant define per-item
 * variants (e.g. a fabric in several colors/sizes), each with its own
 * SKU/barcode/price adjustment and opening stock. Rendered only inside
 * EditItemModal (an item must already exist -- item_id is a required FK on
 * inventory_variants), never inside AddItemModal; AddItemModal instead
 * offers a "has variants" checkbox that, on save, opens EditItemModal with
 * `autoStartAdd` so the merchant lands directly in this builder.
 *
 * Adding variants is attribute-driven, not one free-form row at a time: the
 * merchant names an attribute (e.g. "اللون") and lists its values (أزرق،
 * أخضر، أبيض), optionally repeating for a second attribute (e.g. "المقاس"),
 * and the cartesian product (generateVariantCombinations) becomes one
 * editable row per combination before saving. Editing an already-saved
 * variant stays a direct single-row field form -- there's no "regenerate
 * the combination" concept once a row is its own real record.
 */

interface ProductVariantsSectionProps {
  tenantId: string;
  itemId: string;
  branches: Branch[];
  /** Base item's own SKU, used only to pre-fill a suggested per-row SKU. */
  baseSku?: string;
  /** Opens the attribute builder immediately on mount -- the Add-item "has variants" flow. */
  autoStartAdd?: boolean;
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

interface GeneratedRow {
  key: string;
  name: string;
  options: Record<string, string>;
  sku: string;
  barcode: string;
  priceAdjustment: string;
  openingStock: string;
}

let attrIdCounter = 0;
const nextAttrId = () => `attr-${++attrIdCounter}`;

const EMPTY_ATTRIBUTE = (): AttributeDraft & { id: string } => ({ id: nextAttrId(), name: "", values: [] });

export default function ProductVariantsSection({ tenantId, itemId, branches, baseSku, autoStartAdd }: ProductVariantsSectionProps) {
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

  // Editing one already-saved variant (direct field form).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditFormState>(EMPTY_EDIT_FORM);
  const [savingEdit, setSavingEdit] = useState(false);

  // Adding new variants via the attribute builder.
  const [isBuilding, setIsBuilding] = useState(false);
  const [builderStep, setBuilderStep] = useState<"attributes" | "rows">("attributes");
  const [attributeDrafts, setAttributeDrafts] = useState<(AttributeDraft & { id: string })[]>([EMPTY_ATTRIBUTE()]);
  const [valueInputs, setValueInputs] = useState<Record<string, string>>({});
  const [generatedRows, setGeneratedRows] = useState<GeneratedRow[]>([]);
  const [savingRows, setSavingRows] = useState(false);

  const totalStock = (variant: ProductVariant) =>
    Object.values(variant.stockByBranch || {}).reduce((sum, qty) => sum + qty, 0);

  const startBuilder = () => {
    setEditingId(null);
    setAttributeDrafts([EMPTY_ATTRIBUTE()]);
    setValueInputs({});
    setGeneratedRows([]);
    setBuilderStep("attributes");
    setIsBuilding(true);
  };

  useEffect(() => {
    if (autoStartAdd) startBuilder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStartAdd]);

  const cancelBuilder = () => {
    setIsBuilding(false);
    setBuilderStep("attributes");
    setAttributeDrafts([EMPTY_ATTRIBUTE()]);
    setValueInputs({});
    setGeneratedRows([]);
  };

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

  // --- Attribute builder (step 1) ---

  const updateAttributeName = (id: string, name: string) =>
    setAttributeDrafts((prev) => prev.map((a) => (a.id === id ? { ...a, name } : a)));

  const addAttributeRow = () => setAttributeDrafts((prev) => [...prev, EMPTY_ATTRIBUTE()]);
  const removeAttributeRow = (id: string) => setAttributeDrafts((prev) => prev.filter((a) => a.id !== id));

  const addValueToAttribute = (id: string) => {
    const raw = (valueInputs[id] || "").trim();
    if (!raw) return;
    setAttributeDrafts((prev) =>
      prev.map((a) => (a.id === id && !a.values.includes(raw) ? { ...a, values: [...a.values, raw] } : a))
    );
    setValueInputs((prev) => ({ ...prev, [id]: "" }));
  };
  const removeValueFromAttribute = (id: string, value: string) =>
    setAttributeDrafts((prev) => prev.map((a) => (a.id === id ? { ...a, values: a.values.filter((v) => v !== value) } : a)));

  const canGenerate = attributeDrafts.some((a) => a.name.trim() && a.values.length > 0);

  const goToRows = () => {
    const combos = generateVariantCombinations(attributeDrafts);
    setGeneratedRows(
      combos.map((combo, index) => ({
        key: `row-${index}`,
        name: combo.name,
        options: combo.options,
        sku: baseSku ? `${baseSku}-${index + 1}` : "",
        barcode: "",
        priceAdjustment: "0",
        openingStock: "0",
      }))
    );
    setBuilderStep("rows");
  };

  // --- Generated rows (step 2) ---

  const updateRow = (key: string, field: keyof GeneratedRow, value: string) =>
    setGeneratedRows((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  const removeRow = (key: string) => setGeneratedRows((prev) => prev.filter((r) => r.key !== key));

  const handleSaveRows = async () => {
    const missingSku = generatedRows.find((r) => !r.sku.trim());
    if (missingSku) {
      handleError(new Error(t("inventory.variants.sku_required_for", { name: missingSku.name, defaultValue: `رمز SKU مطلوب لـ "${missingSku.name}"` })));
      return;
    }
    const skus = generatedRows.map((r) => r.sku.trim());
    if (new Set(skus).size !== skus.length) {
      handleError(new Error(t("inventory.variants.duplicate_sku", "لا يمكن تكرار نفس رمز SKU لأكثر من سمة")));
      return;
    }

    setSavingRows(true);
    const failed: GeneratedRow[] = [];
    let savedCount = 0;
    for (const row of generatedRows) {
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
        savedCount += 1;
      } catch (err) {
        handleError(err);
        failed.push(row);
      }
    }
    setSavingRows(false);
    queryClient.invalidateQueries({ queryKey });

    if (savedCount > 0) {
      toastSuccess(
        t("inventory.variants.bulk_added", { count: savedCount, defaultValue: `تمت إضافة ${savedCount} سمة` })
      );
    }
    if (failed.length === 0) {
      cancelBuilder();
    } else {
      setGeneratedRows(failed);
    }
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
      ) : isBuilding && builderStep === "attributes" ? (
        <div className="p-4 rounded-xl border-2 border-brand/40 bg-brand/5 space-y-4">
          {attributeDrafts.map((attr) => (
            <div key={attr.id} className="space-y-2 p-3 rounded-lg bg-surface border border-border">
              <div className="flex items-center gap-2">
                <input
                  value={attr.name}
                  onChange={(e) => updateAttributeName(attr.id, e.target.value)}
                  placeholder={t("inventory.variants.attribute_name_placeholder", "اسم السمة، مثلاً: اللون")}
                  className="flex-1 min-w-0 px-4 py-2.5 bg-surface-muted border border-border rounded-xl font-bold text-content text-right outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
                />
                {attributeDrafts.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeAttributeRow(attr.id)}
                    className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-content-muted hover:bg-surface-muted"
                    aria-label={t("common.delete", "حذف")}
                  >
                    <X size={16} />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {attr.values.map((value) => (
                  <span
                    key={value}
                    className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full bg-brand/10 text-brand"
                  >
                    {value}
                    <button type="button" onClick={() => removeValueFromAttribute(attr.id, value)} aria-label={t("common.delete", "حذف")}>
                      <X size={12} />
                    </button>
                  </span>
                ))}
                <div className="flex items-center gap-1">
                  <input
                    value={valueInputs[attr.id] || ""}
                    onChange={(e) => setValueInputs((prev) => ({ ...prev, [attr.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addValueToAttribute(attr.id);
                      }
                    }}
                    placeholder={t("inventory.variants.value_placeholder", "قيمة، مثلاً: أزرق")}
                    className="w-32 px-3 py-1.5 bg-surface-muted border border-border rounded-full text-xs font-semibold text-content text-right outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
                  />
                  <button
                    type="button"
                    onClick={() => addValueToAttribute(attr.id)}
                    className="text-xs font-bold text-brand hover:underline whitespace-nowrap"
                  >
                    + {t("inventory.variants.add_value", "أضف قيمة")}
                  </button>
                </div>
              </div>
            </div>
          ))}

          <button type="button" onClick={addAttributeRow} className="text-xs font-bold text-brand hover:underline">
            + {t("inventory.variants.add_another_attribute", "إضافة سمة أخرى (مثل المقاس)")}
          </button>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={goToRows}
              disabled={!canGenerate}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand text-white font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t("inventory.variants.generate", "توليد المتغيّرات")}
              <ArrowRight size={14} className="rtl:rotate-180" />
            </button>
            <button type="button" onClick={cancelBuilder} className="px-4 py-2 rounded-lg text-content-muted font-bold text-sm hover:bg-surface">
              {t("common.cancel", "إلغاء")}
            </button>
          </div>
        </div>
      ) : isBuilding && builderStep === "rows" ? (
        <div className="p-4 rounded-xl border-2 border-brand/40 bg-brand/5 space-y-3">
          <p className="text-xs font-bold text-content-muted">
            {t("inventory.variants.rows_hint", "راجع كل سمة وعدّل SKU/السعر/المخزون قبل الحفظ.")}
          </p>
          {generatedRows.map((row) => (
            <div key={row.key} className="p-3 rounded-lg bg-surface border border-border space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-content text-sm">{row.name}</span>
                <button
                  type="button"
                  onClick={() => removeRow(row.key)}
                  className="min-w-[32px] min-h-[32px] flex items-center justify-center rounded-lg text-content-muted hover:bg-surface-muted"
                  aria-label={t("common.delete", "حذف")}
                >
                  <X size={14} />
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-content-muted uppercase px-1">SKU</label>
                  <input
                    value={row.sku}
                    onChange={(e) => updateRow(row.key, "sku", e.target.value)}
                    className="w-full px-2.5 py-2 bg-surface-muted border border-border rounded-lg text-xs font-semibold text-content text-right outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-content-muted uppercase px-1">
                    {t("inventory.barcode", "الباركود")}
                  </label>
                  <input
                    value={row.barcode}
                    onChange={(e) => updateRow(row.key, "barcode", e.target.value)}
                    className="w-full px-2.5 py-2 bg-surface-muted border border-border rounded-lg text-xs font-semibold text-content text-right outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-content-muted uppercase px-1">
                    {t("inventory.variants.price_adjustment", "فرق السعر")}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={row.priceAdjustment}
                    onChange={(e) => updateRow(row.key, "priceAdjustment", e.target.value)}
                    className="w-full px-2.5 py-2 bg-surface-muted border border-border rounded-lg text-xs font-semibold text-content text-right outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-content-muted uppercase px-1">
                    {t("inventory.variants.opening_stock", "المخزون الافتتاحي")}
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={row.openingStock}
                    onChange={(e) => updateRow(row.key, "openingStock", e.target.value)}
                    className="w-full px-2.5 py-2 bg-surface-muted border border-border rounded-lg text-xs font-semibold text-content text-right outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
                  />
                </div>
              </div>
            </div>
          ))}

          {generatedRows.length === 0 && (
            <p className="text-xs text-content-muted">{t("inventory.variants.all_rows_removed", "لم يتبقَّ أي سمة لحفظها.")}</p>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleSaveRows}
              disabled={savingRows || generatedRows.length === 0}
              className="px-4 py-2 rounded-lg bg-brand text-white font-bold text-sm disabled:opacity-50"
            >
              {savingRows ? t("common.saving", "جارٍ الحفظ...") : t("inventory.variants.save_all", "حفظ الكل")}
            </button>
            <button
              type="button"
              onClick={() => setBuilderStep("attributes")}
              className="px-4 py-2 rounded-lg text-content-muted font-bold text-sm hover:bg-surface"
            >
              {t("common.back", "رجوع")}
            </button>
            <button type="button" onClick={cancelBuilder} className="px-4 py-2 rounded-lg text-content-muted font-bold text-sm hover:bg-surface">
              {t("common.cancel", "إلغاء")}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={startBuilder}
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
