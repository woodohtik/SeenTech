import React, { useState } from 'react';
import Barcode from 'react-barcode';
import { Barcode as BarcodeIcon, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { generateInternalBarcode, isValidEan13 } from '../../lib/barcode';

/**
 * The product's barcode (seen-product-variants-barcode-po-price-task.md,
 * phase 1): typed by hand (a maker's code), or "Generate" -- an EAN-13 the
 * shop does not use yet. Drawn under the field so the merchant sees it.
 */
export function BarcodeField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const generate = async () => {
    setBusy(true);
    setError('');
    try {
      onChange(await generateInternalBarcode());
    } catch {
      setError(t('inventory.barcode_generate_failed'));
    } finally {
      setBusy(false);
    }
  };

  const code = value.trim();
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          id={id}
          dir="ltr"
          inputMode="numeric"
          placeholder={t('inventory.barcode_placeholder')}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 min-w-0 px-5 py-3 bg-surface border border-border rounded-xl font-semibold text-content outline-none transition-all focus:ring-2 focus:ring-brand/20 focus:border-brand"
        />
        <button type="button" onClick={() => void generate()} disabled={busy}
          className="shrink-0 min-h-11 inline-flex items-center gap-2 px-4 rounded-xl border border-border bg-surface text-content font-bold text-sm hover:border-brand disabled:opacity-50">
          {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <BarcodeIcon size={16} aria-hidden="true" />}
          {t('inventory.barcode_generate')}
        </button>
      </div>
      {error && <p role="alert" className="text-sm font-bold text-danger">{error}</p>}
      {code && (
        <div className="bg-white rounded-xl border border-border p-2 inline-block" aria-label={t('inventory.barcode_preview')}>
          <Barcode value={code} format={isValidEan13(code) ? 'EAN13' : 'CODE128'} height={40} width={1.4} fontSize={12} margin={0} />
        </div>
      )}
    </div>
  );
}
