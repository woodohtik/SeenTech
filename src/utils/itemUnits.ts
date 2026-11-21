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

/**
 * Categories measured by length (metre / yard / roll) for the current shop:
 * the `measure_kind = 'length'` categories of its vertical
 * (seen-verticals-readiness-task.md Phase 1), set by VerticalConfigProvider
 * once the settings are loaded. Until then -- and for men's tailoring, whose
 * only length category is `fabric` -- the old rule: `fabric` only.
 */
let lengthCategoryKeys: ReadonlySet<string> = new Set(["fabric"]);

export function setLengthCategories(categories: ReadonlyArray<{ category_key: string; measure_kind?: string | null }>): void {
  const keys = categories.filter((c) => c.measure_kind === "length").map((c) => c.category_key);
  lengthCategoryKeys = new Set(keys.length > 0 ? keys : ["fabric"]);
}

/**
 * Whether a category is sold / stocked by length. An explicit list (with
 * measure_kind) decides when it knows the key; otherwise the shop's length
 * categories; otherwise the old rule (the legacy `fabric` category).
 */
export function isLengthCategory(
  categoryKey: string,
  categories?: ReadonlyArray<{ category_key: string; measure_kind?: string | null }>,
): boolean {
  const known = categories?.find((c) => c.category_key === categoryKey);
  if (known?.measure_kind) return known.measure_kind === "length";
  if (lengthCategoryKeys.has(categoryKey)) return true;
  return mapCategoryKeyToLegacyCategory(categoryKey) === "fabric";
}

/** An inventory item measured by length: its legacy category is fabric, or its category_key is a length category. */
export function isLengthItem(item: { category?: string | null; category_key?: string | null; categoryKey?: string | null }): boolean {
  if (item.category === "fabric") return true;
  const key = item.category_key || item.categoryKey;
  return !!key && isLengthCategory(key);
}

/** Kept for the existing callers: the same as isLengthCategory. */
export const isFabricCategory = (categoryKey: string) => isLengthCategory(categoryKey);

/** The shop's length category keys (for queries such as the order form's fabric list). */
export function lengthCategoryKeyList(): string[] {
  return Array.from(lengthCategoryKeys);
}

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
