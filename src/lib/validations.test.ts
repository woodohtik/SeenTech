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

  // seen-cto-code-review-2026-11-13.md CM-01: VisualMeasurements.tsx
  // writes these four keys, but zod silently stripped them (unknown
  // keys) on every staff save -- so a cutting-type/collar-padding/
  // closure choice the tailor made in the staff modal never reached the
  // database, and any public-form submission that HAD set them was
  // erased by the next staff edit's full-object UPDATE.
  it('preserves cuttingType, collarPadding, closureType and closureVisibility through parsing', () => {
    const result = customerSchema.parse({
      ...baseCustomer,
      measurements: {
        cuttingType: 'kuwaiti',
        collarPadding: 'soft',
        closureType: 'zipper',
        closureVisibility: 'hidden',
      },
    });

    expect(result.measurements?.cuttingType).toBe('kuwaiti');
    expect(result.measurements?.collarPadding).toBe('soft');
    expect(result.measurements?.closureType).toBe('zipper');
    expect(result.measurements?.closureVisibility).toBe('hidden');
  });

  it('rejects an invalid collarPadding/closureType/closureVisibility value', () => {
    expect(customerSchema.safeParse({
      ...baseCustomer,
      measurements: { collarPadding: 'medium' },
    }).success).toBe(false);

    expect(customerSchema.safeParse({
      ...baseCustomer,
      measurements: { closureType: 'velcro' },
    }).success).toBe(false);

    expect(customerSchema.safeParse({
      ...baseCustomer,
      measurements: { closureVisibility: 'partial' },
    }).success).toBe(false);
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

// Found by golden path 5 (seen-merchant-trial-test-2026-11-26.md): the form
// showed "Saudi cutting" chosen, and the order saved no cutting type -- the
// line schema did not list cuttingType or shoulderStyle, so zod dropped them.
import { orderSchema as orderSchemaForStyles } from './validations';
it('an order line keeps every style the form offers', () => {
  const parsed = orderSchemaForStyles.parse({
    customerId: 'c1', deliveryDate: '2026-12-01', paidAmount: 0, paymentMethod: 'cash', status: 'measurements_taken',
    items: [{ garmentType: 'ثوب', fabric: 'قطن', quantity: 1, price: 250,
      cuttingType: 'saudi', shoulderStyle: 'padded', collarPadding: 'hard', pocketType: 'visible', collarType: 'classic',
      cuffType: 'square', chestStyle: 'plain', closureType: 'buttons', closureVisibility: 'hidden' }],
  });
  expect(parsed.items[0]).toMatchObject({ cuttingType: 'saudi', shoulderStyle: 'padded', collarPadding: 'hard', pocketType: 'visible' });
});
