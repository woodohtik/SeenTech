/**
 * Formats/normalizes phone numbers according to Saudi rules:
 * - Converts Eastern Arabic digits (٠-٩) to standard digits (0-9)
 * - If starts with '05' or '01': removes leading '0' and prepends '+966'
 * - If starts with '5' or '1': prepends '+966'
 * - If starts with '00966': replaces '00966' with '+966'
 * - If starts with '966': prepends '+'
 * - If already starts with '+966': keeps as is
 */
export function formatSaudiPhone(phone: string | null | undefined): string {
  if (!phone) return '';

  // Convert Eastern Arabic numerals to standard English numbers, and strip
  // internal spaces/dashes a human typed or a legacy import left in (e.g.
  // "050 123 4567", "050-123-4567", "+966 50 123 4567") -- the branches
  // below only ever check/slice a handful of literal prefixes, and the
  // final regex in validations.ts allows at most one separator right after
  // an optional country code, so any of those internal separators survived
  // into the saved value and made even an unrelated edit to the same
  // customer fail validation on every later save.
  const str = String(phone)
    .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d).toString())
    .replace(/[\s-]/g, '')
    .trim();

  if (!str) return '';

  // If already starts with +966
  if (str.startsWith('+966')) {
    return str;
  }
  // If starts with 00966
  if (str.startsWith('00966')) {
    return '+' + str.slice(2);
  }
  // If starts with 966
  if (str.startsWith('966')) {
    return '+' + str;
  }
  // If starts with 05 or 01 -> remove leading 0 and add +966
  if (str.startsWith('05') || str.startsWith('01')) {
    return '+966' + str.slice(1);
  }
  // If starts with 5 or 1 -> add +966
  if (str.startsWith('5') || str.startsWith('1')) {
    return '+966' + str;
  }

  return str;
}

export function validateSaudiPhone(phone: string | null | undefined): boolean {
  if (!phone) return false;
  const formatted = formatSaudiPhone(phone);
  return /^(\+966)(5|1)\d{8}$/.test(formatted);
}
