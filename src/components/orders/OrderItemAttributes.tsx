/**
 * What the customer asked for on an order line, in the shop's own fields
 * (seen-verticals-readiness-task.md Phase 3, bug 3): a sofa's wood type and
 * dimensions, a uniform's logo placement... The order form saved them in
 * order_items.attributes but no screen or print showed them, so the workshop
 * never saw them.
 *
 * Shows the vertical's fields (vertical_field_schemas) in their order, with
 * the name and select options in the screen's language; a yes/no field as
 * ✓ / ✗; empty values hidden. Keys the schema does not define (internal ones
 * such as quantityUnit) are not shown. Men's tailoring keeps its line options
 * in their own columns, so nothing new appears there.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { FieldSchema } from '../../types/expansion';
import { localizedLabel, localizedOptions } from '../../utils/verticalLabels';
import { cn } from '../../lib/utils';

export interface AttributeEntry {
  key: string;
  label: string;
  value: string;
}

/** The entries to show for one line (pure; also used by the prints). */
export function attributeEntries(
  attributes: Record<string, unknown> | null | undefined,
  fields: ReadonlyArray<FieldSchema>,
  lang: string,
): AttributeEntry[] {
  if (!attributes || typeof attributes !== 'object') return [];
  const out: AttributeEntry[] = [];
  for (const f of fields) {
    const raw = (attributes as Record<string, unknown>)[f.field_key];
    if (raw === undefined || raw === null || raw === '') continue;
    let value: string;
    if (f.field_type === 'bool') {
      value = raw === true || raw === 'true' ? '✓' : '✗';
    } else if (f.field_type === 'select') {
      const opt = localizedOptions(f, lang).find((o) => o.value === raw);
      value = opt ? opt.label : String(raw);
    } else {
      value = String(raw).trim();
      if (!value) continue;
    }
    out.push({ key: f.field_key, label: localizedLabel(f, lang), value });
  }
  return out;
}

/** The order line's specs as label: value rows. Renders nothing when there are none. */
export default function OrderItemAttributes({
  attributes,
  fields,
  className,
}: {
  attributes: Record<string, unknown> | null | undefined;
  fields: ReadonlyArray<FieldSchema>;
  className?: string;
}) {
  const { i18n } = useTranslation();
  const entries = attributeEntries(attributes, fields, i18n.language);
  if (entries.length === 0) return null;
  return (
    <dl className={cn('grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-xs font-bold', className)}>
      {entries.map((e) => (
        <div key={e.key} className="flex items-baseline gap-1.5 min-w-0">
          <dt className="text-content-muted shrink-0">{e.label}:</dt>
          <dd className="text-content truncate">{e.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The specs on one line of text ("نوع الخشب: زان · العرض (سم): 220"), for prints. */
export function lineSpecsText(
  attributes: Record<string, unknown> | null | undefined,
  fields: ReadonlyArray<FieldSchema>,
  lang: string,
): string {
  return attributeEntries(attributes, fields, lang).map((e) => `${e.label}: ${e.value}`).join(' · ');
}
