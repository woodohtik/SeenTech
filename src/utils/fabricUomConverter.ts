import i18n from 'i18next';

/**
 * Fabric Unit of Measure (UOM) converter utility.
 * Specifically built to handle tailors' fabric units (e.g. Roll, Bolt, Yard, Meter)
 * with strict precision to prevent floating point discrepancies.
 */

export interface UomConfig {
  id: string;
  name: string;
  nameEn: string;
  symbol: string;
  isBase: boolean;
}

export interface ItemConversion {
  id: string;
  itemId: string;
  fromUnit: string; // Large unit key, e.g. "roll", "bolt"
  toUnit: string;   // Base unit, e.g. "meter"
  conversionRate: number; // e.g. 1 roll = 25.00 meters, rate = 25
}

// Default/Fallback conversions if no custom database conversions are defined yet
export const DEFAULT_FABRIC_UNITS: UomConfig[] = [
  { id: 'meter', name: 'متر', nameEn: 'Meter', symbol: 'م', isBase: true },
  { id: 'yard', name: 'ياردة', nameEn: 'Yard', symbol: 'ي', isBase: false },
  { id: 'roll', name: 'طاقة', nameEn: 'Roll', symbol: 'ط', isBase: false },
  { id: 'bolt', name: 'لفة', nameEn: 'Bolt', symbol: 'ل', isBase: false },
  { id: 'piece', name: 'قطعة', nameEn: 'Piece', symbol: 'ق', isBase: true },
  { id: 'box', name: 'صندوق', nameEn: 'Box', symbol: 'ص', isBase: false }
];

/**
 * Safely rounds a numeric value to a given precision (default: 3 decimal places)
 * to handle floating point errors in JavaScript/TypeScript.
 */
export function safeRound(value: number, precision: number = 3): number {
  const factor = Math.pow(10, precision);
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * Converts a given large unit quantity (e.g. 5 rolls) to its equivalent in the base unit (meters).
 * Uses Safe Rounding.
 */
export function convertToBaseUnit(quantity: number, conversionRate: number): number {
  if (!quantity || isNaN(quantity)) return 0;
  // A missing/zero/negative rate used to fall through as `return quantity`, i.e. the code
  // silently pretended 1 roll = 1 meter. For a fabric at 25 m/roll that understates the
  // conversion 25-fold. Fail loudly instead — the caller must fix the item's setup.
  if (!isValidRate(conversionRate)) throw new Error('INVALID_CONVERSION_RATE');
  return safeRound(quantity * conversionRate, 3);
}

/** A conversion rate is only usable when it is a finite, strictly positive number. */
export function isValidRate(rate: unknown): rate is number {
  const n = Number(rate);
  return Number.isFinite(n) && n > 0;
}

/**
 * Converts a given base unit quantity (e.g. 125 meters) to its equivalent in a larger unit (e.g. rolls).
 */
export function convertFromBaseUnit(quantityInBase: number, conversionRate: number): number {
  if (!quantityInBase || isNaN(quantityInBase)) return 0;
  if (!isValidRate(conversionRate)) throw new Error('INVALID_CONVERSION_RATE');
  return safeRound(quantityInBase / conversionRate, 3);
}

/**
 * Splits a total stock quantity in base units into large units and remaining base units.
 * Example: 53 meters with conversion rate of 25 (1 Roll = 25m) results in:
 * { largeUnits: 2, remainingBase: 3 }
 */
export function splitStockByUom(quantityInBase: number, conversionRate: number): {
  largeUnits: number;
  remainingBase: number;
} {
  if (!quantityInBase || isNaN(quantityInBase)) return { largeUnits: 0, remainingBase: 0 };
  if (!isValidRate(conversionRate) || conversionRate <= 1) {
    return { largeUnits: 0, remainingBase: safeRound(quantityInBase, 3) };
  }

  // Negative balances used to split wrongly: Math.floor(-60/25) = -3 and -60 % 25 = -10,
  // i.e. "-3 rolls and -10 m" = -85, not -60. Split the magnitude, then re-apply the sign.
  const rounded = safeRound(quantityInBase, 3);
  const sign = rounded < 0 ? -1 : 1;
  const abs = Math.abs(rounded);

  // Float division makes 3.3 / 1.1 = 2.9999999999999996, so a plain Math.floor reports
  // "2 units and 1.1 m" where the answer is exactly 3 units. Round the ratio first, and
  // derive the remainder by subtraction so the two parts always re-sum to the total.
  const ratio = safeRound(abs / conversionRate, 6);
  const largeUnits = Math.floor(ratio + 1e-9);
  const remainingBase = safeRound(abs - largeUnits * conversionRate, 3);

  return { largeUnits: sign * largeUnits, remainingBase: sign * remainingBase };
}

/**
 * Formats a total stock quantity into a highly readable, smart string representation.
 * Returns bilingual, context-aware output (e.g., "2 طاقة و 3 متر" or "2 Rolls & 3 Meters").
 */
export function formatSmartStockDisplay(
  quantityInBase: number,
  largeUnitKey: string,
  baseUnitKey: string,
  conversionRate: number,
  locale?: string
): string {
  const roundedQty = safeRound(quantityInBase, 3);

  if (roundedQty === 0) {
    return i18n.t('units.zero_meters', { lng: locale, defaultValue: '0 m' });
  }

  // A negative balance used to render as "0 m", hiding a shortage exactly where staff
  // look for it. Show it explicitly so the deficit is visible.
  if (roundedQty < 0) {
    return `${roundedQty} ${getUnitLabel(baseUnitKey, locale)}`;
  }

  // If rate is 1 (or unusable), just return the base units
  if (!isValidRate(conversionRate) || conversionRate <= 1) {
    const baseLabel = getUnitLabel(baseUnitKey, locale);
    return `${roundedQty} ${baseLabel}`;
  }

  const { largeUnits, remainingBase } = splitStockByUom(roundedQty, conversionRate);
  const largeLabel = getUnitLabel(largeUnitKey, locale);
  const baseLabel = getUnitLabel(baseUnitKey, locale);

  if (largeUnits > 0 && remainingBase > 0) {
    // i18n: the conjunction differs per language (و / & / اور)
    const join = i18n.t('units.and_join', { lng: locale, defaultValue: '&' });
    return `${largeUnits} ${largeLabel} ${join} ${remainingBase} ${baseLabel}`;
  } else if (largeUnits > 0) {
    return `${largeUnits} ${largeLabel}`;
  } else {
    return `${remainingBase} ${baseLabel}`;
  }
}

/**
 * Translates a unit key to its localized title/label.
 */
export function getUnitLabel(unitKey: string, locale?: string): string {
  // i18n: this used to be `locale === 'ar' ? found.name : found.nameEn`, so Urdu silently
  // fell back to English while every call site passed a hardcoded 'ar' — meaning unit
  // labels stayed Arabic in all three languages. Resolve through i18n instead.
  const lowerKey = String(unitKey || '').toLowerCase();
  const found = DEFAULT_FABRIC_UNITS.find(u => u.id === lowerKey);
  if (!found) return unitKey;
  return i18n.t(`units.${found.id}`, {
    lng: locale,
    defaultValue: found.nameEn || found.name,
  });
}

/** Localized short symbol for a unit (م / m / می). */
export function getUnitSymbol(unitKey: string, locale?: string): string {
  const lowerKey = String(unitKey || '').toLowerCase();
  const found = DEFAULT_FABRIC_UNITS.find(u => u.id === lowerKey);
  if (!found) return unitKey;
  return i18n.t(`units.${found.id}_symbol`, { lng: locale, defaultValue: found.symbol });
}
