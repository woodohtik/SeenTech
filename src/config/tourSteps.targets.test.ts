import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { TOUR_STEPS } from './tourSteps';

// seen-readiness-fixes-task.md P4 (UX-13): every element a tour step points at
// exists somewhere in the app's code -- a missing one left the tour waiting,
// then showing a step pointing at nothing.
function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : sourceFiles(p);
    return /\.(tsx|ts)$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
  });
}
const code = sourceFiles(path.resolve(__dirname, '..')).map((f) => fs.readFileSync(f, 'utf8')).join('\n');

describe('tour targets', () => {
  const ids = new Set<string>();
  for (const step of TOUR_STEPS as any[]) {
    for (const sel of [step.element, step.mobileElement, ...(step.fallbacks || [])]) {
      if (typeof sel === 'string' && sel.startsWith('#')) ids.add(sel.slice(1));
    }
  }
  it.each([...ids].map((id) => [id]))('#%s exists in the code', (id) => {
    const used = code.includes(`id="${id}"`) || code.includes(`'${id}'`) || code.includes(`\`${id}\``) || code.includes(`"${id}"`);
    expect(used).toBe(true);
  });
});
