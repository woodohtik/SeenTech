import { describe, expect, test } from 'vitest';
import { resolveTaxSettings } from './taxSettings';
import { resolveTailoringTax } from './tailoringOrder';

// The rules of public.tenant_tax_rules (migration 20261230000000), which
// create_tailoring_order applies on the server.
describe('resolveTaxSettings', () => {
  test('no settings: on when the shop has a VAT number, 15%, exclusive', () => {
    expect(resolveTaxSettings({ vat_number: '300000000000003', name: 'محل' })).toEqual({
      enabled: true, trn: '300000000000003', legalName: 'محل', vatRate: 15, tailoringTaxType: 'exclusive',
    });
    expect(resolveTaxSettings({ vat_number: '  ', name: 'محل' }).enabled).toBe(false);
    expect(resolveTaxSettings(null).enabled).toBe(false);
  });

  test('stored settings win; a missing flag follows the VAT number or the TRN', () => {
    expect(resolveTaxSettings({ vat_number: '', tax_settings: { trn: '310000000000003' } }).enabled).toBe(true);
    expect(resolveTaxSettings({ vat_number: '300000000000003', tax_settings: { enabled: false } }).enabled).toBe(false);
    // stored as text by an older writer: read like the database's ::boolean
    expect(resolveTaxSettings({ vat_number: '300000000000003', tax_settings: { enabled: 'false' } }).enabled).toBe(false);
  });

  test('a stored rate of 0 (or none) means 15; another rate is kept', () => {
    expect(resolveTaxSettings({ tax_settings: { vatRate: 0 } }).vatRate).toBe(15);
    expect(resolveTaxSettings({ tax_settings: {} }).vatRate).toBe(15);
    expect(resolveTaxSettings({ tax_settings: { vatRate: '5' } }).vatRate).toBe(5);
  });

  test('the rest of the document is kept (notification settings live in it)', () => {
    const s = resolveTaxSettings({ tax_settings: { vatRate: 15, notificationSettings: { lowStock: false } } });
    expect(s.notificationSettings).toEqual({ lowStock: false });
  });

  test('the fallback document is used only when the row has none', () => {
    expect(resolveTaxSettings({ tax_settings: null }, { vatRate: 5 }).vatRate).toBe(5);
    expect(resolveTaxSettings({ tax_settings: { vatRate: 10 } }, { vatRate: 5 }).vatRate).toBe(10);
  });

  test('resolveTailoringTax reads the same rules', () => {
    const row = { vat_number: '300000000000003', tax_settings: { vatRate: 0, tailoringTaxType: 'inclusive' } };
    expect(resolveTailoringTax(row)).toEqual({ enabled: true, vatRatePercentage: 15, taxType: 'inclusive' });
  });
});
