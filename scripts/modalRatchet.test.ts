// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import baseline from './modalRatchet.baseline.json';

/**
 * seen-ui-responsive-alignment-audit-task.md, phase 2.4: no NEW hand-built
 * window. A window is ui/DialogFrame (DialogFrame / DialogPanel / DialogDiv)
 * or ui/Modal: role, focus, Esc, above the assistant button. The ~120
 * hand-built `fixed inset-0` layers of today are counted per file
 * (modalRatchet.baseline.json); a file may only go DOWN. Moving a window to
 * the shared frame: lower its number in the baseline in the same commit.
 *
 * (An ESLint rule was the task's wording; with 120 existing layers it would
 * have broken the warning ceiling -- this ratchet stops new ones the same way.)
 */
const ALLOWED = new Set(['src/components/ui/DialogFrame.tsx', 'src/components/ui/Modal.tsx', 'src/components/Layout.tsx']);

function count(): Record<string, number> {
  const out: Record<string, number> = {};
  const walk = (d: string) => {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.tsx') && !f.endsWith('.test.tsx')) {
        const n = (fs.readFileSync(p, 'utf8').match(/fixed inset-0/g) || []).length;
        if (n) out[p.split(path.sep).join('/')] = n;
      }
    }
  };
  walk('src');
  return out;
}

describe('hand-built windows only go down', () => {
  it('no file has more fixed inset-0 layers than its baseline', () => {
    const now = count();
    const base = baseline as Record<string, number>;
    const grew = Object.entries(now)
      .filter(([file, n]) => !ALLOWED.has(file) && n > (base[file] ?? 0))
      .map(([file, n]) => `${file}: ${n} (baseline ${base[file] ?? 0}) -- use ui/DialogFrame`);
    expect(grew).toEqual([]);
  });
});
