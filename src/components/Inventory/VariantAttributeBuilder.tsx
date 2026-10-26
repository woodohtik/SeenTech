import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, X } from "lucide-react";
import { generateVariantCombinations, type AttributeDraft } from "../../utils/variantCombinations";

/**
 * seen-ux-fixes-batch-task.md item 10 -- the attribute-driven variant
 * builder (name an attribute, list its values, generate one editable row
 * per combination) shared between two very different callers:
 *
 * - ProductVariantsSection (EditItemModal, an existing item): passes
 *   `onSaveAll`, which persists each row via variantService.createVariant
 *   immediately -- the item already has an id.
 * - AddItemModal (a product being created, "منتج متقدم" tab): passes
 *   `onRowsChange` instead and no `onSaveAll` -- there is no item id yet,
 *   so rows just live in the parent's own draft state until the whole
 *   add-product form is submitted, at which point the parent creates the
 *   item first and then persists these same rows itself.
 */

export interface GeneratedRow {
  key: string;
  name: string;
  options: Record<string, string>;
  sku: string;
  barcode: string;
  priceAdjustment: string;
  openingStock: string;
}

interface VariantAttributeBuilderProps {
  baseSku?: string;
  onCancel: () => void;
  /** Fires on every change to the generated rows (attribute edits that regenerate them, or a single row's own field edits) -- the draft caller's only way to know the current rows. */
  onRowsChange?: (rows: GeneratedRow[]) => void;
  /** When provided, shows a "Save all" button; must persist the rows (e.g. one createVariant call per row) and return which succeeded/failed. Omit for draft mode (no immediate persistence, no button). */
  onSaveAll?: (rows: GeneratedRow[]) => Promise<{ succeeded: GeneratedRow[]; failed: GeneratedRow[] }>;
  onSaved?: () => void;
}

let attrIdCounter = 0;
const nextAttrId = () => `attr-${++attrIdCounter}`;
const EMPTY_ATTRIBUTE = (): AttributeDraft & { id: string } => ({ id: nextAttrId(), name: "", values: [] });

export default function VariantAttributeBuilder({ baseSku, onCancel, onRowsChange, onSaveAll, onSaved }: VariantAttributeBuilderProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<"attributes" | "rows">("attributes");
  const [attributeDrafts, setAttributeDrafts] = useState<(AttributeDraft & { id: string })[]>([EMPTY_ATTRIBUTE()]);
  const [valueInputs, setValueInputs] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<GeneratedRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const setRowsAndNotify = (next: GeneratedRow[]) => {
    setRows(next);
    onRowsChange?.(next);
  };

  const goToRows = () => {
    const combos = generateVariantCombinations(attributeDrafts);
    setStep("rows");
    setRowsAndNotify(
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
  };

  const updateRow = (key: string, field: keyof GeneratedRow, value: string) =>
    setRowsAndNotify(rows.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  const removeRow = (key: string) => setRowsAndNotify(rows.filter((r) => r.key !== key));

  const handleSaveAll = async () => {
    if (!onSaveAll) return;
    const missingSku = rows.find((r) => !r.sku.trim());
    if (missingSku) {
      setError(t("inventory.variants.sku_required_for", { name: missingSku.name, defaultValue: `رمز SKU مطلوب لـ "${missingSku.name}"` }));
      return;
    }
    const skus = rows.map((r) => r.sku.trim());
    if (new Set(skus).size !== skus.length) {
      setError(t("inventory.variants.duplicate_sku", "لا يمكن تكرار نفس رمز SKU لأكثر من سمة"));
      return;
    }
    setError(null);
    setSaving(true);
    const { failed } = await onSaveAll(rows);
    setSaving(false);
    if (failed.length === 0) {
      onSaved?.();
    } else {
      setRowsAndNotify(failed);
    }
  };

  return (
    <div className="p-4 rounded-xl border-2 border-brand/40 bg-brand/5 space-y-4">
      {step === "attributes" ? (
        <>
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
                  <span key={value} className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full bg-brand/10 text-brand">
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
                  <button type="button" onClick={() => addValueToAttribute(attr.id)} className="text-xs font-bold text-brand hover:underline whitespace-nowrap">
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
            <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg text-content-muted font-bold text-sm hover:bg-surface">
              {t("common.cancel", "إلغاء")}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-xs font-bold text-content-muted">
            {t("inventory.variants.rows_hint", "راجع كل سمة وعدّل SKU/السعر/المخزون.")}
          </p>
          {error && <p className="text-xs font-bold text-danger">{error}</p>}
          {rows.map((row) => (
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
                  <label className="text-[9px] font-black text-content-muted uppercase px-1">{t("inventory.barcode", "الباركود")}</label>
                  <input
                    value={row.barcode}
                    onChange={(e) => updateRow(row.key, "barcode", e.target.value)}
                    className="w-full px-2.5 py-2 bg-surface-muted border border-border rounded-lg text-xs font-semibold text-content text-right outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-content-muted uppercase px-1">{t("inventory.variants.price_adjustment", "فرق السعر")}</label>
                  <input
                    type="number"
                    step="0.01"
                    value={row.priceAdjustment}
                    onChange={(e) => updateRow(row.key, "priceAdjustment", e.target.value)}
                    className="w-full px-2.5 py-2 bg-surface-muted border border-border rounded-lg text-xs font-semibold text-content text-right outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-content-muted uppercase px-1">{t("inventory.variants.opening_stock", "المخزون الافتتاحي")}</label>
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

          {rows.length === 0 && <p className="text-xs text-content-muted">{t("inventory.variants.all_rows_removed", "لم يتبقَّ أي سمة.")}</p>}

          <div className="flex items-center gap-2 pt-1">
            {onSaveAll && (
              <button
                type="button"
                onClick={handleSaveAll}
                disabled={saving || rows.length === 0}
                className="px-4 py-2 rounded-lg bg-brand text-white font-bold text-sm disabled:opacity-50"
              >
                {saving ? t("common.saving", "جارٍ الحفظ...") : t("inventory.variants.save_all", "حفظ الكل")}
              </button>
            )}
            <button type="button" onClick={() => setStep("attributes")} className="px-4 py-2 rounded-lg text-content-muted font-bold text-sm hover:bg-surface">
              {t("common.back", "رجوع")}
            </button>
            <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg text-content-muted font-bold text-sm hover:bg-surface">
              {t("common.cancel", "إلغاء")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
