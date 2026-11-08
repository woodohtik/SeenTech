import { describe, expect, it } from 'vitest';
import { validateMeasurementsPayload } from './validateMeasurementsPayload';

describe('validateMeasurementsPayload', () => {
  it('accepts a full valid payload', () => {
    const result = validateMeasurementsPayload({
      length: 140, chest: 52, collarType: 'classic', collarPadding: 'hard',
      thobeMeasurements: { collar: 40, chest: 52, shoulders: 45, sleeves: 60, length: 140, bottomWidth: 100 },
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a non-object top level input', () => {
    expect(validateMeasurementsPayload(undefined).ok).toBe(false);
    expect(validateMeasurementsPayload(null).ok).toBe(false);
    expect(validateMeasurementsPayload('x').ok).toBe(false);
    expect(validateMeasurementsPayload([1, 2]).ok).toBe(false);
  });

  it('rejects an unknown top-level key', () => {
    expect(validateMeasurementsPayload({ length: 140, hacked: true }).ok).toBe(false);
  });

  it('rejects an out-of-range numeric value', () => {
    expect(validateMeasurementsPayload({ chest: 301 }).ok).toBe(false);
    expect(validateMeasurementsPayload({ chest: -1 }).ok).toBe(false);
  });

  it('rejects a numeric field sent as a string', () => {
    expect(validateMeasurementsPayload({ chest: '52' }).ok).toBe(false);
  });

  it('rejects a free-text field over 40 characters', () => {
    expect(validateMeasurementsPayload({ collarType: 'x'.repeat(41) }).ok).toBe(false);
  });

  it('rejects an invalid enum value', () => {
    expect(validateMeasurementsPayload({ collarPadding: 'medium' }).ok).toBe(false);
  });

  it('rejects an unknown key inside thobeMeasurements', () => {
    expect(validateMeasurementsPayload({ thobeMeasurements: { collar: 40, hacked: 1 } }).ok).toBe(false);
  });

  it('treats thobeMeasurements: null as not provided', () => {
    const result = validateMeasurementsPayload({ chest: 52, thobeMeasurements: null });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.thobeMeasurements).toBeUndefined();
  });

  it('accepts an empty object (no fields changed)', () => {
    expect(validateMeasurementsPayload({}).ok).toBe(true);
  });
});
