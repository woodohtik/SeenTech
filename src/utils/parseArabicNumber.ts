/**
 * Parses a spoken or typed Arabic number into a JavaScript number.
 *
 * Covers digits (ASCII and Arabic-Indic) and spoken Arabic number words in
 * the 0-300 range (the realistic measurement range). Returns `null` for
 * anything it cannot parse exactly, so callers never act on a guessed value.
 */

type PartKind = 'hundred' | 'teen' | 'tens' | 'ones';

interface Part {
  value: number;
  kind: PartKind;
}

/** Normalizes Arabic text so that spelling variants map to the same key. */
function normalize(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[ً-ْـ]/g, '') // harakat and tatweel
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[ئؤ]/g, 'ء')
    .trim();
}

function build(entries: Array<[string, number, PartKind]>): Map<string, Part> {
  const map = new Map<string, Part>();
  for (const [word, value, kind] of entries) {
    map.set(normalize(word), { value, kind });
  }
  return map;
}

// Single-word numbers.
const SINGLE = build([
  ['صفر', 0, 'ones'],
  ['واحد', 1, 'ones'],
  ['احدى', 1, 'ones'],
  ['اثنان', 2, 'ones'],
  ['ثلاثة', 3, 'ones'],
  ['أربعة', 4, 'ones'],
  ['خمسة', 5, 'ones'],
  ['ستة', 6, 'ones'],
  ['سبعة', 7, 'ones'],
  ['ثمانية', 8, 'ones'],
  ['تسعة', 9, 'ones'],
  ['عشرة', 10, 'teen'],
  ['عشرون', 20, 'tens'],
  ['عشرين', 20, 'tens'],
  ['ثلاثون', 30, 'tens'],
  ['ثلاثين', 30, 'tens'],
  ['أربعون', 40, 'tens'],
  ['أربعين', 40, 'tens'],
  ['خمسون', 50, 'tens'],
  ['خمسين', 50, 'tens'],
  ['ستون', 60, 'tens'],
  ['ستين', 60, 'tens'],
  ['سبعون', 70, 'tens'],
  ['سبعين', 70, 'tens'],
  ['ثمانون', 80, 'tens'],
  ['ثمانين', 80, 'tens'],
  ['تسعون', 90, 'tens'],
  ['تسعين', 90, 'tens'],
  ['مئة', 100, 'hundred'],
  ['مائة', 100, 'hundred'],
  ['مئتان', 200, 'hundred'],
  ['مئتين', 200, 'hundred'],
  ['ثلاثمئة', 300, 'hundred'],
]);

// Two-word teens (11-19), e.g. "أحد عشر". Keys are the normalized pair.
const TEEN_PHRASES = build([
  ['أحد عشر', 11, 'teen'],
  ['اثنا عشر', 12, 'teen'],
  ['اثني عشر', 12, 'teen'],
  ['ثلاثة عشر', 13, 'teen'],
  ['أربعة عشر', 14, 'teen'],
  ['خمسة عشر', 15, 'teen'],
  ['ستة عشر', 16, 'teen'],
  ['سبعة عشر', 17, 'teen'],
  ['ثمانية عشر', 18, 'teen'],
  ['تسعة عشر', 19, 'teen'],
]);

/**
 * Splits the normalized text into number parts. Handles the conjunction "و"
 * attached to a word (e.g. "وأربعين") as well as a standalone "و".
 * Returns null if any word matches nothing.
 */
function tokenize(normalized: string): Part[] | null {
  const words = normalized.split(/\s+/).filter((w) => w.length > 0);
  const parts: Part[] = [];

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word === undefined) continue;

    if (word === 'و') continue;

    const next = words[i + 1];
    if (next !== undefined) {
      const pair = TEEN_PHRASES.get(`${word} ${next}`);
      if (pair) {
        parts.push(pair);
        i++;
        continue;
      }
    }

    const direct = SINGLE.get(word);
    if (direct) {
      parts.push(direct);
      continue;
    }

    if (word.startsWith('و')) {
      const stripped = SINGLE.get(word.slice(1));
      if (stripped) {
        parts.push(stripped);
        continue;
      }
    }

    return null;
  }

  return parts;
}

/**
 * Combines parts into one value. Shape:
 *   [hundreds]? then at most two remaining parts.
 * Two remaining parts must be one tens and one ones, in either order
 * ("خمسة وأربعين" = ones before tens, which is the spoken Arabic order).
 * Zero only stands alone.
 */
function combine(parts: Part[]): number | null {
  if (parts.length === 0) return null;
  if (parts.length > 1 && parts.some((p) => p.value === 0)) return null;

  let total = 0;
  let rest = parts;

  const first = parts[0];
  if (first && first.kind === 'hundred') {
    total = first.value;
    rest = parts.slice(1);
  }

  if (rest.some((p) => p.kind === 'hundred')) return null;

  if (rest.length === 0) return total;

  if (rest.length === 1) {
    const only = rest[0];
    return only ? total + only.value : null;
  }

  if (rest.length === 2) {
    const a = rest[0];
    const b = rest[1];
    if (!a || !b) return null;
    const oneTens =
      (a.kind === 'ones' && b.kind === 'tens') ||
      (a.kind === 'tens' && b.kind === 'ones');
    if (oneTens) return total + a.value + b.value;
  }

  return null;
}

export function parseArabicNumber(text: string): number | null {
  const normalized = normalize(text);
  if (normalized.length === 0) return null;

  const numeric = parseFloat(normalized);
  if (Number.isFinite(numeric)) return numeric;

  const parts = tokenize(normalized);
  if (parts === null) return null;

  return combine(parts);
}
