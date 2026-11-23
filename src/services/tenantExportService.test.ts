import { describe, expect, it } from 'vitest';
import { slug, toCsv } from './tenantExportService';

// seen-readiness-fixes-task.md P5 (PLATFORM-08).
const BOM = '﻿';

describe('tenant export helpers', () => {
  it('a file name from an Arabic shop name', () => {
    expect(slug('محل الأناقة / جدة')).toBe('محل-الأناقة-جدة');
    expect(slug('')).toBe('');
  });

  it('CSV: BOM, every cell quoted, quotes doubled', () => {
    const csv = toCsv([{ a: 'x"y', b: 'ok' }, { a: null }], ['a', 'b']);
    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv.split('\r\n')).toEqual([`${BOM}"a","b"`, '"x""y","ok"', '"",""']);
  });

  it('CSV: a cell that starts like a formula is made inert', () => {
    const csv = toCsv([{ a: '=HYPERLINK("x")', b: '+1', c: '-2', d: '@SUM(A1)', e: '\t=1' }], ['a', 'b', 'c', 'd', 'e']);
    expect(csv.split('\r\n')[1]).toBe(`"'=HYPERLINK(""x"")","'+1","'-2","'@SUM(A1)","'\t=1"`);
  });
});
