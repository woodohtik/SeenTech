import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// seen-readiness-fixes-task.md P6 (ZATCA-19): nothing the customer reads
// says Seen or its invoices are "approved" or "certified" by ZATCA. What is
// true today: invoices follow ZATCA's requirements. A document ZATCA itself
// cleared is a status, not a claim about Seen, and stays; so do approved
// purchase invoices (plural: the shop's own approvals).
const flatten = (o: unknown, p = ''): Array<[string, string]> =>
  o && typeof o === 'object'
    ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => flatten(v, p ? `${p}.${k}` : k))
    : typeof o === 'string' ? [[p, o]] : [];

const CLAIMS: Record<string, RegExp> = {
  ar: /معتمد[ةه]?\s+(من|ل|لدى)\s*زاتكا|زاتكا\s+(ال)?معتمد|فوترة زاتكا معتمدة|الفاتورة المعتمدة|فواتير ضريبية معتمدة/,
  en: /(approved|certified|accredited)[^.]{0,30}zat[ck]a|zat[ck]a[^.]{0,20}(approved|certified|accredited)|certified tax|approved (tax )?invoice\b(?!s)/i,
  ur: /منظور شدہ[^۔]{0,40}(ZATCA|زاٹکا)|منظور شدہ انوائس(?!ز)|(ZATCA|زاٹکا)[^۔]{0,20}(منظور شدہ|تصدیق شدہ)/,
};

describe('no "approved by ZATCA" claim', () => {
  it.each(['ar', 'en', 'ur'])('in the %s interface', (lang) => {
    const entries = flatten(JSON.parse(readFileSync(`src/i18n/locales/${lang}.json`, 'utf8')));
    const hits = entries.filter(([, v]) => CLAIMS[lang].test(v)).map(([k, v]) => `${k}: ${v}`);
    expect(hits).toEqual([]);
  });

  it('on the landing page, in either language', () => {
    const html = readFileSync('src/components/LandingPage.html', 'utf8');
    expect(html.match(CLAIMS.ar)).toBeNull();
    expect(html.match(CLAIMS.en)).toBeNull();
    expect(html).not.toMatch(/ZATKA/); // the authority's name, spelled right
  });

  // The guard itself: each pattern catches the wording that used to be there
  // (one of them was once silently broken by a stray control character).
  it('the patterns do catch the old claims, and leave honest wording alone', () => {
    expect(CLAIMS.ar.test('الفواتير الضريبية المعتمدة من زاتكا')).toBe(true);
    expect(CLAIMS.ar.test('يظهر على الفاتورة المعتمدة.')).toBe(true);
    expect(CLAIMS.en.test('Approved ZATCA E-Invoicing')).toBe(true);
    expect(CLAIMS.en.test('Appears on the approved invoice.')).toBe(true);
    expect(CLAIMS.en.test('ZATKA Certified')).toBe(true);
    expect(CLAIMS.ur.test('منظور شدہ زاٹکا ای انوائسنگ')).toBe(true);
    expect(CLAIMS.ur.test('منظور شدہ انوائس پر ظاہر ہوتا ہے۔')).toBe(true);

    expect(CLAIMS.ar.test('فواتير ضريبية متوافقة مع متطلبات زاتكا')).toBe(false);
    expect(CLAIMS.en.test('Unpaid amounts from approved invoices and purchase orders')).toBe(false);
    expect(CLAIMS.en.test("E-invoicing to ZATCA's requirements")).toBe(false);
    expect(CLAIMS.ur.test('منظور شدہ انوائسز اور خریداری آرڈرز')).toBe(false);
  });
});
