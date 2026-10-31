import { describe, it, expect } from 'vitest';
import { customerSchema } from './validations';

describe('customerSchema measurements', () => {
  const baseCustomer = {
    name: 'Test Customer',
    phone: '0501234567',
  };

  it('preserves handWidth, midSleeveWidth, cuffLength and bottomWidth through parsing', () => {
    const result = customerSchema.parse({
      ...baseCustomer,
      measurements: {
        length: 100,
        shoulder: 40,
        chest: 50,
        sleeve: 60,
        neck: 38,
        handWidth: 20,
        midSleeveWidth: 15,
        cuffLength: 10,
        bottomWidth: 55,
      },
    });

    expect(result.measurements?.handWidth).toBe(20);
    expect(result.measurements?.midSleeveWidth).toBe(15);
    expect(result.measurements?.cuffLength).toBe(10);
    expect(result.measurements?.bottomWidth).toBe(55);
  });

  it('still allows measurements to be omitted entirely', () => {
    const result = customerSchema.parse({ ...baseCustomer });
    expect(result.measurements).toBeUndefined();
  });
});
