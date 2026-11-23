import { describe, expect, it } from 'vitest';
import { fitTlvValue, generateZatcaQR, toTLV } from './zatca';

// seen-readiness-fixes-task.md P6 (CODEHEALTH-11): the QR on every simplified
// invoice -- decoded back, field by field.
function decode(base64: string): Array<{ tag: number; value: string }> {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const out: Array<{ tag: number; value: string }> = [];
  for (let i = 0; i < bytes.length;) {
    const tag = bytes[i];
    const len = bytes[i + 1];
    out.push({ tag, value: new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(i + 2, i + 2 + len)) });
    i += 2 + len;
  }
  return out;
}

describe('the ZATCA QR', () => {
  it('carries the five fields, in order, with their byte lengths', () => {
    const fields = decode(generateZatcaQR('مشغل الأناقة', '310000000000003', '2026-11-23T10:15:30Z', '115.00', '15.00'));
    expect(fields).toEqual([
      { tag: 1, value: 'مشغل الأناقة' },
      { tag: 2, value: '310000000000003' },
      { tag: 3, value: '2026-11-23T10:15:30Z' },
      { tag: 4, value: '115.00' },
      { tag: 5, value: '15.00' },
    ]);
  });

  it('the length is in bytes, not letters', () => {
    const tlv = toTLV(1, 'سين');
    expect(Array.from(tlv.slice(0, 2))).toEqual([1, 6]); // 3 Arabic letters = 6 bytes
  });

  it('a seller name over 255 bytes is cut on a whole letter, and the fields after it stay readable', () => {
    const longName = 'مؤسسة '.repeat(40); // 440 bytes
    const fitted = fitTlvValue(longName);
    expect(fitted.length).toBeLessThanOrEqual(255);
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(fitted)).not.toThrow();

    const fields = decode(generateZatcaQR(longName, '310000000000003', '2026-11-23T10:15:30Z', '115.00', '15.00'));
    expect(fields.map((f) => f.tag)).toEqual([1, 2, 3, 4, 5]);
    expect(longName.startsWith(fields[0].value)).toBe(true);
    expect(fields[1].value).toBe('310000000000003');
    expect(fields[4].value).toBe('15.00');
  });
});
