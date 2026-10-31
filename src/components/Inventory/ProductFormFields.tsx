import React from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";
import { Shirt } from "lucide-react";
import { cn } from "../../lib/utils";
import { SmartSelect } from "../ui/SmartSelect";
import { VoiceMicButton } from "../ui/VoiceMicButton";
import { isSpeechRecognitionSupported } from "../../hooks/useSpeechRecognition";
import ProductImageUploader from "./ProductImageUploader";
import { ADD_NEW_CATEGORY_VALUE, useTenantCategoryPicker } from "../../hooks/useTenantCategoryPicker";

/**
 * seen-fields-unification-task.md #4 -- حقول نموذج المنتج المشتركة بين
 * AddItemModal و EditItemModal (كانت نسخة-لصقة بين الاثنين، بثلاثة انحرافات
 * فعلية مؤكَّدة: min="0" على المخزون الافتتاحي، placeholder الباركود،
 * ومفتاح ترجمة SKU -- الثلاثة كانت أُصلِحت مباشرة في حينها، وهذا الاستخراج
 * يضمن أنها لا تنحرف مجدداً مستقبلاً لأن مصدرهما أصبح مكاناً واحداً.
 *
 * يحمل فقط حقول النموذج الفعلية (الصورة -> تبديل الظهور في POS) -- غلاف
 * النافذة (الرأس/الإغلاق) ومنطق الحفظ (handleAdd/handleUpdate) وزر/أزرار
 * التذييل يبقيان في كل مكوّن على حدة، لأنهما يختلفان فعلياً (إدراج مقابل
 * تحديث، حركة stock_ledger عند الإضافة فقط، تذييل بزرّين في التعديل).
 */

export interface ProductFormFieldsData {
  name: string;
  category: string;
  unit: string;
  conversionRate: number;
  minThreshold: number;
  pricePerUnit: number;
  costPrice: number;
  description: string;
  sku: string;
  barcode: string;
  collarType: string;
  cuffType: string;
  pocketType: string;
  chestStyle: string;
  taxType: "inclusive" | "exclusive" | "exempt";
  mainImage: string;
  showInPos: boolean;
  supplierId: string;
  openingBalance: number;
}

interface ProductFormFieldsProps {
  /** "add-item" أو "edit-item" -- يبني معرّفات الحقول (مثل add-item-name) لربط <label htmlFor>. */
  idPrefix: string;
  tenantId: string;
  formData: ProductFormFieldsData;
  setFormData: (data: ProductFormFieldsData) => void;
  fieldErrors: Record<string, boolean>;
  setFieldErrors: (errors: Record<string, boolean>) => void;
  categoryPicker: ReturnType<typeof useTenantCategoryPicker>;
  suppliersList: { id: string; name: string }[];
  handleError: (err: unknown) => void;
  /**
   * seen-fields-categories-referral-task.md #3 -- المنتجات الجديدة تُنشَأ
   * برصيد صفر دائماً الآن؛ الرصيد الحقيقي يُدخَل من أمر الشراء (نفس مكان
   * استلام أي بضاعة أخرى) لا من نموذج الإضافة. ظاهر فقط في وضع التعديل،
   * حيث لا يزال يمثّل تعديلاً يدوياً شرعياً لرصيد موجود فعلاً.
   */
  showOpeningBalance?: boolean;
}

