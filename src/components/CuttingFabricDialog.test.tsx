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

// seen-merchant-trial-test-2026-11-26.md, phase 2 item 2: the thobe's buttons with its cloth.
describe('the garment components at cutting', () => {
  const tailoringLine = { ...line, takenMeters: 0 };
  const components = {
    initial: [{ itemId: 'btn', name: 'أزرار صدف', quantity: 5 }],
    options: [{ id: 'btn', name: 'أزرار صدف' }, { id: 'thread', name: 'بكرة خيط' }],
    garmentTypes: ['ثوب'],
    canSaveDefault: true,
  };

  it('shows the defaults, lets the quantity change, and sends them with the cloth', () => {
    const onConfirm = vi.fn();
    render(<CuttingFabricDialog lines={[tailoringLine]} onCancel={() => {}} onConfirm={onConfirm} components={components} />);
    const qty = screen.getByRole('spinbutton', { name: 'كمية أزرار صدف' });
    expect((qty as HTMLInputElement).value).toBe('5');
    fireEvent.change(qty, { target: { value: '6' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: ar.orders.cutting_fabric_confirm }));
    expect(onConfirm).toHaveBeenCalledWith(
      [expect.objectContaining({ lineKey: 'l1', meters: 3.5 })],
      { components: [{ itemId: 'btn', name: 'أزرار صدف', quantity: 6 }], saveAsDefault: true },
    );
  });

  it('a component can be added from stock, or removed', () => {
    const onConfirm = vi.fn();
    render(<CuttingFabricDialog lines={[]} onCancel={() => {}} onConfirm={onConfirm} components={components} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'thread' } });
    fireEvent.click(screen.getByRole('button', { name: 'إزالة أزرار صدف' }));
    fireEvent.click(screen.getByRole('button', { name: ar.orders.cutting_fabric_confirm }));
    expect(onConfirm).toHaveBeenCalledWith([], { components: [{ itemId: 'thread', name: 'بكرة خيط', quantity: 1 }], saveAsDefault: false });
  });

  it('without the components prop, the window is cloth only, as before', () => {
    render(<CuttingFabricDialog lines={[tailoringLine]} onCancel={() => {}} onConfirm={() => {}} />);
    expect(screen.queryByText(ar.orders.cutting_components_title)).toBeNull();
  });
});
