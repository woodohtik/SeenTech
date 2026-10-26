export interface AttributeDraft {
  name: string;
  values: string[];
}

export interface VariantCombination {
  name: string;
  options: Record<string, string>;
}

/**
 * Cartesian product of a set of attribute definitions (e.g. اللون:
 * [أزرق,أخضر] × المقاس: [S,M]) into one row per combination -- each becomes
 * one `inventory_variants` row via variantService.createVariant. Attributes
 * with a blank name or no values are dropped rather than collapsing the
 * whole product to empty.
 */
export function generateVariantCombinations(attributes: AttributeDraft[]): VariantCombination[] {
  const clean = attributes
    .map((attr) => ({
      name: attr.name.trim(),
      values: attr.values.map((v) => v.trim()).filter((v) => v.length > 0),
    }))
    .filter((attr) => attr.name.length > 0 && attr.values.length > 0);

  if (clean.length === 0) return [];

  return clean.reduce<VariantCombination[]>(
    (combos, attr) =>
      combos.flatMap((combo) =>
        attr.values.map((value) => ({
          name: combo.name ? `${combo.name} - ${value}` : value,
          options: { ...combo.options, [attr.name]: value },
        }))
      ),
    [{ name: '', options: {} }]
  );
}
