/**
 * seen-readiness-fixes-task.md P6 (PLATFORM-20): what is wrong with the
 * database's scheduled jobs, from saas_cron_health(). The trial lock, the
 * purge and the clean-ups all run on pg_cron, and nothing watched them: a
 * missing extension skipped their scheduling silently, and a failing job
 * failed silently.
 */
export type CronJob = {
  name: string;
  schedule?: string | null;
  active?: boolean | null;
  last_status?: string | null;
  last_start?: string | null;
  last_end?: string | null;
  last_message?: string | null;
};
export type CronHealth = { pg_cron?: boolean; jobs?: CronJob[] } | null | undefined;

/** Every job here runs at least once a day; with a margin, a last run older than this is stale. */
export const STALE_AFTER_HOURS = 26;

export function cronProblems(health: CronHealth, now: Date = new Date()): string[] {
  if (!health) return ['the scheduled jobs could not be read'];
  if (!health.pg_cron) return ['pg_cron is not installed: no scheduled job runs (trial lock, purge, clean-ups)'];
  const jobs = health.jobs || [];
  if (jobs.length === 0) return ['pg_cron is installed but no job is scheduled'];
  const problems: string[] = [];
  for (const j of jobs) {
    if (j.active === false) { problems.push(`${j.name}: switched off`); continue; }
    if (!j.last_start) { problems.push(`${j.name}: has never run`); continue; }
    if (j.last_status === 'failed') problems.push(`${j.name}: last run failed${j.last_message ? ` (${j.last_message})` : ''}`);
    const ageHours = (now.getTime() - new Date(j.last_start).getTime()) / 3_600_000;
    if (ageHours > STALE_AFTER_HOURS) problems.push(`${j.name}: last ran ${Math.round(ageHours)} hours ago`);
  }
  return problems;
}
