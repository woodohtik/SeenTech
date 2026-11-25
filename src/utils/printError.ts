/**
 * A print error we wrote ourselves (seen-friendly-errors-everywhere-task.md):
 * its message is one of our own translated texts, so it may be shown. Any
 * other error from a print path (the browser's, the print program's, the
 * printer's) is not shown -- the print manager shows its own text instead,
 * and the original goes to the console.
 *
 * Codes for support:
 *   PRN-01 the printer cannot be reached (network, USB, Bluetooth, serial)
 *   PRN-02 the print program (relay / local agent) cannot be reached
 *   PRN-03 the browser does not allow this way of printing
 *   PRN-04 there is nothing to print (the invoice is empty or missing)
 *   PRN-05 sent, but no confirmation (check the printer before printing again)
 *   PRN-06 the print dialog could not open
 *   PRN-00 anything else
 */
export type PrintErrorCode = 'PRN-00' | 'PRN-01' | 'PRN-02' | 'PRN-03' | 'PRN-04' | 'PRN-05' | 'PRN-06';

export class PrintError extends Error {
  readonly friendly = true as const;
  readonly userErrorKind = 'printer' as const;
  readonly code: PrintErrorCode;
  constructor(message: string, code: PrintErrorCode = 'PRN-00') {
    super(message);
    this.name = 'PrintError';
    this.code = code;
  }
}

/** The code of a failed print path. */
export function printCodeForTransport(transport: string): PrintErrorCode {
  if (transport === 'relay' || transport === 'agent') return 'PRN-02';
  if (['network', 'usb', 'serial', 'bluetooth', 'android', 'system'].includes(transport)) return 'PRN-01';
  return 'PRN-00';
}

/** Our own text, or the fallback -- never another error's text. */
export function shownPrintMessage(e: unknown, fallback: string): string {
  return e instanceof PrintError ? e.message : fallback;
}
