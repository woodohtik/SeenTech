import type { Measurements } from '../types';

const NUMERIC_FIELDS = [
  'length', 'shoulder', 'chest', 'waist', 'hips', 'sleeve', 'neck',
  'bottomWidth', 'handWidth', 'midSleeveWidth', 'cuffLength',
] as const;

const THOBE_NUMERIC_FIELDS = [
  'collar', 'chest', 'shoulders', 'sleeves', 'length', 'bottomWidth',
] as const;

const FREE_TEXT_FIELDS = [
  'collarType', 'cuffType', 'pocketType', 'chestStyle', 'shoulderStyle', 'cuttingType',
] as const;

const COLLAR_PADDING_VALUES = ['hard', 'soft'] as const;
const CLOSURE_TYPE_VALUES = ['zipper', 'buttons'] as const;
const CLOSURE_VISIBILITY_VALUES = ['hidden', 'visible'] as const;

const ALLOWED_TOP_LEVEL_KEYS = new Set<string>([
  ...NUMERIC_FIELDS,
  ...FREE_TEXT_FIELDS,
  'collarPadding',
  'thobeMeasurements',
  'closureType',
  'closureVisibility',
]);

const MAX_MEASUREMENT_CM = 300;
const MAX_FREE_TEXT_LENGTH = 40;

export type ValidateMeasurementsResult =
  | { ok: true; value: Measurements }
  | { ok: false; error: string };

function isPlainObject(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function isValidNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_MEASUREMENT_CM;
}

export function validateMeasurementsPayload(input: unknown): ValidateMeasurementsResult {
  if (!isPlainObject(input)) {
    return { ok: false, error: 'measurements must be an object' };
  }

  for (const key of Object.keys(input)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
      return { ok: false, error: `unknown field: ${key}` };
    }
  }

  const value: Record<string, unknown> = {};

  for (const field of NUMERIC_FIELDS) {
    const raw = input[field];
    if (raw === undefined || raw === null) continue;
    if (!isValidNumber(raw)) {
      return { ok: false, error: `invalid value for ${field}` };
    }
    value[field] = raw;
  }

  for (const field of FREE_TEXT_FIELDS) {
    const raw = input[field];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== 'string' || raw.length > MAX_FREE_TEXT_LENGTH) {
      return { ok: false, error: `invalid value for ${field}` };
    }
    value[field] = raw;
  }

  if (input.collarPadding !== undefined && input.collarPadding !== null) {
    if (!(COLLAR_PADDING_VALUES as readonly unknown[]).includes(input.collarPadding)) {
      return { ok: false, error: 'invalid collarPadding' };
    }
    value.collarPadding = input.collarPadding;
  }

  if (input.closureType !== undefined && input.closureType !== null) {
    if (!(CLOSURE_TYPE_VALUES as readonly unknown[]).includes(input.closureType)) {
      return { ok: false, error: 'invalid closureType' };
    }
    value.closureType = input.closureType;
  }

  if (input.closureVisibility !== undefined && input.closureVisibility !== null) {
    if (!(CLOSURE_VISIBILITY_VALUES as readonly unknown[]).includes(input.closureVisibility)) {
      return { ok: false, error: 'invalid closureVisibility' };
    }
    value.closureVisibility = input.closureVisibility;
  }

  if (input.thobeMeasurements !== undefined && input.thobeMeasurements !== null) {
    const thobeInput = input.thobeMeasurements;
    if (!isPlainObject(thobeInput)) {
      return { ok: false, error: 'invalid thobeMeasurements' };
    }
    for (const key of Object.keys(thobeInput)) {
      if (!(THOBE_NUMERIC_FIELDS as readonly string[]).includes(key)) {
        return { ok: false, error: `unknown thobeMeasurements field: ${key}` };
      }
    }
    const thobeValue: Record<string, number> = {};
    for (const field of THOBE_NUMERIC_FIELDS) {
      const raw = thobeInput[field];
      if (raw === undefined || raw === null) continue;
      if (!isValidNumber(raw)) {
        return { ok: false, error: `invalid value for thobeMeasurements.${field}` };
      }
      thobeValue[field] = raw;
    }
    value.thobeMeasurements = thobeValue;
  }

  return { ok: true, value: value as Measurements };
}
