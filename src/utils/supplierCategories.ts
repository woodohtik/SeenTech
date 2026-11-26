/**
 * A supplier's categories (seen-merchant-trial-test-2026-11-26.md, phase 3
 * item 4): `category` is the main one; `extra_categories` the rest.
 */

/** The PostgREST `or` filter that finds a supplier by either. */
export function supplierCategoryFilter(key: string): string {
  return `category.eq.${key},extra_categories.cs.{${key}}`;
}

/** All of a supplier's categories, the main one first, once each. */
export function supplierCategories(s: { category?: string | null; extra_categories?: string[] | null }): string[] {
  return Array.from(new Set([s.category, ...(s.extra_categories || [])].filter((c): c is string => !!c)));
}

/** Tick or untick an extra category; the main one is never an extra. */
export function toggleExtraCategory(extra: string[], key: string, main: string | null | undefined): string[] {
  if (key === main) return extra.filter((k) => k !== key);
  return extra.includes(key) ? extra.filter((k) => k !== key) : [...extra, key];
}
