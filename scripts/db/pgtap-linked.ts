/**
 * Runs pgTAP files against the linked Supabase database (staging) and prints
 * every failed assertion (seen-stability-guardrails-task.md).
 *
 *   npx tsx scripts/db/pgtap-linked.ts                      # every supabase/tests/*.sql
 *   npx tsx scripts/db/pgtap-linked.ts supabase/tests/x.sql # one file
 *
 * CI runs the same files with `supabase test db` on a fresh local database;
 * this is for a machine without Docker. Each file is one transaction ending
 * in ROLLBACK, so nothing is kept. `supabase db query` returns only the last
 * statement's rows, so each assertion's TAP line is collected into a temp
 * table and the failures are returned at the end.
 *
 * Exit code 1 when any assertion fails or a file does not run.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ASSERTIONS = [
  'ok', 'is', 'isnt', 'throws_ok', 'lives_ok', 'throws_like', 'throws_matching', 'results_eq', 'results_ne',
  'matches', 'imatches', 'alike', 'cmp_ok', 'is_empty', 'isnt_empty', 'row_eq', 'set_eq', 'bag_eq',
  'function_returns', 'is_definer', 'isnt_definer', 'pass', 'fail', 'fk_ok',
];
const ASSERT_START = new RegExp(`^SELECT\\s+((?:${ASSERTIONS.join('|')})|has_\\w+|hasnt_\\w+|policy_\\w+|col_\\w+)\\s*\\(`, 'gim');
const COLLECT = 'CREATE TEMP TABLE _tap_lines (n serial, line text); GRANT ALL ON _tap_lines TO PUBLIC; GRANT ALL ON SEQUENCE _tap_lines_n_seq TO PUBLIC;';
const SUMMARY = "SELECT (SELECT count(*) FROM _tap_lines) AS total, (SELECT count(*) FROM _tap_lines WHERE line LIKE 'not ok%') AS failed, " +
  "(SELECT string_agg(line, E'\\n' ORDER BY n) FROM _tap_lines WHERE line LIKE 'not ok%') AS failures;";

export function instrument(sql: string): string {
  let s = sql.replace(/(SELECT\s+(?:plan\(\s*\d+\s*\)|no_plan\(\))\s*;)/i, `$1\n${COLLECT}`);
  // Files that keep their own test_output table: theirs becomes ours.
  s = s.replace(/^CREATE TEMP TABLE test_output\b[^;]*;/gim, '');
  s = s.replace(/^GRANT [^;\n]* ON test_output\b[^;\n]*;/gim, '');
  s = s.replace(/^SELECT line FROM test_output ORDER BY seq;/gim, '');
  s = s.replace(/INSERT INTO test_output \(line\) SELECT/g, 'INSERT INTO _tap_lines (line) SELECT');
  s = s.replace(ASSERT_START, (_m, fn: string) => `INSERT INTO _tap_lines (line) SELECT ${fn}(`);
  // finish() (alone or inserted somewhere): the summary instead.
  s = s.replace(/^[^;\n]*finish\(\)[^;\n]*;/gim, SUMMARY);
  return s;
}

function run(file: string, dir: string): boolean {
  const out = path.join(dir, path.basename(file));
  writeFileSync(out, instrument(readFileSync(file, 'utf8')));
  let text = '';
  try {
    text = execFileSync('npx', ['supabase', 'db', 'query', '--linked', '--file', out], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32',
    });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    text = `${err.stdout ?? ''}${err.stderr ?? ''}`;
  }
  const name = path.basename(file);
  const start = text.indexOf('{');
  try {
    const data = JSON.parse(text.slice(start, text.lastIndexOf('}') + 1));
    const row = data.rows?.[data.rows.length - 1];
    if (!row) throw new Error(JSON.stringify(data).slice(0, 400));
    console.log(`${Number(row.failed) ? 'FAIL' : 'ok  '} ${name}: ${row.total} assertions, ${row.failed} failed`);
    if (row.failures) for (const line of String(row.failures).split('\n')) if (line.startsWith('not ok') || line.startsWith('#')) console.log(`       ${line}`);
    return Number(row.failed) === 0;
  } catch (e) {
    console.log(`FAIL ${name}: did not run -- ${(e as Error).message.slice(0, 400)}`);
    return false;
  }
}

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync('supabase/tests').filter((f) => f.endsWith('.sql')).sort().map((f) => path.join('supabase/tests', f));
const dir = mkdtempSync(path.join(tmpdir(), 'pgtap-'));
let ok = true;
for (const f of files) ok = run(f, dir) && ok;
process.exit(ok ? 0 : 1);
