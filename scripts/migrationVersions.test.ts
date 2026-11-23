import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// seen-readiness-fixes-task.md P6 (PLATFORM-13): the rule for a migration's
// version, enforced.
//
// Supabase applies migrations in the order of their version, and records
// each version once. This repository's versions ran ahead of the calendar
// (they reach 2027 while the work was done in 2026), and four old files
// carry 8-digit versions. Neither is renumbered -- they are applied -- but
// from here on:
//   * a version is 14 digits, YYYYMMDDHHMMSS-shaped;
//   * no two files share one;
//   * a NEW migration takes the highest existing version + 1 (never "today's
//     date", which would sort before what production has already applied
//     and be skipped or applied out of order).
const LEGACY_SHORT = new Set(['20240704', '20240705', '20260815', '20260816']);
const files = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort();
const version = (f: string) => f.slice(0, f.indexOf('_'));

describe('migration versions', () => {
  it('every file is <version>_<snake_case_name>.sql', () => {
    const bad = files.filter((f) => !/^\d+_[a-z0-9_]+\.sql$/.test(f));
    expect(bad).toEqual([]);
  });

  it('versions are 14 digits (but for the four old short ones, which stay as applied)', () => {
    const bad = files.filter((f) => !/^\d{14}$/.test(version(f)) && !LEGACY_SHORT.has(version(f)));
    expect(bad).toEqual([]);
    for (const v of LEGACY_SHORT) expect(files.some((f) => version(f) === v), `legacy ${v} is still here`).toBe(true);
  });

  it('no version is used twice', () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const f of files) {
      const v = version(f);
      if (seen.has(v)) clashes.push(`${seen.get(v)} / ${f}`);
      seen.set(v, f);
    }
    expect(clashes).toEqual([]);
  });

  it('every migration from the readiness work on has a rollback beside it', () => {
    // 20270102 is where the readiness fixes begin; each has supabase/rollbacks/<date>_<name>.down.sql.
    const rollbacks = new Set(readdirSync('supabase/rollbacks'));
    const missing = files
      .filter((f) => /^\d{14}_/.test(f) && version(f) >= '20270106000000')
      .filter((f) => !rollbacks.has(`${version(f).slice(0, 8)}_${f.slice(f.indexOf('_') + 1).replace(/\.sql$/, '')}.down.sql`));
    expect(missing).toEqual([]);
  });
});
