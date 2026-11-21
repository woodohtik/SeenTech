/**
 * A vertical's texts in the screen's language (seen-verticals-readiness-task.md
 * Phase 1): stages, fields, options, categories and the vertical's name carry
 * label_en / label_ur next to the Arabic. No database client here, so pure code
 * (the dashboard calculation, the order-stage helpers) can use it.
 */
import type { FieldSchema, Vertical } from '../types/expansion';

/** A row's label in the screen's language (label_en / label_ur), Arabic otherwise. */
export function localizedLabel(
  row: { label_ar: string; label_en?: string | null; label_ur?: string | null } | null | undefined,
  lang: string,
): string {
  if (!row) return '';
  if (lang === 'en' && row.label_en) return row.label_en;
  if (lang === 'ur' && row.label_ur) return row.label_ur;
  return row.label_ar;
}

/** A vertical's name in the screen's language. */
export function localizedVerticalName(v: Pick<Vertical, 'name_ar' | 'name_en' | 'name_ur'> | null | undefined, lang: string): string {
  if (!v) return '';
  if (lang === 'en' && v.name_en) return v.name_en;
  if (lang === 'ur' && v.name_ur) return v.name_ur;
  return v.name_ar;
}

/**
 * A select field's options as { value, label }: the value stays the stored
 * Arabic option, the label follows the screen's language when translated.
 */
export function localizedOptions(field: Pick<FieldSchema, 'options' | 'options_i18n'>, lang: string): { value: string; label: string }[] {
  const values = Array.isArray(field.options) ? field.options : [];
  const translated = lang === 'en' ? field.options_i18n?.en : lang === 'ur' ? field.options_i18n?.ur : undefined;
  return values.map((v, i) => ({ value: v, label: (translated && translated[i]) || v }));
}
