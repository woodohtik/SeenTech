/**
 * Normalizes Arabic text so common spelling variants map to the same form
 * (hamza-bearing alef forms, taa marbuta/haa, alef maksura/yaa) and strips
 * harakat/tatweel. Shared by number-word parsing and fuzzy search so both
 * treat spelling variants the same way.
 */
export function normalizeArabicText(text: string): string {
  return text
    .replace(/[ً-ْـ]/g, '') // harakat and tatweel
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[ئؤ]/g, 'ء')
    .trim();
}
