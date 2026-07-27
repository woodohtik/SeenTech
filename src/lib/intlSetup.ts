/**
 * intlSetup.ts
 * Enforces Western Arabic (English) numerals (0-9) globally across all
 * Intl.NumberFormat, Intl.DateTimeFormat, locale string formatting, and i18n.
 */

export function toLatinDigits(str: string | number | null | undefined): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
}

function normalizeLocale(locales?: string | string[]): string | string[] | undefined {
  if (!locales) return 'en-US';
  if (typeof locales === 'string') {
    if (locales.includes('-u-nu-')) return locales;
    return `${locales}-u-nu-latn`;
  }
  if (Array.isArray(locales)) {
    return locales.map((l) => (typeof l === 'string' && !l.includes('-u-nu-') ? `${l}-u-nu-latn` : l));
  }
  return locales;
}

function normalizeOptions<T extends { numberingSystem?: string }>(options?: T): T {
  return {
    ...options,
    numberingSystem: 'latn',
  } as T;
}

export function setupGlobalIntl() {
  if (typeof window === 'undefined' && typeof globalThis === 'undefined') return;

  const targetGlobal = (typeof window !== 'undefined' ? window : globalThis) as any;

  if (targetGlobal.__intlSetupDone) return;
  targetGlobal.__intlSetupDone = true;

  const OriginalNumberFormat = Intl.NumberFormat;
  const OriginalDateTimeFormat = Intl.DateTimeFormat;

  // Patch Intl.NumberFormat
  function PatchedNumberFormat(this: any, locales?: string | string[], options?: Intl.NumberFormatOptions) {
    return new OriginalNumberFormat(normalizeLocale(locales) as any, normalizeOptions(options));
  }

  PatchedNumberFormat.prototype = OriginalNumberFormat.prototype;
  PatchedNumberFormat.supportedLocalesOf = OriginalNumberFormat.supportedLocalesOf;
  Intl.NumberFormat = PatchedNumberFormat as any;

  // Patch Intl.DateTimeFormat
  function PatchedDateTimeFormat(this: any, locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
    return new OriginalDateTimeFormat(normalizeLocale(locales) as any, normalizeOptions(options));
  }

  PatchedDateTimeFormat.prototype = OriginalDateTimeFormat.prototype;
  PatchedDateTimeFormat.supportedLocalesOf = OriginalDateTimeFormat.supportedLocalesOf;
  Intl.DateTimeFormat = PatchedDateTimeFormat as any;

  // Patch Number.prototype.toLocaleString
  const origNumberToLocaleString = Number.prototype.toLocaleString;
  Number.prototype.toLocaleString = function (this: number, locales?: string | string[], options?: Intl.NumberFormatOptions) {
    return toLatinDigits(origNumberToLocaleString.call(this, normalizeLocale(locales) as any, normalizeOptions(options)));
  };

  // Patch Date.prototype.toLocaleString
  const origDateToLocaleString = Date.prototype.toLocaleString;
  Date.prototype.toLocaleString = function (this: Date, locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
    return toLatinDigits(origDateToLocaleString.call(this, normalizeLocale(locales) as any, normalizeOptions(options)));
  };

  // Patch Date.prototype.toLocaleDateString
  const origDateToLocaleDateString = Date.prototype.toLocaleDateString;
  Date.prototype.toLocaleDateString = function (this: Date, locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
    return toLatinDigits(origDateToLocaleDateString.call(this, normalizeLocale(locales) as any, normalizeOptions(options)));
  };

  // Patch Date.prototype.toLocaleTimeString
  const origDateToLocaleTimeString = Date.prototype.toLocaleTimeString;
  Date.prototype.toLocaleTimeString = function (this: Date, locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
    return toLatinDigits(origDateToLocaleTimeString.call(this, normalizeLocale(locales) as any, normalizeOptions(options)));
  };
}

setupGlobalIntl();

