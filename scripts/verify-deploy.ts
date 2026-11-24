/**
 * After a deploy: is the live site the commit that was pushed?
 * (seen-update-delivery-fix-task.md, phase 6)
 *
 *   npx tsx scripts/verify-deploy.ts [--host www.seentech.io] [--ref origin/main]
 *
 * Reads https://<host>/version.json (written by every build, never cached)
 * and compares its commit with `git rev-parse --short=7 <ref>`. It also checks
 * that a missing code file is a real 404, and the no-store headers. Exits 1,
 * saying why, on any mismatch.
 */
import { execFileSync } from 'node:child_process';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const host = arg('host', 'www.seentech.io');
const ref = arg('ref', host.startsWith('staging.') ? 'origin/staging' : 'origin/main');

async function main() {
  const problems: string[] = [];
  const expected = execFileSync('git', ['rev-parse', '--short=7', ref]).toString().trim();

  const res = await fetch(`https://${host}/version.json`, { cache: 'no-store' });
  const live = res.ok ? ((await res.json()) as { build?: string; builtAt?: string; mandatory?: boolean }) : null;
  const liveCommit = live?.build?.split('-')[0];
  console.log(`${host}: live build ${live?.build ?? '(none)'} built ${live?.builtAt ?? '?'}; ${ref} is ${expected}`);
  if (liveCommit !== expected) problems.push(`the live build is ${liveCommit ?? 'unknown'}, not ${expected} (${ref})`);

  const missing = await fetch(`https://${host}/assets/verify-deploy-missing-${Date.now()}.js`);
  if (missing.status !== 404) problems.push(`a missing /assets/ file answers ${missing.status} (${missing.headers.get('content-type')}), not 404`);

  for (const path of ['/sw.js', '/version.json', '/index.html']) {
    const head = await fetch(`https://${host}${path}`, { method: 'HEAD' });
    const cache = head.headers.get('cache-control') || '';
    if (!/no-store/.test(cache)) problems.push(`${path} is cacheable: "${cache}"`);
  }

  if (problems.length) {
    console.error(`\nNOT OK:\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
  console.log('OK: live build matches, missing files are 404, update files are not cached.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
