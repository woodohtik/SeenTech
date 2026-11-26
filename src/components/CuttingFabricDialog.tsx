import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Scissors, X } from 'lucide-react';
import { isRtlLang } from '../lib/direction';
import { metersToYards } from '../utils/fabricEstimate';
import type { CuttingFabricLine } from '../utils/tailoringOrder';
import type { CuttingComponent } from '../utils/garmentComponents';
import { CuttingComponentsSection, type CuttingComponentsValue } from './cutting/CuttingComponentsSection';

/**
 * Shown when an order first reaches cutting (or skips past it): every line
 * that draws cloth from stock, with the quantity about to be deducted. The
 * staff member can correct a figure before confirming; the deduction itself
 * happens on the server together with the status change.
 */
export interface CuttingFabricDialogProps {
  lines: CuttingFabricLine[];
  busy?: boolean;
  onCancel: () => void;
  /** The reviewed lines, meters as confirmed; the components when shown. */
  onConfirm: (lines: CuttingFabricLine[], components?: CuttingComponentsValue) => void;
  /**
   * seen-merchant-trial-test-2026-11-26.md, phase 2 item 2: the garment's
   * components (buttons, thread), taken with the cloth -- shown when due.
   */
  components?: { initial: CuttingComponent[]; options: { id: string; name: string }[]; garmentTypes: string[]; canSaveDefault: boolean };
  /**
   * seen-cutting-fabric-pos-orders-fix-task.md: a POS thobe whose cloth was
   * taken at the sale -- the window is optional, and this moves the order on
   * without touching the cloth.
   */
  onSkip?: () => void;
}

export default function CuttingFabricDialog({ lines, busy = false, onCancel, onConfirm, onSkip, components }: CuttingFabricDialogProps) {
  const [componentsValue, setComponentsValue] = useState<CuttingComponentsValue>(() => ({ components: components?.initial || [], saveAsDefault: false }));
  const { t, i18n } = useTranslation();
  // Text per line, so a half-typed decimal is not rewritten while typing.
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((line) => [line.lineKey, line.meters ? String(line.meters) : '']))
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [busy, onCancel]);

  const metersOf = (lineKey: string) => {
    const parsed = parseFloat(values[lineKey] ?? '');
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  };
  const total = lines.reduce((sum, line) => sum + metersOf(line.lineKey), 0);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[160] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={busy ? undefined : onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cutting-fabric-title"
        onClick={(e) => e.stopPropagation()}
        dir={isRtlLang(i18n.language) ? 'rtl' : 'ltr'}
        className="w-full max-w-lg max-h-[90vh] flex flex-col rounded-3xl bg-surface border border-border shadow-2xl overflow-hidden text-start"
      >
        <div className="flex items-center justify-between p-4 main-640:p-5 border-b border-border bg-brand/5 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-brand text-white rounded-2xl shrink-0"><Scissors size={20} /></div>
            <h3 id="cutting-fabric-title" className="text-base main-640:text-lg font-black text-content">{t('orders.cutting_fabric_title')}</h3>
          </div>
          <button type="button" onClick={onCancel} disabled={busy} aria-label={t('common.close')} className="p-2 hover:bg-surface-muted rounded-full transition-colors text-content-muted disabled:opacity-50">
            <X size={20} />
          </button>
        </div>

        <form
          className="flex-1 flex flex-col min-h-0"
          onSubmit={(e) => {
            e.preventDefault();
            onConfirm(lines.map((line) => ({ ...line, meters: metersOf(line.lineKey) })), components ? componentsValue : undefined);
          }}
        >
          <div className="flex-1 overflow-y-auto p-4 main-640:p-5 space-y-3">
            {lines.length > 0 && <p className="text-sm font-bold text-content-muted">{t('orders.cutting_fabric_desc')}</p>}
            {lines.some((line) => (line.takenMeters ?? 0) > 0) && (
              <p className="text-sm font-bold text-content">{t('orders.cutting_fabric_taken_desc')}</p>
            )}
            {lines.map((line, index) => (
              <div key={line.lineKey} className="flex items-center gap-3 rounded-2xl border border-border bg-surface-muted p-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black text-content truncate">{line.fabricName}</p>
                  <p className="text-sm font-bold text-content-muted truncate">
                    {t('orders.cutting_fabric_line', { garment: line.garmentType, count: line.pieces })}
                  </p>
                  {(line.takenMeters ?? 0) > 0 && (
                    <p className="text-sm font-bold text-brand">{t('orders.cutting_fabric_taken', { meters: line.takenMeters })}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <input
                    id={`cutting-line-${index}`}
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    autoFocus={index === 0}
                    aria-label={t('orders.cutting_fabric_input_label', { fabric: line.fabricName })}
                    value={values[line.lineKey] ?? ''}
                    onChange={(e) => setValues((prev) => ({ ...prev, [line.lineKey]: e.target.value }))}
                    className="w-24 bg-surface border border-border rounded-xl px-3 text-base font-black text-content text-center outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
                  />
                  <label htmlFor={`cutting-line-${index}`} className="text-sm font-bold text-content-muted">{t('inventory.unit_meter')}</label>
                </div>
              </div>
            ))}
            {lines.length > 0 && (
              <p className="text-sm font-black text-brand" role="status">
                {t('orders.cutting_fabric_total', { meters: total.toFixed(2), yards: metersToYards(total).toFixed(2) })}
              </p>
            )}
            {components && (
              <CuttingComponentsSection
                value={componentsValue}
                onChange={setComponentsValue}
                options={components.options}
                garmentTypes={components.garmentTypes}
                canSaveDefault={components.canSaveDefault}
              />
            )}
          </div>

          <div className="shrink-0 p-4 main-640:p-5 border-t border-border flex items-center justify-end gap-3">
            <button type="button" onClick={onCancel} disabled={busy} className="px-6 py-2.5 text-content-muted font-bold hover:text-content transition-colors text-sm rounded-xl hover:bg-surface-muted disabled:opacity-50">
              {t('common.cancel')}
            </button>
            {onSkip && (
              <button type="button" onClick={onSkip} disabled={busy} className="px-5 py-2.5 border border-border text-content font-bold text-sm rounded-xl hover:bg-surface-muted disabled:opacity-50">
                {t('orders.cutting_fabric_skip')}
              </button>
            )}
            <button type="submit" disabled={busy} className="bg-brand text-white px-8 py-2.5 rounded-xl font-bold hover:bg-brand/90 shadow-lg shadow-brand/20 transition-all disabled:opacity-50 text-sm">
              {busy ? t('common.saving') : t('orders.cutting_fabric_confirm')}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
