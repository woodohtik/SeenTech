/**
 * Approximate text matching, used ONLY as a fallback when an exact
 * substring search yields zero results -- voice-dictated search queries
 * sometimes have a letter added, dropped, or swapped by speech recognition,
 * so an exact match that should have hit can legitimately miss by one or
 * two letters.
 */
import { normalizeArabicText } from './normalizeArabic';
import { levenshteinDistance } from './levenshtein';

/** Short words tolerate a 1-letter difference; longer words tolerate 2. */
function closeEnough(a: string, b: string): boolean {
  const threshold = Math.min(a.length, b.length) <= 4 ? 1 : 2;
  return levenshteinDistance(a, b) <= threshold;
}

/**
 * True if every word in `query` closely matches some word in `text`.
 * Word order doesn't matter (a customer's name may be spoken in a
 * different order than it's stored).
 */
export function fuzzyIncludes(text: string, query: string): boolean {
  const normalizedQuery = normalizeArabicText(query.toLowerCase()).trim();
  if (!normalizedQuery) return true;

  const normalizedText = normalizeArabicText(text.toLowerCase());
  const queryWords = normalizedQuery.split(/\s+/).filter(Boolean);
  const textWords = normalizedText.split(/\s+/).filter(Boolean);

  return queryWords.every((qWord) => textWords.some((tWord) => closeEnough(qWord, tWord)));
}
