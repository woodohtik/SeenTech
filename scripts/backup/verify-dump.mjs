#!/usr/bin/env node
// seen-readiness-fixes-task.md P5 (PLATFORM-12): a dump is a backup only if it
// is one. `supabase db dump` without a running Docker writes its error as JSON
// to stdout and exits 1 -- redirected into a file, that is how the production
// "backups" came out at 0 and ~300 bytes. This refuses such a file.
//
//   node scripts/backup/verify-dump.mjs <file> <schema|data>
import { readFileSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const MIN_BYTES = { schema: 10_000, data: 1_000 };

/** @returns {string|null} why the dump is not a backup, or null when it is one. */
export function dumpProblem(text, kind) {
  if (kind !== 'schema' && kind !== 'data') return `unknown kind: ${kind}`;
  if (!text || !text.trim()) return 'the file is empty';
  const head = text.trimStart().slice(0, 200);
  if (head.startsWith('{') && /"_tag"\s*:\s*"Error"|"error"\s*:/.test(head)) return `the file holds a CLI error, not a dump: ${head.slice(0, 160)}`;
  if (Buffer.byteLength(text, 'utf8') < MIN_BYTES[kind]) return `too small for a ${kind} dump (${Buffer.byteLength(text, 'utf8')} bytes, at least ${MIN_BYTES[kind]})`;
  if (kind === 'schema') {
    if (!/CREATE TABLE/i.test(text)) return 'no CREATE TABLE in a schema dump';
    if (!/CREATE (OR REPLACE )?FUNCTION/i.test(text)) return 'no functions in a schema dump';
  } else if (!/\b(INSERT INTO|COPY)\b/.test(text)) {
    return 'no INSERT or COPY in a data dump';
  }
  return null;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [file, kind] = process.argv.slice(2);
  if (!file || !kind) {
    console.error('usage: verify-dump.mjs <file> <schema|data>');
    process.exit(2);
  }
  let problem;
  try {
    problem = statSync(file).size === 0 ? 'the file is empty' : dumpProblem(readFileSync(file, 'utf8'), kind);
  } catch (e) {
    problem = `cannot read ${file}: ${e.message}`;
  }
  if (problem) {
    console.error(`NOT A BACKUP: ${problem}`);
    process.exit(1);
  }
  console.log(`ok: ${file} is a ${kind} dump (${statSync(file).size} bytes)`);
}
