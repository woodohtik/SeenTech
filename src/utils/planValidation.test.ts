import { describe, it, expect } from 'vitest';
import { validatePlanForm } from './planValidation';

describe('validatePlanForm', () => {
  it('accepts a fully valid new-plan input', () => {
    const result = validatePlanForm({ id: 'pro', name: 'Pro', price: '249', maxStaff: '10', maxOrders: '5000' }, false);
    expect(result).toEqual({ valid: true, errors: {} });
  });

  it('requires a non-empty id when creating', () => {
    const result = validatePlanForm({ id: '', name: 'Pro', price: '249', maxStaff: '10', maxOrders: '5000' }, false);
    expect(result.valid).toBe(false);
    expect(result.errors.id).toBeTruthy();
  });

  it('rejects an id that does not match the slug pattern', () => {
    const result = validatePlanForm({ id: 'Pro Plan!', name: 'Pro', price: '249', maxStaff: '10', maxOrders: '5000' }, false);
    expect(result.valid).toBe(false);
    expect(result.errors.id).toBeTruthy();
  });

  it('does not require id when editing (field is locked, not re-validated)', () => {
    const result = validatePlanForm({ id: '', name: 'Pro', price: '249', maxStaff: '10', maxOrders: '5000' }, true);
    expect(result.errors.id).toBeUndefined();
  });

  it('requires a non-empty name', () => {
    const result = validatePlanForm({ id: 'pro', name: '', price: '249', maxStaff: '10', maxOrders: '5000' }, false);
    expect(result.valid).toBe(false);
    expect(result.errors.name).toBeTruthy();
  });

  it('rejects a negative price', () => {
    const result = validatePlanForm({ id: 'pro', name: 'Pro', price: '-1', maxStaff: '10', maxOrders: '5000' }, false);
    expect(result.valid).toBe(false);
    expect(result.errors.price).toBeTruthy();
  });

  it('rejects a non-numeric price', () => {
    const result = validatePlanForm({ id: 'pro', name: 'Pro', price: 'abc', maxStaff: '10', maxOrders: '5000' }, false);
    expect(result.valid).toBe(false);
    expect(result.errors.price).toBeTruthy();
  });

  it('accepts price of exactly 0 (free plan)', () => {
    const result = validatePlanForm({ id: 'free', name: 'Free', price: '0', maxStaff: '1', maxOrders: '100' }, false);
    expect(result.valid).toBe(true);
  });

  it('rejects a negative maxStaff', () => {
    const result = validatePlanForm({ id: 'pro', name: 'Pro', price: '0', maxStaff: '-1', maxOrders: '5000' }, false);
    expect(result.valid).toBe(false);
    expect(result.errors.maxStaff).toBeTruthy();
  });

  it('rejects a non-integer maxStaff', () => {
    const result = validatePlanForm({ id: 'pro', name: 'Pro', price: '0', maxStaff: '2.5', maxOrders: '5000' }, false);
    expect(result.valid).toBe(false);
    expect(result.errors.maxStaff).toBeTruthy();
  });

  it('rejects a negative maxOrders', () => {
    const result = validatePlanForm({ id: 'pro', name: 'Pro', price: '0', maxStaff: '1', maxOrders: '-5' }, false);
    expect(result.valid).toBe(false);
    expect(result.errors.maxOrders).toBeTruthy();
  });

  it('accepts maxStaff of exactly 0', () => {
    const result = validatePlanForm({ id: 'pro', name: 'Pro', price: '0', maxStaff: '0', maxOrders: '0' }, false);
    expect(result.valid).toBe(true);
  });
});
