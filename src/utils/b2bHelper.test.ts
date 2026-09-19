import { describe, it, expect } from 'vitest';
import { hasValidTaxSettings } from './b2bHelper';

describe('hasValidTaxSettings', () => {
  it('rejects when both trn and legalName are missing', () => {
    expect(hasValidTaxSettings(null)).toBe(false);
    expect(hasValidTaxSettings(undefined)).toBe(false);
    expect(hasValidTaxSettings({})).toBe(false);
  });

  it('rejects when only trn is set', () => {
    expect(hasValidTaxSettings({ trn: '300000000000003' })).toBe(false);
  });

  it('rejects when only legalName is set', () => {
    expect(hasValidTaxSettings({ legalName: 'مؤسسة حقيقية' })).toBe(false);
  });

  it('rejects empty-string values (not just missing ones)', () => {
    expect(hasValidTaxSettings({ trn: '', legalName: '' })).toBe(false);
    expect(hasValidTaxSettings({ trn: '300000000000003', legalName: '' })).toBe(false);
  });

  it('accepts when both trn and legalName are real, non-empty values', () => {
    expect(hasValidTaxSettings({ trn: '399999999900003', legalName: 'مؤسسة حقيقية للتفصيل' })).toBe(true);
  });
});
