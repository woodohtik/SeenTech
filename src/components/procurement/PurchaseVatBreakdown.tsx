import React from 'react';
import { useTranslation } from 'react-i18next';
import { PriceDisplay } from '../PriceDisplay';
import { inputVatOf } from '../../utils/inputVat';

/**
 * A purchase order's input VAT, broken out (seen-merchant-trial-test-2026-11-26.md,
 * phase 3 item 4) -- shown only for a shop registered for VAT.
 */
export function PurchaseVatBreakdown({ total, vatRate }: { total: number; vatRate: number | null }) {
  const { t } = useTranslation();
  if (!vatRate || vatRate <= 0) return null;
  const { net, vat } = inputVatOf(total, vatRate);
  return (
    <div className="text-sm font-bold text-content-muted space-y-0.5">
      <p>{t('procurement.net_before_vat')}: <PriceDisplay amount={net} /></p>
      <p>{t('procurement.input_vat', { rate: vatRate })}: <PriceDisplay amount={vat} /></p>
    </div>
  );
}
