/**
 * The shop's own barcodes (seen-product-variants-barcode-po-price-task.md,
 * phase 1): EAN-13 -- what every scanner reads -- in the range that starts
 * with "2", kept for in-store use (it never clashes with a maker's code),
 * with its check digit, and never one the shop already uses (products or
 * variants; is_barcode_available, 20270123000000). Replaces the ten random
 * digits with no check digit and no uniqueness check.
 */

export function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

function randomDigits(n: number): string {
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => String(b % 10)).join('');
}

export interface BarcodeDeps {
  /** Whether the shop uses this code nowhere yet. */
  isAvailable: (code: string) => Promise<boolean>;
}

const defaultDeps: BarcodeDeps = {
  isAvailable: async (code) => {
    const { supabase } = await import('./supabase/client');
    const { data, error } = await supabase.rpc('is_barcode_available', { p_barcode: code });
    if (error) throw error;
    return data === true;
  },
};

export async function generateInternalBarcode(deps: BarcodeDeps = defaultDeps): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const first12 = `2${randomDigits(11)}`;
    const code = `${first12}${ean13CheckDigit(first12)}`;
    if (await deps.isAvailable(code)) return code;
  }
  throw new Error('barcode_generation_failed');
}
