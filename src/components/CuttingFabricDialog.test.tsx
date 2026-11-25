// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ar from '../i18n/locales/ar.json';
import CuttingFabricDialog from './CuttingFabricDialog';

// seen-cutting-fabric-pos-orders-fix-task.md: a POS thobe whose cloth was taken at the sale.
beforeAll(async () => {
  await i18n.use(initReactI18next).init({ lng: 'ar', resources: { ar: { translation: ar } }, interpolation: { escapeValue: false } });
});
afterEach(cleanup);

const line = { lineKey: 'l1', fabricId: 'f1', fabricName: 'قطن', garmentType: 'ثوب', pieces: 1, meters: 3.5, takenMeters: 3.5 };

describe('the cutting window for a POS thobe', () => {
  it('says what was taken at the sale, and that only the difference moves', () => {
    render(<CuttingFabricDialog lines={[line]} onCancel={() => {}} onConfirm={() => {}} onSkip={() => {}} />);
    expect(screen.getByText(ar.orders.cutting_fabric_taken.replace('{{meters}}', '3.5'))).toBeTruthy();
    expect(screen.getByText(ar.orders.cutting_fabric_taken_desc)).toBeTruthy();
  });

  it('"continue without a change" moves on without the cloth', () => {
    const onSkip = vi.fn();
    const onConfirm = vi.fn();
    render(<CuttingFabricDialog lines={[line]} onCancel={() => {}} onConfirm={onConfirm} onSkip={onSkip} />);
    fireEvent.click(screen.getByRole('button', { name: ar.orders.cutting_fabric_skip }));
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('a tailoring order: no "taken" line and no skip', () => {
    render(<CuttingFabricDialog lines={[{ ...line, takenMeters: 0 }]} onCancel={() => {}} onConfirm={() => {}} />);
    expect(screen.queryByText(ar.orders.cutting_fabric_taken_desc)).toBeNull();
    expect(screen.queryByRole('button', { name: ar.orders.cutting_fabric_skip })).toBeNull();
  });
});