export default function ProductFormFields({
  idPrefix,
  tenantId,
  formData,
  setFormData,
  fieldErrors,
  setFieldErrors,
  categoryPicker,
  suppliersList,
  handleError,
  showOpeningBalance = true,
}: ProductFormFieldsProps) {
  const { t } = useTranslation();
  // Unsupported browsers render VoiceMicButton as null -- without this
  // gate, the empty mic wrapper would still show as a blank bordered icon
  // box next to the name field where none existed before voice input.
  const voiceSupported = isSpeechRecognitionSupported();

  return (
    <>
      {/* Image Uploader */}
      <div className="bg-surface-muted/50 p-4 sm:p-6 rounded-2xl border border-border">
        <ProductImageUploader
          tenantId={tenantId}
          onUploadComplete={(url: string) => setFormData({ ...formData, mainImage: url })}
          initialImageUrl={formData.mainImage}
        />
      </div>

      <div className="bg-surface-muted/50 p-6 rounded-2xl border border-border">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 text-right">
          <div className="space-y-2 col-span-1 md:col-span-6 text-right">
            <label htmlFor={`${idPrefix}-name`} className="text-xs font-black text-content-muted uppercase tracking-widest mx-1 block">
              {t("inventory.item_name")}<span className="text-danger">*</span>
            </label>
            <div className="relative">
              <input
                id={`${idPrefix}-name`}
                aria-invalid={fieldErrors.name}
                value={formData.name}
                onChange={(e) => {
                  setFormData({ ...formData, name: e.target.value });
                  if (fieldErrors.name) setFieldErrors({ ...fieldErrors, name: false });
                }}
                placeholder={t("inventory.item_name_placeholder")}
                className={cn(
                  "w-full px-5 py-3 pe-10 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-brand/20 focus:border-brand outline-none font-semibold text-content text-right transition-all",
                  fieldErrors.name && "ring-2 ring-danger border-danger"
                )}
              />
              {voiceSupported && (
                <div className="absolute top-2 end-2">
                  <VoiceMicButton onResult={(text) => setFormData({ ...formData, name: text })} />
                </div>
              )}
            </div>
          </div>
          <div className="space-y-2 col-span-1 md:col-span-6 text-right">
            <label className="text-xs font-black text-content-muted uppercase tracking-widest mx-1 block">
              {t("inventory.category")}
            </label>
            <SmartSelect
              value={formData.category}
              onChange={(val) => {
                if (val === ADD_NEW_CATEGORY_VALUE) {
                  categoryPicker.setAddingNew(true);
                  return;
                }
                setFormData({ ...formData, category: val as any });
              }}
              options={[
                ...categoryPicker.options,
                { value: ADD_NEW_CATEGORY_VALUE, label: t("settings_page.categories.add_new", "+ إضافة فئة جديدة") },
              ]}
              className="text-right"
            />
            {categoryPicker.addingNew && (
              <div className="flex items-center gap-2 mt-2 p-2.5 rounded-xl border-2 border-brand/40 bg-brand/5">
                <input
                  autoFocus
                  value={categoryPicker.newLabel}
                  onChange={(e) => categoryPicker.setNewLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      categoryPicker.confirmAdd((key) => setFormData({ ...formData, category: key as any })).catch(handleError);
                    }
                    if (e.key === "Escape") categoryPicker.cancelAdd();
                  }}
                  placeholder={t("settings_page.categories.new_name_placeholder", "اسم الفئة الجديدة")}
                  className="flex-1 bg-transparent outline-none font-bold text-content text-sm placeholder:text-content-muted/60"
                />
                <button
                  type="button"
                  onClick={() => categoryPicker.confirmAdd((key) => setFormData({ ...formData, category: key as any })).catch(handleError)}
                  disabled={!categoryPicker.newLabel.trim() || categoryPicker.saving}
                  className="min-h-[32px] px-3 rounded-lg bg-brand text-white font-bold text-xs disabled:opacity-50"
                >
                  {t("common.add", "إضافة")}
                </button>
                <button
                  type="button"
                  onClick={categoryPicker.cancelAdd}
                  className="min-h-[32px] px-2 rounded-lg text-content-muted font-bold text-xs hover:bg-surface"
                >
                  {t("common.cancel", "إلغاء")}
                </button>
              </div>
            )}
          </div>
          <div className="space-y-2 col-span-1 md:col-span-12 text-right">
            <label htmlFor={`${idPrefix}-description`} className="text-xs font-black text-content-muted uppercase tracking-widest mx-1 block">
              {t("inventory.description_label")}
            </label>
            <textarea
              id={`${idPrefix}-description`}
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder={t("inventory.description_placeholder")}
              className="w-full px-5 py-3 bg-surface border border-border rounded-xl outline-none transition-all focus:ring-2 focus:ring-brand/20 focus:border-brand font-semibold text-content resize-none h-16 text-right"
            />
          </div>
        </div>
      </div>

      <AnimatePresence>
        {formData.category === "ready_made" && (
          <motion.div
            initial={{ height: 0, opacity: 0, overflow: "hidden" }}
            animate={{ height: "auto", opacity: 1, transitionEnd: { overflow: "visible" } }}
            exit={{ height: 0, opacity: 0, overflow: "hidden" }}
          >
            <div className="bg-brand/5 p-6 rounded-2xl border border-brand/10 space-y-6">
              <div className="flex items-center gap-2 mb-2">
                <Shirt className="text-brand" size={18} />
                <h3 className="text-sm font-black text-content uppercase tracking-widest text-brand">
                  {t("inventory.specs_ready_made")}
                </h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 text-right">
                <div className="space-y-2 col-span-1 md:col-span-6 text-right">
                  <label className="text-xs font-black text-content-muted uppercase tracking-widest mx-1 block">
                    {t("inventory.collar_type")}
                  </label>
                  <SmartSelect
                    value={formData.collarType}
                    onChange={(val) => setFormData({ ...formData, collarType: val })}
                    options={[
                      { value: "", label: t("inventory.collar_default") },
                      { value: "qatari", label: t("inventory.collar_qatari") },
                      { value: "kuwaiti", label: t("inventory.collar_kuwaiti") },
                      { value: "saudi", label: t("inventory.collar_saudi") },
                      { value: "marini", label: t("inventory.collar_marini") },
                    ]}
                    className="text-right"
                  />
                </div>
                <div className="space-y-2 col-span-1 md:col-span-6 text-right">
                  <label className="text-xs font-black text-content-muted uppercase tracking-widest mx-1 block">
                    {t("inventory.cuff_type")}
                  </label>
                  <SmartSelect
                    value={formData.cuffType}
                    onChange={(val) => setFormData({ ...formData, cuffType: val })}
                    options={[
                      { value: "", label: t("inventory.collar_default") },
                      { value: "regular", label: t("inventory.cuff_regular") },
                      { value: "double", label: t("inventory.cuff_double") },
                      { value: "french", label: t("inventory.cuff_french") },
                    ]}
                    className="text-right"
                  />
                </div>
                <div className="space-y-2 col-span-1 md:col-span-6 text-right">
                  <label className="text-xs font-black text-content-muted uppercase tracking-widest mx-1 block">
                    {t("inventory.pocket_type")}
                  </label>
                  <SmartSelect
                    value={formData.pocketType}
                    onChange={(val) => setFormData({ ...formData, pocketType: val })}
                    options={[
                      { value: "", label: t("inventory.collar_default") },
                      { value: "hidden", label: t("inventory.pocket_hidden") },
                      { value: "visible", label: t("inventory.pocket_visible") },
                      { value: "none", label: t("inventory.pocket_none") },
                    ]}
                    className="text-right"
                  />
                </div>
                <div className="space-y-2 col-span-1 md:col-span-6 text-right">
                  <label className="text-xs font-black text-content-muted uppercase tracking-widest mx-1 block">
                    {t("inventory.chest_style")}
                  </label>
                  <SmartSelect
                    value={formData.chestStyle}
                    onChange={(val) => setFormData({ ...formData, chestStyle: val })}
                    options={[
                      { value: "", label: t("inventory.collar_default") },
                      { value: "plain", label: t("inventory.chest_plain") },
                      { value: "pleated", label: t("inventory.chest_pleated") },
                      { value: "embroided", label: t("inventory.chest_embroided") },
                    ]}
                    className="text-right"
                  />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="bg-surface-muted/50 p-6 rounded-2xl border border-border">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 text-right">
          <div className="space-y-2 col-span-1 md:col-span-4 text-right">
            <label className="text-xs font-black text-content-muted uppercase tracking-widest mx-1 block">
              {t("inventory.unit")}
            </label>
            <SmartSelect
              value={formData.unit}
              onChange={(val) => setFormData({ ...formData, unit: val as any })}
              options={[
                { value: "meter", label: t("inventory.unit_meter") },
                { value: "yard", label: t("inventory.unit_yard") },
                { value: "roll", label: t("inventory.unit_roll") },
                { value: "bolt", label: t("inventory.unit_bolt") },
                { value: "piece", label: t("inventory.unit_piece") },
                { value: "box", label: t("inventory.unit_box") },
              ]}
              className="text-right"
            />
          </div>
          <div className="space-y-2 col-span-1 md:col-span-4 text-right">
            <label htmlFor={`${idPrefix}-conversion-rate`} className="text-xs font-black text-content-muted uppercase tracking-widest mx-1 block">
              {t("inventory.conversion_rate")}<span className="text-danger">*</span>
            </label>
            <input
              id={`${idPrefix}-conversion-rate`}
              type="number"
              step="0.01"
              aria-invalid={fieldErrors.conversionRate}
              value={formData.conversionRate}
              onChange={(e) => {
                setFormData({ ...formData, conversionRate: Number(e.target.value) });
                if (fieldErrors.conversionRate) setFieldErrors({ ...fieldErrors, conversionRate: false });
              }}
              className={cn(
                "w-full px-5 py-3 bg-surface border border-border rounded-xl outline-none transition-all focus:ring-2 focus:ring-brand/20 focus:border-brand font-semibold text-content text-right",
                fieldErrors.conversionRate && "ring-2 ring-danger border-danger"
              )}
            />
          </div>
          <div className="space-y-2 col-span-1 md:col-span-4 text-right">
            <label htmlFor={`${idPrefix}-min-threshold`} className="text-xs font-black text-content-muted uppercase tracking-widest mx-1 block">
              {t("inventory.min_threshold")}
            </label>
            <input
              id={`${idPrefix}-min-threshold`}
              type="number"
              required
              value={formData.minThreshold}
              onChange={(e) => setFormData({ ...formData, minThreshold: Number(e.target.value) })}
              className="w-full px-5 py-3 bg-surface border border-border rounded-xl font-semibold text-content text-right outline-none transition-all focus:ring-2 focus:ring-brand/20 focus:border-brand"
            />
          </div>
        </div>
      </div>

      <div className="bg-surface-muted/50 p-6 rounded-2xl border border-border">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 text-right">
          <div className="space-y-2 col-span-1 md:col-span-3 text-right">
            <label htmlFor={`${idPrefix}-cost-price`} className="text-xs font-black text-content-muted uppercase tracking-widest mx-1 block">
              {t("inventory.cost_price_label")}<span className="text-danger">*</span>
            </label>
            <input
              id={`${idPrefix}-cost-price`}
              type="number"
              step="0.01"
              aria-invalid={fieldErrors.costPrice}
              value={formData.costPrice || ""}
              onChange={(e) => {
                setFormData({ ...formData, costPrice: e.target.value === "" ? 0 : Number(e.target.value) });
                if (fieldErrors.costPrice) setFieldErrors({ ...fieldErrors, costPrice: false });
              }}
              placeholder="0.00"
              className={cn(
                "w-full px-5 py-3 bg-surface border border-border rounded-xl outline-none transition-all focus:ring-2 focus:ring-brand/20 focus:border-brand font-semibold text-content text-right",
                fieldErrors.costPrice && "ring-2 ring-danger border-danger"
              )}
            />
          </div>

          <div className="space-y-2 col-span-1 md:col-span-3 text-right">
            <label htmlFor={`${idPrefix}-selling-price`} className="text-xs font-black text-content-muted uppercase tracking-widest mx-1 block">
              {t("inventory.selling_price_label")}<span className="text-danger">*</span>
            </label>
            <input
              id={`${idPrefix}-selling-price`}
              type="number"
              step="0.01"
              aria-invalid={fieldErrors.pricePerUnit}
              value={formData.pricePerUnit || ""}
              onChange={(e) => {
                setFormData({ ...formData, pricePerUnit: e.target.value === "" ? 0 : Number(e.target.value) });
                if (fieldErrors.pricePerUnit) setFieldErrors({ ...fieldErrors, pricePerUnit: false });
              }}
              placeholder="0.00"
              className={cn(
                "w-full px-5 py-3 bg-surface border border-border rounded-xl outline-none transition-all focus:ring-2 focus:ring-brand/20 focus:border-brand font-semibold text-content text-right",
                fieldErrors.pricePerUnit && "ring-2 ring-danger border-danger"
              )}
            />
          </div>

          <div className="space-y-2 col-span-1 md:col-span-6 text-right">
            <label className="text-xs font-black text-content-muted uppercase tracking-widest mx-1 block">
              {t("inventory.tax_status_label")}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: "inclusive", label: t("inventory.tax_inclusive"), desc: "VAT Inclusive (15%)" },
                { id: "exclusive", label: t("inventory.tax_exclusive"), desc: "VAT Exclusive (+15%)" },
                { id: "exempt", label: t("inventory.tax_exempt"), desc: "VAT Exempt (0%)" },
              ].map((tax) => (
                <button
                  key={tax.id}
                  type="button"
                  onClick={() => setFormData({ ...formData, taxType: tax.id as any })}
                  className={cn(
                    "flex flex-col items-center justify-center p-2 rounded-xl border-2 transition-all text-center h-[52px]",
                    formData.taxType === tax.id
                      ? "bg-brand/10 border-brand text-brand"
                      : "bg-surface border-transparent text-content-muted hover:bg-surface-muted"
                  )}
                >
                  <span className="text-xs font-black leading-tight">{tax.label}</span>
                  <span className="text-[8px] font-bold opacity-70 leading-none">{tax.desc}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-brand/5 p-6 rounded-2xl border border-brand/10 text-right">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 text-right">
          <div className={cn("space-y-2 col-span-1", showOpeningBalance ? "md:col-span-6" : "md:col-span-12")}>
            <label className="text-xs font-black text-content uppercase tracking-widest mx-1 block">
              {t("inventory.supplier_label")}
            </label>
            <SmartSelect
              value={formData.supplierId}
              onChange={(val) => setFormData({ ...formData, supplierId: val })}
              options={[
                { value: "", label: t("inventory.select_supplier") },
                ...suppliersList.map((s) => ({ value: s.id, label: s.name })),
              ]}
              className="text-right"
            />
          </div>
          {showOpeningBalance && (
            <div className="space-y-2 col-span-1 md:col-span-6">
              <label htmlFor={`${idPrefix}-initial-stock`} className="text-xs font-black text-content uppercase tracking-widest mx-1 block">
                {t("inventory.initial_stock")}
              </label>
              <input
                id={`${idPrefix}-initial-stock`}
                type="number"
                min="0"
                placeholder="0.00"
                value={formData.openingBalance || ""}
                onChange={(e) => setFormData({ ...formData, openingBalance: e.target.value === "" ? 0 : Number(e.target.value) })}
                className="w-full px-5 py-3 bg-surface border border-border rounded-xl font-semibold text-content text-right outline-none transition-all focus:ring-2 focus:ring-brand/20 focus:border-brand"
              />
            </div>
          )}
        </div>
      </div>

      <div className="bg-surface-muted/50 p-6 rounded-2xl border border-border">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 text-right">
          <div className="space-y-2 col-span-1 md:col-span-6">
            <label htmlFor={`${idPrefix}-sku`} className="text-xs font-black text-content-muted uppercase tracking-widest mx-1 block">
              {t("inventory.ref_sku")}
            </label>
            <input
              id={`${idPrefix}-sku`}
              placeholder={t("inventory.sku_placeholder")}
              value={formData.sku}
              onChange={(e) => setFormData({ ...formData, sku: e.target.value.replace(/\D/g, "") })}
              className="w-full px-5 py-3 bg-surface border border-border rounded-xl font-semibold text-content text-right outline-none transition-all focus:ring-2 focus:ring-brand/20 focus:border-brand"
            />
          </div>
          <div className="space-y-2 col-span-1 md:col-span-6">
            <label htmlFor={`${idPrefix}-barcode`} className="text-xs font-black text-content-muted uppercase tracking-widest mx-1 block">
              {t("inventory.barcode")}
            </label>
            <input
              id={`${idPrefix}-barcode`}
              placeholder="Barcode (Auto)"
              value={formData.barcode}
              onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
              className="w-full px-5 py-3 bg-surface border border-border rounded-xl font-semibold text-content text-right outline-none transition-all focus:ring-2 focus:ring-brand/20 focus:border-brand"
            />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between p-6 bg-brand/5 rounded-2xl border border-brand/10">
        <div>
          <h4 className="text-sm font-black text-content">{t("inventory.visible_in_pos")}</h4>
          <p className="text-xs text-content-muted">{t("inventory.show_in_pos_desc")}</p>
        </div>
        <button
          type="button"
          onClick={() => setFormData({ ...formData, showInPos: !formData.showInPos })}
          className={cn(
            "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2",
            formData.showInPos ? "bg-brand" : "bg-border"
          )}
        >
          <span
            className={cn(
              "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
              formData.showInPos ? "translate-x-5 rtl:-translate-x-5" : "translate-x-0"
            )}
          />
        </button>
      </div>
    </>
  );
}
