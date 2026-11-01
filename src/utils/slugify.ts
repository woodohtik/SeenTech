/**
 * Converts a title into a URL slug.
 * Keeps letters (Arabic and Latin), combining marks (Arabic diacritics),
 * and digits; strips punctuation and symbols; turns whitespace runs into a
 * single hyphen; trims leading and trailing hyphens.
 */
export function slugify(title: string): string {
  return title
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '');
}
