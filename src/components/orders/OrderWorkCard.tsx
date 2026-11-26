/**
 * A work card for the workshop (seen-verticals-readiness-task.md Phase 3):
 * what to make for one order -- each line with its quantity, its fabric when
 * the vertical uses fabric, and every spec the customer asked for in the
 * shop's own fields. Printed from the order details. For men's tailoring
 * (seen-measurements-basic-advanced-task.md, question 6) it carries the body
 * measurements and the tailor's note on each -- the customer's receipt never
 * does.
 *
 * Rendered inside a hidden wrapper; printManager prints a copy of the element
 * with this id, so the copy is not hidden.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { FieldSchema, WorkflowStage } from '../../types/expansion';
import { attributeEntries } from './OrderItemAttributes';
import { getStageLabel } from '../../utils/orderStage';

import { localeOf } from '../../lib/direction';
export const WORK_CARD_ELEMENT_ID = 'order-work-card-print-area';

export interface WorkCardOrder {
  orderNumber?: string | number | null;
  id: string;
  customerName?: string | null;
  deliveryDate?: string | null;
  status?: string | null;
  notes?: string | null;
  items: Array<{
    garmentType?: string; name?: string; quantity?: number; fabric?: string;
    attributes?: Record<string, unknown> | null;
  }>;
}

/** One body measurement on the card: its name, its value as printed (to the quarter), and the tailor's note. */
export interface WorkCardMeasurement { key: string; label: string; value: string; note: string }

export default function OrderWorkCard({
  order, shopName, fields, stages, showFabric, measurements = [], images = [],
}: {
  order: WorkCardOrder;
  shopName: string;
  fields: ReadonlyArray<FieldSchema>;
  stages: ReadonlyArray<WorkflowStage>;
  showFabric: boolean;
  measurements?: ReadonlyArray<WorkCardMeasurement>;
  /** The order's photos as links (seen-order-images-upload-task.md, phase 4). */
  images?: ReadonlyArray<string>;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const dir = lang === 'en' ? 'ltr' : 'rtl';
  const number = order.orderNumber || order.id.slice(-6).toUpperCase();
  return (
    <div id={WORK_CARD_ELEMENT_ID} dir={dir} style={{ fontFamily: 'inherit', color: '#0f172a', padding: 8, fontSize: 12 }}>
      <div style={{ textAlign: 'center', borderBottom: '1px dashed #94a3b8', paddingBottom: 6, marginBottom: 6 }}>
        <div style={{ fontWeight: 900, fontSize: 14 }}>{shopName}</div>
        <div style={{ fontWeight: 800 }}>{t('orders.work_card_title', 'بطاقة عمل')} #{number}</div>
      </div>
      <div style={{ display: 'grid', gap: 2, marginBottom: 6 }}>
        {order.customerName && <div><b>{t('common.customer', 'العميل')}:</b> {order.customerName}</div>}
        {order.deliveryDate && <div><b>{t('orders.work_card_delivery', 'تاريخ التسليم')}:</b> {new Date(order.deliveryDate).toLocaleDateString(localeOf(lang))}</div>}
        {order.status && <div><b>{t('common.status', 'الحالة')}:</b> {getStageLabel(order.status, stages, lang)}</div>}
      </div>
      {order.items.map((item, idx) => {
        const entries = attributeEntries(item.attributes, fields, lang);
        return (
          <div key={idx} style={{ borderTop: '1px solid #cbd5e1', paddingTop: 4, marginTop: 4 }}>
            <div style={{ fontWeight: 900 }}>
              {idx + 1}. {item.garmentType || item.name} × {item.quantity ?? 1}
            </div>
            {showFabric && item.fabric && (
              <div><b>{t('orders.fabric', 'القماش')}:</b> {item.fabric === 'custom' ? t('orders.external_fabric') : item.fabric}</div>
            )}
            {entries.map((e) => (
              <div key={e.key}><b>{e.label}:</b> {e.value}</div>
            ))}
          </div>
        );
      })}
      {measurements.length > 0 && (
        <div style={{ borderTop: '1px solid #cbd5e1', marginTop: 6, paddingTop: 4 }}>
          <div style={{ fontWeight: 900, marginBottom: 2 }}>{t('measurements.title', 'المقاسات')}</div>
          {measurements.map((m) => (
            // A long note wraps under its line; it never widens the card.
            <div key={m.key} style={{ display: 'flex', flexWrap: 'wrap', columnGap: 4, overflowWrap: 'anywhere' }}>
              <b>{m.label}:</b>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{m.value}</span>
              {m.note && <span style={{ flexBasis: '100%', color: '#334155', paddingInlineStart: 8 }}>{m.note}</span>}
            </div>
          ))}
        </div>
      )}
      {images.length > 0 && (
        <div style={{ borderTop: '1px solid #cbd5e1', marginTop: 6, paddingTop: 4 }}>
          <div style={{ fontWeight: 900, marginBottom: 4 }}>{t('orders.illustration_images', 'صور توضيحية')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4 }}>
            {images.map((src) => (
              <img key={src} src={src} alt="" style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: 4, border: '1px solid #cbd5e1' }} />
            ))}
          </div>
        </div>
      )}
      {order.notes && (
        <div style={{ borderTop: '1px dashed #94a3b8', marginTop: 6, paddingTop: 4 }}>
          <b>{t('orders.work_card_notes', 'ملاحظات')}:</b> {order.notes}
        </div>
      )}
    </div>
  );
}
