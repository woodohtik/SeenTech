import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FABRIC_ESTIMATE_SETTINGS,
  fabricInputFromMeasurements,
  estimateFabricCm,
  estimateFabricMeters,
  metersToYards,
  normalizeFabricEstimateSettings,
} from './fabricEstimate';

describe('estimateFabricCm / estimateFabricMeters', () => {
  it('wide cloth: two lengths + one sleeve + waste, rounded up to 5 cm', () => {
    // 2*145 + 62 + 25 = 377 -> 380
    expect(estimateFabricCm({ lengthCm: 145, sleeveCm: 62, fabricWidthCm: 150 })).toBe(380);
    const meters = estimateFabricMeters({ lengthCm: 145, sleeveCm: 62, fabricWidthCm: 150 });
    expect(meters).toBe(3.8);
    expect(metersToYards(meters!)).toBe(4.16);
  });

  it('adds the bottom hem to the length and the sleeve hem to the plain sleeve', () => {
    // 2*(145+5) + (62+3) + 25 = 390
    const input = { lengthCm: 145, bottomHemCm: 5, sleeveCm: 62, sleeveHemCm: 3, fabricWidthCm: 150 };
    expect(estimateFabricCm(input)).toBe(390);
    expect(estimateFabricMeters(input)).toBe(3.9);
  });

  it('cuts the sleeve at the larger of the cuffed length and the plain length with its hem', () => {
    // cuffed 60 against plain 62+3 -> 65
    expect(estimateFabricCm({ lengthCm: 145, sleeveCuffCm: 60, sleeveCm: 62, sleeveHemCm: 3 })).toBe(380);
    // cuffed 70 wins: 290 + 70 + 25 = 385
    expect(estimateFabricCm({ lengthCm: 145, sleeveCuffCm: 70, sleeveCm: 62, sleeveHemCm: 3 })).toBe(385);
    // only the cuffed sleeve entered: 290 + 60 + 25 = 375
    expect(estimateFabricCm({ lengthCm: 145, sleeveCuffCm: 60 })).toBe(375);
  });

  it('reads its inputs from a stored measurements object', () => {
    const input = fabricInputFromMeasurements(
      { length: 145, bottomHem: 5, sleeve: 62, sleeveHem: 3, sleeveCuff: 0 },
      112
    );
    // narrow cloth: 300 + 2*65 + 25 = 455
    expect(estimateFabricCm(input)).toBe(455);
    expect(estimateFabricCm(fabricInputFromMeasurements(null))).toBeNull();
  });

  it('narrow cloth: a full sleeve length per sleeve', () => {
    // 2*150 + 2*65 + 25 = 455 -> already a multiple of 5
    expect(estimateFabricCm({ lengthCm: 150, sleeveCm: 65, fabricWidthCm: 112 })).toBe(455);
    expect(estimateFabricMeters({ lengthCm: 150, sleeveCm: 65, fabricWidthCm: 112 })).toBe(4.55);
  });

  it('exactly the narrow threshold counts as wide', () => {
    expect(estimateFabricCm({ lengthCm: 145, sleeveCm: 62, fabricWidthCm: 140 })).toBe(380);
    expect(estimateFabricCm({ lengthCm: 145, sleeveCm: 62, fabricWidthCm: 139.9 })).toBe(440);
  });

  it('falls back to the shop default width when the item has none', () => {
    expect(estimateFabricCm({ lengthCm: 145, sleeveCm: 62 })).toBe(380);
    expect(estimateFabricCm({ lengthCm: 145, sleeveCm: 62, fabricWidthCm: 0 })).toBe(380);
    const narrowShop = { ...DEFAULT_FABRIC_ESTIMATE_SETTINGS, defaultWidthCm: 112 };
    expect(estimateFabricCm({ lengthCm: 145, sleeveCm: 62 }, narrowShop)).toBe(440);
  });

  it('returns null when the length or both sleeve lengths are missing', () => {
    expect(estimateFabricCm({ lengthCm: 145 })).toBeNull();
    expect(estimateFabricCm({ lengthCm: 145, sleeveHemCm: 3, bottomHemCm: 5 })).toBeNull();
    expect(estimateFabricCm({ sleeveCuffCm: 60, sleeveCm: 62 })).toBeNull();
    expect(estimateFabricCm({ sleeveCm: 62 })).toBeNull();
    expect(estimateFabricCm({ lengthCm: 0, sleeveCm: 62 })).toBeNull();
    expect(estimateFabricMeters({ lengthCm: null, sleeveCm: null })).toBeNull();
  });

  it('follows the shop settings (waste, threshold)', () => {
    const settings = { ...DEFAULT_FABRIC_ESTIMATE_SETTINGS, wasteCm: 40 };
    // 2*145 + 62 + 40 = 392 -> 395
    expect(estimateFabricCm({ lengthCm: 145, sleeveCm: 62, fabricWidthCm: 150 }, settings)).toBe(395);
    const strict = { ...DEFAULT_FABRIC_ESTIMATE_SETTINGS, narrowWidthCm: 160 };
    expect(estimateFabricCm({ lengthCm: 145, sleeveCm: 62, fabricWidthCm: 150 }, strict)).toBe(440);
  });
});

describe('normalizeFabricEstimateSettings', () => {
  it('uses the defaults for missing or malformed input', () => {
    expect(normalizeFabricEstimateSettings(null)).toEqual(DEFAULT_FABRIC_ESTIMATE_SETTINGS);
    expect(normalizeFabricEstimateSettings('x')).toEqual(DEFAULT_FABRIC_ESTIMATE_SETTINGS);
    expect(normalizeFabricEstimateSettings({ wasteCm: -5, defaultWidthCm: 0, narrowWidthCm: 'abc' })).toEqual(
      DEFAULT_FABRIC_ESTIMATE_SETTINGS
    );
  });

  it('keeps valid stored values, including a zero waste', () => {
    expect(normalizeFabricEstimateSettings({ wasteCm: 0, defaultWidthCm: 112, narrowWidthCm: 130 })).toEqual({
      wasteCm: 0, defaultWidthCm: 112, narrowWidthCm: 130, roundToCm: 5,
    });
  });
});

// seen-measurements-basic-advanced-task.md, acceptance 5.
describe('with the basic measurements only', () => {
  it('estimates from the length and the plain sleeve, the advanced ones counting as zero', () => {
    const basicOnly = { length: 145, shoulder: 48, sleeve: 62, handWidth: 18, cuffLength: 25, chest: 110, neck: 40 };
    // 2*145 + 62 + 25 = 377 -> 380
    expect(estimateFabricMeters(fabricInputFromMeasurements(basicOnly, 150))).toBe(3.8);
  });
});
