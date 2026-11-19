import { mapCategoryKeyToLegacyCategory } from "../services/verticalService";
import { ContentUnit, METERS_PER_YARD, contentToMeters, metersToContent } from "./fabricUomConverter";

/** The unit-related fields of the item form (add, edit, and the purchase-order quick add). */
export interface ItemUnitForm {
  category: string;
  unit: string;
  conversionRate: number;
  /** Roll content as the shop typed it, in `contentUnit`. */
  rollContent: number;
  contentUnit: ContentUnit;
}

export const isFabricCategory = (categoryKey: string) =>
  mapCategoryKeyToLegacyCategory(categoryKey) === "fabric";

const isRollUnit = (unit: string) => unit === "roll" || unit === "bolt";

/** Whether the form must collect a roll content for this category/unit. */
export const needsRollContent = (form: Pick<ItemUnitForm, "category" | "unit">) =>
  isFabricCategory(form.category) && isRollUnit(form.unit);

/** Form defaults for a stored item: its roll content shown back in the unit it was typed in. */
export function unitFieldsFromItem(item: { conversion_rate?: number | string | null; content_unit?: string | null }) {
  const contentUnit: ContentUnit = item.content_unit === "yard" ? "yard" : "meter";
  const rate = Number(item.conversion_rate) || 1;
  return { conversionRate: rate, contentUnit, rollContent: metersToContent(rate, contentUnit) };
}

/** The columns the unit fields resolve to. conversion_rate is always meters per unit. */
export function resolveUnitColumns(
  form: ItemUnitForm
): {
  conversion_rate: number;
  content_unit: ContentUnit | null;
  base_unit: "meter" | "piece";
} {
  if (!isFabricCategory(form.category)) {
    // Non-fabric items never ask for a rate; an existing one keeps what it had.
    const measured = ["meter", "yard", "roll", "bolt"].includes(form.unit);
    return { conversion_rate: Number(form.conversionRate) || 1, content_unit: null, base_unit: measured ? "meter" : "piece" };
  }
  if (isRollUnit(form.unit)) {
    return {
      conversion_rate: contentToMeters(Number(form.rollContent), form.contentUnit),
      content_unit: form.contentUnit,
      base_unit: "meter",
    };
  }
  if (form.unit === "yard") return { conversion_rate: METERS_PER_YARD, content_unit: "yard", base_unit: "meter" };
  return { conversion_rate: 1, content_unit: null, base_unit: "meter" };
}
