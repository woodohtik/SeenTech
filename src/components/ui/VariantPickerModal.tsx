import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { cn } from "../../lib/utils";
import { Modal } from "./Modal";
import { InventoryItem, ProductVariant } from "../../types";

/**
 * seen-ux-fixes-batch-task.md item 10 -- shown instead of adding a product
 * straight to the POS cart when it has variants (color/size/...). Swatch
 * grid pattern matches VisualMeasurements.tsx's Section component (the
 * closest existing "pick one of several visual options" precedent in the
 * app) rather than introducing a new interaction style.
 */

interface VariantPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: InventoryItem;
  variants: ProductVariant[];
  variantStock: Record<string, number>;
  onConfirm: (variant: ProductVariant) => void;
}

export default function VariantPickerModal({ isOpen, onClose, item, variants, variantStock, onConfirm }: VariantPickerModalProps) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleConfirm = () => {
    const variant = variants.find((v) => v.id === selectedId);
    if (!variant) return;
    onConfirm(variant);
    setSelectedId(null);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        setSelectedId(null);
        onClose();
      }}
      title={item.name}
      maxWidth="lg"
      footer={
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!selectedId}
          className="w-full py-3 rounded-2xl bg-brand text-white font-black shadow-lg shadow-brand/10 hover:bg-brand/90 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {t("pos.variants.add_to_cart", "إضافة للسلة")}
        </button>
      }
    >
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {variants.map((variant) => {
          const stock = variantStock[variant.id] || 0;
          const isOut = stock <= 0;
          const isSelected = selectedId === variant.id;
          return (
            <button
              type="button"
              key={variant.id}
              disabled={isOut}
              aria-pressed={isSelected}
              onClick={() => setSelectedId(variant.id)}
              className={cn(
                "flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all relative text-center min-h-[96px]",
                isOut
                  ? "border-border bg-surface-muted/40 text-content-muted/50 cursor-not-allowed"
                  : isSelected
                  ? "border-brand bg-brand/5 text-brand shadow-sm shadow-brand/10"
                  : "border-border bg-surface text-content hover:border-brand/30 hover:bg-brand/5"
              )}
            >
              <span className="text-sm font-black">{variant.name}</span>
              <span className={cn("text-xs font-bold mt-1", isOut ? "text-danger" : "text-content-muted")}>
                {isOut ? t("pos.out_of_stock", "غير متوفر") : `${t("inventory.available", "المتاح")}: ${stock}`}
              </span>
              {isSelected && (
                <div className="absolute top-2 end-2">
                  <Check size={14} className="text-brand" strokeWidth={3} />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
