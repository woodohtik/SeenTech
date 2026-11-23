import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentFiles, PRINT } from '../scripts/responsive/content-files.mjs';

/**
 * seen-responsive-layout-task.md, kept true after the task:
 *   - content decides by the content's width, not the window's (Phase 3);
 *   - no readable text under 14px (acceptance criterion 4);
 *   - no letter-spacing on Arabic (DESIGN.md §2, criterion 4).
 * Each exception is listed here with its reason, as the task asks.
 */
const ROOT = path.resolve(__dirname, '..');
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');

function sourceFiles(dir = path.join(ROOT, 'src'), out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) out.push(path.relative(ROOT, full).replace(/\\/g, '/'));
  }
  return out;
}
const isPrint = (file: string) => (PRINT as RegExp[]).some((re) => re.test(file));

/**
 * The customer's own pages (order tracking, measurements link, partner
 * referrals): outside the app and its shell, with their own theme
 * (publicTrackingTheme.css). Not in this task's screens; their inline sizes
 * are left for their own pass.
 */
const PUBLIC_PAGES = [/^src\/components\/public\//, /^src\/components\/customer\//];

/** Letter-spacing kept on purpose: each spreads the digits of a code being typed, never Arabic text. */
const SPACED_DIGITS: Record<string, number> = {
  'src/components/PinLogin.tsx': 2, // new PIN, confirm PIN
  'src/components/ForcePinSetup.tsx': 2, // new PIN, confirm PIN
  'src/components/AddEmployeeModal.tsx': 1, // the employee's PIN
  'src/components/Staff.tsx': 2, // PIN fields
  'src/components/TwoFactorSetup.tsx': 1, // the six-digit code
  'src/components/TwoFactorChallenge.tsx': 1, // the six-digit code
  'src/components/PrinterSettings.tsx': 1, // the printer's pairing code
};

describe('responsive guard', () => {
  it('content screens use the content-width variants, not the window ones', () => {
    const found: string[] = [];
    for (const file of contentFiles() as string[]) {
      read(file).split('\n').forEach((line, i) => {
        if (/(?<=["'`\s:(])(sm|md|lg|xl|2xl):(?=[a-zA-Z[\-!@*])/.test(line)) found.push(`${file}:${i + 1}`);
      });
    }
    expect(found, 'inside the content area, use main-640: main-720: main-900: main-1024: main-1280: (index.css)').toEqual([]);
  });

  it('no text under 14px on screen (print documents set their own sizes)', () => {
    const found: string[] = [];
    for (const file of sourceFiles().filter((f) => !isPrint(f))) {
      read(file).split('\n').forEach((line, i) => {
        if (/(?<![\w-])(?:[a-z0-9-]+:)*text-(?:\[(?:[0-9]|1[0-3])(?:\.\d+)?px\]|xs)(?![\w-])/.test(line)) found.push(`${file}:${i + 1}`);
      });
    }
    expect(found, 'the smallest readable size is text-sm (14px)').toEqual([]);
  });

  it('no inline size under 14px either (chart labels, style objects)', () => {
    const found: string[] = [];
    for (const file of sourceFiles().filter((f) => !isPrint(f) && !PUBLIC_PAGES.some((re) => re.test(f)))) {
      read(file).split('\n').forEach((line, i) => {
        if (/fontSize: ?['"]?([0-9]|1[0-3])(\.[0-9]+)?(px)?['"]?\s*[,}]/.test(line)) found.push(`${file}:${i + 1}`);
      });
    }
    expect(found).toEqual([]);
  });

  it('no letter-spacing, except on spread-out digits of a code', () => {
    const counts: Record<string, number> = {};
    for (const file of sourceFiles().filter((f) => !isPrint(f))) {
      const n = (read(file).match(/(?<![\w-])(?:[a-z0-9-]+:)*tracking-[a-z0-9[]/g) || []).length;
      if (n) counts[file] = n;
    }
    expect(counts).toEqual(SPACED_DIGITS);
  });
});
