import { describe, expect, it } from 'vitest';
import {
  computeLineFabric,
  computeTailoringTotals,
  fabricFromContentUnit,
  fabricInContentUnit,
  lineToServerItem,
  orderItemRowToLine,
  resolveTailoringTax,
  type TailoringTax,
} from './tailoringOrder';

const exclusive: TailoringTax = { enabled: true, vatRatePercentage: 15, taxType: 'exclusive' };

describe('resolveTailoringTax', () => {
  it('defaults to exclusive 15% and follows the VAT number when no settings are stored', () => {
    expect(resolveTailoringTax({ vat_number: '300000000000003' })).toEqual(exclusive);
    expect(resolveTailoringTax({ vat_number: '  ' }).enabled).toBe(false);
    expect(resolveTailoringTax(null).enabled).toBe(false);
  });

  it('reads the stored settings', () => {
    const tax = resolveTailoringTax({
      vat_number: '300000000000003',
      tax_settings: { enabled: false, vatRate: 5, tailoringTaxType: 'inclusive' },
    });
    expect(tax).toEqual({ enabled: false, vatRatePercentage: 5, taxType: 'inclusive' });
  });
});

describe('computeTailoringTotals', () => {
  const items = [{ price: 200, quantity: 3 }, { price: '150', quantity: '1' }];

  it('multiplies the piece price by the number of pieces', () => {
    const totals = computeTailoringTotals(items, 0, exclusive);
    expect(totals).toMatchObject({ itemsTotal: 750, discount: 0, subtotal: 750, vat: 112.5, total: 862.5, taxRate: 15 });
  });

  it('takes the discount off before tax and never below zero', () => {
    expect(computeTailoringTotals(items, 50, exclusive)).toMatchObject({ discount: 50, subtotal: 700, vat: 105, total: 805 });
    expect(computeTailoringTotals(items, 9999, exclusive)).toMatchObject({ discount: 750, total: 0 });
    expect(computeTailoringTotals(items, -20, exclusive).discount).toBe(0);
  });

  it('inclusive prices already contain the tax', () => {
    const totals = computeTailoringTotals([{ price: 115, quantity: 2 }], 0, { ...exclusive, taxType: 'inclusive' });
    expect(totals).toMatchObject({ subtotal: 200, vat: 30, total: 230, taxRate: 15 });
  });

  it('charges no tax when it is off or exempt', () => {
    expect(computeTailoringTotals(items, 0, { ...exclusive, enabled: false })).toMatchObject({ vat: 0, total: 750, taxRate: 0 });
    expect(computeTailoringTotals(items, 0, { ...exclusive, taxType: 'exempt' })).toMatchObject({ vat: 0, total: 750, taxRate: 0 });
  });
});

describe('computeLineFabric', () => {
  it('three pieces at 3.80 m take 11.40 m', () => {
    expect(computeLineFabric({ perPieceMeters: 3.8, quantity: 3 })).toEqual({
      perPieceMeters: 3.8, computedMeters: 11.4, totalMeters: 11.4, isManual: false, consumedMeters: 11.4,
    });
  });

  it('a typed total replaces the computed one and is flagged', () => {
    const line = computeLineFabric({ perPieceMeters: 3.8, quantity: 3, isManual: true, manualMeters: 10.5 });
    expect(line).toMatchObject({ computedMeters: 11.4, totalMeters: 10.5, isManual: true, consumedMeters: 10.5 });
  });

  it('a typed total still counts when there is no estimate', () => {
    const line = computeLineFabric({ perPieceMeters: null, quantity: 2, isManual: true, manualMeters: 7 });
    expect(line).toMatchObject({ computedMeters: null, totalMeters: 7, isManual: true, consumedMeters: 7 });
  });

  it('without an estimate or a typed total nothing is saved for deduction', () => {
    expect(computeLineFabric({ perPieceMeters: null, quantity: 2 })).toMatchObject({
      totalMeters: null, isManual: false, consumedMeters: 0,
    });
  });

  it('external cloth shows the estimate but saves nothing to deduct', () => {
    const line = computeLineFabric({ perPieceMeters: 3.8, quantity: 2, isExternal: true, isManual: true, manualMeters: 5 });
    expect(line).toMatchObject({ computedMeters: 7.6, totalMeters: 7.6, isManual: false, consumedMeters: 0 });
  });

  it('treats a missing or fractional piece count as whole pieces, at least one', () => {
    expect(computeLineFabric({ perPieceMeters: 3.8, quantity: '' }).computedMeters).toBe(3.8);
    expect(computeLineFabric({ perPieceMeters: 3.8, quantity: 2.9 }).computedMeters).toBe(7.6);
  });
});

describe('fabric in the cloth\'s own unit', () => {
  it('converts meters to yards and back for cloth bought by the yard', () => {
    expect(fabricInContentUnit(11.4, 'yard')).toBe(12.47);
    expect(fabricFromContentUnit(12.5, 'yard')).toBe(11.43);
  });

  it('leaves meters alone otherwise', () => {
    expect(fabricInContentUnit(11.4, 'meter')).toBe(11.4);
    expect(fabricInContentUnit(11.4, null)).toBe(11.4);
    expect(fabricFromContentUnit(11.4, undefined)).toBe(11.4);
  });
});

describe('a line to and from order_items', () => {
  const line = {
    garmentType: 'ثوب', fabric: 'قطن', fabricId: 'f-1', quantity: 3, price: 200, consumedMeters: 11.4,
    fabricManual: true, fabricPerPieceMeters: 3.8, collarType: 'classic', closureType: 'buttons',
    additions: 'جيب إضافي', attributes: { color: 'white' },
  };

  it('sends pieces, the fabric figure and the style columns', () => {
    expect(lineToServerItem(line)).toMatchObject({
      garment_type: 'ثوب', fabric: 'قطن', fabric_id: 'f-1', quantity: 3, price: 200, consumed_meters: 11.4,
      collar_type: 'classic', closure_type: 'buttons', additions: 'جيب إضافي', cuff_type: '',
      attributes: { color: 'white', quantityUnit: 'piece', fabricManual: true, fabricPerPieceMeters: 3.8 },
    });
  });

  it('never sends a fractional or empty piece count', () => {
    expect(lineToServerItem({ ...line, quantity: 2.9 }).quantity).toBe(2);
    expect(lineToServerItem({ ...line, quantity: '' }).quantity).toBe(1);
  });

  it('reads a stored row back as the line the screens expect, with its measurement snapshot', () => {
    const back = orderItemRowToLine({
      id: 'row-1', type: 'custom', name: 'ثوب', garment_type: 'ثوب', fabric: 'قطن', fabric_id: 'f-1',
      quantity: '3', price: '200', consumed_meters: '11.4', collar_type: 'classic', cuff_type: null,
      attributes: { quantityUnit: 'piece', fabricManual: true, fabricPerPieceMeters: 3.8 },
      measurements: { length: 145 }, status: 'measurements_taken', status_key: 'measurements_taken',
    });
    expect(back).toMatchObject({
      id: 'row-1', type: 'custom', garmentType: 'ثوب', fabric: 'قطن', fabricId: 'f-1', quantity: 3, price: 200,
      consumedMeters: 11.4, quantityUnit: 'piece', fabricManual: true, collarType: 'classic',
      measurements: { length: 145 },
    });
    expect(back).not.toHaveProperty('cuffType');
  });
});
