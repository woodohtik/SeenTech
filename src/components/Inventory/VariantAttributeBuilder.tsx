import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, X } from "lucide-react";
import { generateVariantCombinations, type AttributeDraft } from "../../utils/variantCombinations";
import { applyImageToSameValue, colorAttributeName, followProductPrice } from "../../utils/variantRows";
import { VariantImagePicker } from "./VariantImagePicker";

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
  /**
   * seen-product-variants-barcode-po-price-task.md: the variant's price --
   * starts as the product's and follows it until changed by hand
   * (priceTouched), then it is the variant's own ("special price"). No
   * barcode field: every variant gets one generated when saved.
   */
  price: string;
  priceTouched: boolean;
  imageUrl: string;
}

interface VariantAttributeBuilderProps {
  baseSku?: string;
  onCancel: () => void;
  /** Fires on every change to the generated rows (attribute edits that regenerate them, or a single row's own field edits) -- the draft caller's only way to know the current rows. */
  onRowsChange?: (rows: GeneratedRow[]) => void;
  /** When provided, shows a "Save all" button; must persist the rows (e.g. one createVariant call per row) and return which succeeded/failed. Omit for draft mode (no immediate persistence, no button). */
  onSaveAll?: (rows: GeneratedRow[]) => Promise<{ succeeded: GeneratedRow[]; failed: GeneratedRow[] }>;
  onSaved?: () => void;
  /** The product's selling price -- the rows' starting price, followed until a row is changed. */
  basePrice?: number;
  /** For the variant photos' folder; without it no photo square is shown. */
  tenantId?: string;
  /** The product has an opening balance being entered, so "starts at zero" is not true. */
  hasOpeningBalance?: boolean;
}

let attrIdCounter = 0;
const nextAttrId = () => `attr-${++attrIdCounter}`;
const EMPTY_ATTRIBUTE = (): AttributeDraft & { id: string } => ({ id: nextAttrId(), name: "", values: [] });

/** Mirrors InventoryManager's own generateSKU() fallback for the base item's SKU field when left blank -- a variant row deserves the same "optional, not required" treatment. */
const generateFallbackSku = () => Math.floor(10000000 + Math.random() * 90000000).toString();

/** The first attribute a merchant adds is almost always color, the second almost always size -- show examples matching what they're actually about to type instead of always suggesting "اللون". */
const ATTRIBUTE_NAME_EXAMPLES = ["اللون", "المقاس"];
const ATTRIBUTE_VALUE_EXAMPLES = ["أزرق", "M"];
const attributeNamePlaceholder = (index: number) =>
  ATTRIBUTE_NAME_EXAMPLES[index] ? `اسم السمة، مثلاً: ${ATTRIBUTE_NAME_EXAMPLES[index]}` : "اسم السمة";
const attributeValuePlaceholder = (index: number) =>
  ATTRIBUTE_VALUE_EXAMPLES[index] ? `قيمة، مثلاً: ${ATTRIBUTE_VALUE_EXAMPLES[index]}` : "قيمة";

