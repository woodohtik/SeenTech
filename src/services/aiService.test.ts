import { test, expect, vi, afterEach, beforeAll } from 'vitest';
import i18n from 'i18next';
import { ruleBasedMeasurementChecks } from './aiService';
import en from '../i18n/locales/en.json';

beforeAll(async () => {
  // The test environment does not bootstrap i18next, so initialize it with the
  // English locale so rendered messages (not just t() call arguments) can be asserted.
  await i18n.init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } });
});

afterEach(() => { vi.restoreAllMocks(); });

test('out-of-range flag interpolates the value/min/max converted to the active unit', () => {
  const spy = vi.spyOn(i18n, 't');
  const flags = ruleBasedMeasurementChecks({ chest: 200 }, [], 'inch');
  const call = spy.mock.calls.find(([key]) => key === 'measurements.flag_out_of_range');
  expect(call?.[1]).toMatchObject({
    value: 78.7,  // 200 / 2.54, rounded to 0.1
    min: 33.5,    // 85 / 2.54
    max: 55.1,    // 140 / 2.54
    unit: 'measurements.unit_inch',
  });
  // The rendered message must show the converted value and the resolved unit word.
  const message = flags.find((f) => f.field === 'chest')?.message;
  expect(message).toContain('78.7 in is outside the usual range (33.5–55.1)');
});

test('defaults to cm (unconverted) when no unit is passed', () => {
  const spy = vi.spyOn(i18n, 't');
  const flags = ruleBasedMeasurementChecks({ chest: 200 });
  const call = spy.mock.calls.find(([key]) => key === 'measurements.flag_out_of_range');
  expect(call?.[1]).toMatchObject({ value: 200, min: 85, max: 140, unit: 'measurements.unit_cm' });
  const message = flags.find((f) => f.field === 'chest')?.message;
  expect(message).toContain('200 cm is outside the usual range (85–140)');
});

test('new fields are checked against their own ranges', () => {
  const flags = ruleBasedMeasurementChecks({ handWidth: 5 }); // below the sane minimum
  expect(flags.some((f) => f.field === 'handWidth')).toBe(true);
});

test('waist and hips are no longer checked', () => {
  const flags = ruleBasedMeasurementChecks({ waist: 1, hips: 1 }); // would have flagged under the old ranges
  expect(flags).toHaveLength(0);
});
