import React, { useEffect, useState } from 'react';

/**
 * A cart line's piece count you can type (seen-merchant-trial-test-2026-11-26.md,
 * phase 3 item 7): ten buttons took ten taps of "+". Applied on Enter or when
 * the box loses focus; the stock check stays where it was (the POS).
 */
export function PieceQuantityInput({ value, onCommit, label }: { value: number; onCommit: (n: number) => void; label: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);

  const commit = () => {
    const n = Math.floor(Number(text));
    if (!Number.isFinite(n) || n < 1) { setText(String(value)); return; }
    if (n !== value) onCommit(n);
  };

  return (
    <input
      type="number"
      inputMode="numeric"
      min={1}
      step={1}
      aria-label={label}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
      onFocus={(e) => e.currentTarget.select()}
      className="w-12 h-11 text-center font-bold text-content bg-transparent border-0 outline-none focus:ring-2 focus:ring-brand/30 rounded [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
    />
  );
}
