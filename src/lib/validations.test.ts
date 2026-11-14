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

describe('customerSchema nullable optional fields', () => {
  // Reproduced live on staging: every real customer there has email (and
  // commonly companyName/trn/notes) stored as SQL NULL, which Supabase
  // returns to the client as JS `null`, not `undefined`. `.optional()`
  // only accepts `undefined` -- `null` fails as "invalid_type", silently
  // (the generic "enter name and phone correctly" message fires for ANY
  // validation error, so this looked like a phone/name problem when it
  // was actually email failing on 100% of real edits).
  const baseCustomer = {
    name: 'Test Customer',
    phone: '0501234567',
  };

  it('accepts a null email, matching what Supabase returns for a NULL column', () => {
    const result = customerSchema.safeParse({ ...baseCustomer, email: null });
    expect(result.success).toBe(true);
  });

  it('accepts a null companyName', () => {
    const result = customerSchema.safeParse({ ...baseCustomer, companyName: null });
    expect(result.success).toBe(true);
  });

  it('accepts a null trn', () => {
    const result = customerSchema.safeParse({ ...baseCustomer, trn: null });
    expect(result.success).toBe(true);
  });

  it('accepts a null notes', () => {
    const result = customerSchema.safeParse({ ...baseCustomer, notes: null });
    expect(result.success).toBe(true);
  });

  it('still rejects a genuinely malformed email', () => {
    const result = customerSchema.safeParse({ ...baseCustomer, email: 'not-an-email' });
    expect(result.success).toBe(false);
  });
});
