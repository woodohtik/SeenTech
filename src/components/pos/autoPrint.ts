/**
 * Whether the receipt prints by itself after a sale (Settings > Printer, or
 * the POS settings; the same key). Read when the sale is made, not once when
 * the POS opens (seen-merchant-trial-test-2026-11-26.md, phase 3 item 7).
 */
export const AUTO_PRINT_KEY = 'pos_auto_print';

export function isAutoPrintOn(): boolean {
  try {
    return localStorage.getItem(AUTO_PRINT_KEY) !== 'false';
  } catch {
    return true;
  }
}
