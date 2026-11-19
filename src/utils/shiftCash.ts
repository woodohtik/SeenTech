/**
 * The cash lines of a shift as the server computes them (get_shift_cash_balance,
 * the same rules close_shift settles on): cash payments attributed to the shift,
 * cash refunds, and the drawer's own deposits and withdrawals.
 */
export interface ShiftCashBalance {
  opening: number;
  /** Cash collected on the shift: sales, tailoring deposits and later settlements. */
  sales: number;
  deposits: number;
  withdrawals: number;
  returns: number;
  total: number;
}

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** The RPC's row (it may arrive as a one-row array), or null when there is none. */
export function parseShiftCashBalance(data: unknown): ShiftCashBalance | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  return {
    opening: num(r.opening),
    sales: num(r.sales),
    deposits: num(r.deposits),
    withdrawals: num(r.withdrawals),
    returns: num(r.returns),
    total: num(r.total),
  };
}

/** What the preview falls back to when the server figure cannot be read. */
export interface LocalCashLines {
  opening: number;
  cash: number;
  deposits: number;
  cashReturns: number;
  withdrawals: number;
}

/**
 * The lines the close-shift preview shows. The server's figures win whenever
 * they are available, so the preview and the settled report cannot disagree;
 * the locally summed ones are only a fallback (offline, or the call failed).
 */
export function previewCashLines(server: ShiftCashBalance | null, local: LocalCashLines): LocalCashLines & { expected: number } {
  const lines: LocalCashLines = server
    ? {
        opening: server.opening,
        cash: server.sales,
        deposits: server.deposits,
        cashReturns: server.returns,
        withdrawals: server.withdrawals,
      }
    : local;
  const expected = Math.round(
    (lines.opening + lines.cash + lines.deposits - lines.cashReturns - lines.withdrawals) * 100
  ) / 100;
  return { ...lines, expected };
}
