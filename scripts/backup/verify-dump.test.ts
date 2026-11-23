import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain .mjs script
import { dumpProblem } from './verify-dump.mjs';

// seen-readiness-fixes-task.md P5 (PLATFORM-12).
const schema = `-- dump\nCREATE TABLE public.orders (id uuid);\nCREATE OR REPLACE FUNCTION public.f() RETURNS void AS $$ $$ LANGUAGE sql;\n${'-- pad\n'.repeat(2000)}`;

describe('verify-dump', () => {
  it('refuses what the old backups were: empty, or the CLI\'s Docker error', () => {
    expect(dumpProblem('', 'schema')).toMatch(/empty/);
    const dockerError = '{"_tag":"Error","error":{"code":"LegacyDockerRunError","message":"failed to inspect docker image"}}';
    expect(dumpProblem(dockerError, 'schema')).toMatch(/CLI error/);
  });

  it('refuses a truncated or wrong-kind dump', () => {
    expect(dumpProblem('CREATE TABLE x (a int);', 'schema')).toMatch(/too small/);
    expect(dumpProblem(schema.replace(/CREATE OR REPLACE FUNCTION[^\n]*\n/, ''), 'schema')).toMatch(/no functions/);
    expect(dumpProblem('x'.repeat(5000), 'data')).toMatch(/no INSERT or COPY/);
  });

  it('accepts a real one', () => {
    expect(dumpProblem(schema, 'schema')).toBeNull();
    expect(dumpProblem(`COPY public.orders (id) FROM stdin;\n${'a\n'.repeat(1000)}\.\n`, 'data')).toBeNull();
  });
});