export default function VariantAttributeBuilder({ baseSku, onCancel, onRowsChange, onSaveAll, onSaved, basePrice = 0, tenantId, hasOpeningBalance = false }: VariantAttributeBuilderProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<"attributes" | "rows">("attributes");
  const [attributeDrafts, setAttributeDrafts] = useState<(AttributeDraft & { id: string })[]>([EMPTY_ATTRIBUTE()]);
  const [valueInputs, setValueInputs] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<GeneratedRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only meaningful in draft mode (no onSaveAll): there is nothing to persist
  // here yet, so this is just a "looks right, I'm done" acknowledgement --
  // the actual save happens when the caller's own outer form is submitted.
  const [draftConfirmed, setDraftConfirmed] = useState(false);

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
    setDraftConfirmed(false);
    setRowsAndNotify(
      combos.map((combo, index) => ({
        key: `row-${index}`,
        name: combo.name,
        options: combo.options,
        // Always pre-fill a usable SKU -- when there's no base-item SKU to
        // suffix (merchant left that field blank, auto-generated at save)
        // a blank suggestion here read as "missing" rather than "optional",
        // which is exactly what caused "رمز SKU مطلوب" surprising someone
        // who never typed a base SKU in the first place.
        sku: baseSku ? `${baseSku}-${index + 1}` : generateFallbackSku(),
        price: String(Number(basePrice) || 0),
        priceTouched: false,
        imageUrl: "",
      }))
    );
  };

  // The product's price changed above: rows not changed by hand follow it.
  useEffect(() => {
    if (rows.length === 0) return;
    const next = followProductPrice(rows, basePrice);
    if (next.some((r, i) => r !== rows[i])) setRowsAndNotify(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basePrice]);

  const photoAttribute = colorAttributeName(attributeDrafts);
  const setRowPrice = (key: string, price: string) => {
    setDraftConfirmed(false);
    setRowsAndNotify(rows.map((r) => (r.key === key ? { ...r, price, priceTouched: true } : r)));
  };
  const resetRowPrice = (key: string) => {
    setDraftConfirmed(false);
    setRowsAndNotify(rows.map((r) => (r.key === key ? { ...r, price: String(Number(basePrice) || 0), priceTouched: false } : r)));
  };
  const setRowImage = (key: string, imageUrl: string) => {
    setDraftConfirmed(false);
    setRowsAndNotify(rows.map((r) => (r.key === key ? { ...r, imageUrl } : r)));
  };
  const shareRowImage = (key: string) => {
    if (!photoAttribute) return;
    setRowsAndNotify(applyImageToSameValue(rows, key, photoAttribute));
  };

  const updateRow = (key: string, field: keyof GeneratedRow, value: string) => {
    setDraftConfirmed(false);
    setRowsAndNotify(rows.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  };
  const removeRow = (key: string) => {
    setDraftConfirmed(false);
    setRowsAndNotify(rows.filter((r) => r.key !== key));
  };

  /** Prevent Enter in any of this builder's own inputs from submitting a caller's outer <form> (AddItemModal wraps this in one) before the merchant is done. */
  const blockEnterSubmit = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.preventDefault();
  };

  const handlePrimaryAction = async () => {
    // A row left blank gets a random fallback instead of blocking --
    // goToRows already pre-fills one, but a row added/edited afterward (or
    // one the merchant cleared by hand) could still be empty here.
    let effectiveRows = rows;
    if (rows.some((r) => !r.sku.trim())) {
      const used = new Set(rows.map((r) => r.sku.trim()).filter(Boolean));
      effectiveRows = rows.map((r) => {
        if (r.sku.trim()) return r;
        let candidate = generateFallbackSku();
        while (used.has(candidate)) candidate = generateFallbackSku();
        used.add(candidate);
        return { ...r, sku: candidate };
      });
      setRowsAndNotify(effectiveRows);
    }

    const skus = effectiveRows.map((r) => r.sku.trim());
    if (new Set(skus).size !== skus.length) {
      setError(t("inventory.variants.duplicate_sku", "لا يمكن تكرار نفس رمز SKU لأكثر من سمة"));
      return;
    }
    setError(null);

    if (!onSaveAll) {
      // Draft mode: nothing to persist yet -- just acknowledge so the
      // merchant knows these rows are ready and where to actually save.
      setDraftConfirmed(true);
      return;
    }

    setSaving(true);
    const { failed } = await onSaveAll(effectiveRows);
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
          {attributeDrafts.map((attr, attrIndex) => (
            <div key={attr.id} className="space-y-2 p-3 rounded-lg bg-surface border border-border">
              <div className="flex items-center gap-2">
                <input
                  value={attr.name}
                  onChange={(e) => updateAttributeName(attr.id, e.target.value)}
                  onKeyDown={blockEnterSubmit}
                  placeholder={t("inventory.variants.attribute_name_placeholder", attributeNamePlaceholder(attrIndex))}
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
                  <span key={value} className="flex items-center gap-1.5 text-sm font-bold px-3 py-1.5 rounded-full bg-brand/10 text-brand">
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
                    placeholder={t("inventory.variants.value_placeholder", attributeValuePlaceholder(attrIndex))}
                    className="w-32 px-3 py-1.5 bg-surface-muted border border-border rounded-full text-sm font-semibold text-content text-right outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
                  />
                  <button type="button" onClick={() => addValueToAttribute(attr.id)} className="text-sm font-bold text-brand hover:underline whitespace-nowrap">
                    + {t("inventory.variants.add_value", "أضف قيمة")}
                  </button>
                </div>
              </div>
            </div>
          ))}

          <button type="button" onClick={addAttributeRow} className="text-sm font-bold text-brand hover:underline">
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
          <p className="text-sm font-bold text-content-muted">
            {t("inventory.variants.rows_hint", "راجع كل سمة وعدّل SKU/السعر/المخزون.")}
          </p>
          {!onSaveAll && (
            <p className="text-sm font-bold text-brand bg-brand/10 p-2.5 rounded-lg">
              {t(
                "inventory.variants.draft_save_hint",
                "هذه السمات ستُحفظ تلقائياً مع المنتج عند الضغط على زر \"حفظ المنتج\" بالأسفل -- لا حاجة لحفظها هنا بشكل منفصل."
              )}
            </p>
          )}
          {error && <p className="text-sm font-bold text-danger">{error}</p>}
          {draftConfirmed && !error && (
            <p className="text-sm font-bold text-success">
              {t("inventory.variants.draft_confirmed", "✓ جاهزة. أكمل حفظ المنتج بالأسفل لإتمام الإضافة.")}
            </p>
          )}
          {rows.map((row) => (
            <div key={row.key} className="p-3 rounded-lg bg-surface border border-border space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                  {tenantId && (
                    <VariantImagePicker tenantId={tenantId} value={row.imageUrl} label={row.name} onChange={(url) => setRowImage(row.key, url)} />
                  )}
                  <span className="font-bold text-content text-sm">{row.name}</span>
                  {row.imageUrl && photoAttribute && row.options[photoAttribute] && rows.length > 1 && (
                    <button type="button" onClick={() => shareRowImage(row.key)} className="min-h-11 px-2 text-sm font-bold text-brand hover:underline">
                      {t("inventory.variants.same_photo_for", { value: row.options[photoAttribute] })}
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => removeRow(row.key)}
                  className="min-w-[32px] min-h-[32px] flex items-center justify-center rounded-lg text-content-muted hover:bg-surface-muted"
                  aria-label={t("common.delete", "حذف")}
                >
                  <X size={14} />
                </button>
              </div>
              <div className="grid grid-cols-1 main-640:grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-sm font-black text-content-muted uppercase px-1">SKU</label>
                  <input
                    value={row.sku}
                    onChange={(e) => updateRow(row.key, "sku", e.target.value)}
                    onKeyDown={blockEnterSubmit}
                    className="w-full px-2.5 py-2 bg-surface-muted border border-border rounded-lg text-sm font-semibold text-content text-right outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
                  />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2 px-1">
                    <label htmlFor={`variant-price-${row.key}`} className="text-sm font-black text-content-muted">{t("inventory.variants.price")}</label>
                    {row.priceTouched && Number(row.price) !== Number(basePrice) && (
                      <span className="text-sm font-bold text-brand">{t("inventory.variants.special_price")}</span>
                    )}
                  </div>
                  <input
                    id={`variant-price-${row.key}`}
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={row.price}
                    onChange={(e) => setRowPrice(row.key, e.target.value)}
                    onKeyDown={blockEnterSubmit}
                    className="w-full px-2.5 py-2 bg-surface-muted border border-border rounded-lg text-sm font-semibold text-content text-right outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
                  />
                  {row.priceTouched && Number(row.price) !== Number(basePrice) && (
                    <button type="button" onClick={() => resetRowPrice(row.key)} className="min-h-11 px-1 text-sm font-bold text-content-muted hover:text-brand">
                      {t("inventory.variants.back_to_product_price")}
                    </button>
                  )}
                </div>
              </div>
              {!hasOpeningBalance && (
                <p className="text-sm text-content-muted px-1">
                  {t("inventory.variants.stock_via_po_hint", "المخزون يُضاف لاحقاً عبر أمر شراء -- هذه السمة تُنشأ برصيد صفر.")}
                </p>
              )}
            </div>
          ))}

          {rows.length === 0 && <p className="text-sm text-content-muted">{t("inventory.variants.all_rows_removed", "لم يتبقَّ أي سمة.")}</p>}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handlePrimaryAction}
              disabled={saving || rows.length === 0}
              className="px-4 py-2 rounded-lg bg-brand text-white font-bold text-sm disabled:opacity-50"
            >
              {saving
                ? t("common.saving", "جارٍ الحفظ...")
                : onSaveAll
                ? t("inventory.variants.save_all", "حفظ الكل")
                : t("inventory.variants.confirm_rows", "تم ✓")}
            </button>
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
