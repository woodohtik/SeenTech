import { METERS_PER_YARD } from './fabricUomConverter';

/**
 * How much fabric one thobe takes, estimated from its measurements.
 *
 * This is a simple geometric rule proposed by engineering, not a master
 * tailor's table:
 *
 *   cut length = length + bottom hem
 *   cut sleeve = the larger of (cuffed sleeve length) and (plain sleeve length + its hem)
 *   fabric     = 2 x cut length + 1 x cut sleeve + waste
 *                (2 x cut sleeve when the cloth is too narrow to cut both sleeves side by side)
 *
 * Chest, waist, bottom width and the cuff itself do not enter it. That the hems
 * are added on top of the length when cutting is an assumption awaiting a
 * tailor's confirmation. Every number lives in the settings object so that
 * review can retune it without touching any caller.
 */
export interface FabricEstimateSettings {
  /** Fixed allowance added to every garment, in cm. */
  wasteCm: number;
  /** Cloth width assumed when the fabric item has none recorded, in cm. */
  defaultWidthCm: number;
  /** Cloth narrower than this needs a full sleeve length per sleeve, in cm. */
  narrowWidthCm: number;
  /** The result is rounded up to a multiple of this, in cm. */
  roundToCm: number;
}

export const DEFAULT_FABRIC_ESTIMATE_SETTINGS: FabricEstimateSettings = {
  wasteCm: 25,
  defaultWidthCm: 150,
  narrowWidthCm: 140,
  roundToCm: 5,
};

const positive = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Stored shop settings (possibly partial, missing, or malformed) -> a complete, usable object. */
export function normalizeFabricEstimateSettings(raw: unknown): FabricEstimateSettings {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const waste = Number(source.wasteCm);
  return {
    wasteCm: Number.isFinite(waste) && waste >= 0 ? waste : DEFAULT_FABRIC_ESTIMATE_SETTINGS.wasteCm,
    defaultWidthCm: positive(source.defaultWidthCm) ?? DEFAULT_FABRIC_ESTIMATE_SETTINGS.defaultWidthCm,
    narrowWidthCm: positive(source.narrowWidthCm) ?? DEFAULT_FABRIC_ESTIMATE_SETTINGS.narrowWidthCm,
    roundToCm: positive(source.roundToCm) ?? DEFAULT_FABRIC_ESTIMATE_SETTINGS.roundToCm,
  };
}

export interface FabricEstimateInput {
  /** Garment length in cm (measurements are stored in cm). */
  lengthCm?: number | null;
  /** Bottom hem in cm; counts as zero when empty. */
  bottomHemCm?: number | null;
  /** Sleeve length for a cuffed sleeve, in cm. */
  sleeveCuffCm?: number | null;
  /** Sleeve length for a plain sleeve, in cm. */
  sleeveCm?: number | null;
  /** Hem of a plain sleeve in cm; counts as zero when empty. */
  sleeveHemCm?: number | null;
  /** Width of the chosen cloth in cm; falls back to the shop default. */
  fabricWidthCm?: number | null;
}

/** The estimate's inputs out of a stored measurements object (all in cm). */
export function fabricInputFromMeasurements(
  measurements: {
    length?: number | null;
    bottomHem?: number | null;
    sleeveCuff?: number | null;
    sleeve?: number | null;
    sleeveHem?: number | null;
  } | null | undefined,
  fabricWidthCm?: number | null
): FabricEstimateInput {
  return {
    lengthCm: measurements?.length,
    bottomHemCm: measurements?.bottomHem,
    sleeveCuffCm: measurements?.sleeveCuff,
    sleeveCm: measurements?.sleeve,
    sleeveHemCm: measurements?.sleeveHem,
    fabricWidthCm,
  };
}

/** Fabric for ONE garment in cm, or null when the length or both sleeve lengths are missing. */
export function estimateFabricCm(
  input: FabricEstimateInput,
  settings: FabricEstimateSettings = DEFAULT_FABRIC_ESTIMATE_SETTINGS
): number | null {
  const length = positive(input.lengthCm);
  const cuffedSleeve = positive(input.sleeveCuffCm);
  const plainSleeve = positive(input.sleeveCm);
  if (length === null || (cuffedSleeve === null && plainSleeve === null)) return null;

  const cutLength = length + (positive(input.bottomHemCm) ?? 0);
  const cutSleeve = Math.max(
    cuffedSleeve ?? 0,
    plainSleeve === null ? 0 : plainSleeve + (positive(input.sleeveHemCm) ?? 0)
  );

  const width = positive(input.fabricWidthCm) ?? settings.defaultWidthCm;
  const sleeveLengths = width >= settings.narrowWidthCm ? 1 : 2;
  const raw = 2 * cutLength + sleeveLengths * cutSleeve + settings.wasteCm;
  // The epsilon keeps an exact multiple (455) from being pushed up by float noise.
  return Math.ceil(raw / settings.roundToCm - 1e-9) * settings.roundToCm;
}

/** Fabric for ONE garment in meters (2 decimals), or null when it cannot be estimated. */
export function estimateFabricMeters(
  input: FabricEstimateInput,
  settings: FabricEstimateSettings = DEFAULT_FABRIC_ESTIMATE_SETTINGS
): number | null {
  const cm = estimateFabricCm(input, settings);
  return cm === null ? null : Math.round(cm) / 100;
}

export function metersToYards(meters: number): number {
  return Math.round((meters / METERS_PER_YARD) * 100) / 100;
}
