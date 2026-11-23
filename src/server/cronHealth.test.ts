import { describe, expect, it } from 'vitest';
import { cronProblems } from './cronHealth';

// seen-readiness-fixes-task.md P6 (PLATFORM-20).
const now = new Date('2026-11-23T12:00:00Z');
const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();
const ok = { name: 'seen_trial_lock', schedule: '*/15 * * * *', active: true, last_status: 'succeeded', last_start: ago(0.2) };

describe('cronProblems', () => {
  it('nothing to say when every job ran and succeeded', () => {
    expect(cronProblems({ pg_cron: true, jobs: [ok, { ...ok, name: 'seen_trial_purge', last_start: ago(9) }] }, now)).toEqual([]);
  });

  it('pg_cron missing is said plainly (its scheduling used to be skipped in silence)', () => {
    expect(cronProblems({ pg_cron: false, jobs: [] }, now)[0]).toMatch(/pg_cron is not installed/);
    expect(cronProblems({ pg_cron: true, jobs: [] }, now)[0]).toMatch(/no job is scheduled/);
    expect(cronProblems(null, now)[0]).toMatch(/could not be read/);
  });

  it('names a job that failed, never ran, is switched off, or went stale', () => {
    const problems = cronProblems({ pg_cron: true, jobs: [
      { ...ok, name: 'a', last_status: 'failed', last_message: 'boom' },
      { ...ok, name: 'b', last_start: null },
      { ...ok, name: 'c', active: false },
      { ...ok, name: 'd', last_start: ago(40) },
    ] }, now);
    expect(problems).toEqual(['a: last run failed (boom)', 'b: has never run', 'c: switched off', 'd: last ran 40 hours ago']);
  });
});
