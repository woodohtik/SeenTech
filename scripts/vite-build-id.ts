/**
 * Every build gets an identity (seen-update-delivery-fix-task.md, phase 1):
 *
 *  - `__BUILD_ID__` in the code: the commit's first 7 characters and the
 *    build time, e.g. "f5852d3-202611251930";
 *  - `dist/version.json`: { build, builtAt, mandatory }, fetched by the app
 *    (src/lib/appVersion.ts) to learn that a newer build is live.
 *
 * `SEEN_UPDATE_MANDATORY=1` at build time marks a release that must not be
 * worked on in an older copy (a full "update required" screen).
 */
import { execFileSync } from 'node:child_process';
import type { Plugin } from 'vite';

export interface BuildIdentity {
  build: string;
  builtAt: string;
  mandatory: boolean;
}

function commitSha(root: string): string {
  const fromVercel = process.env.VERCEL_GIT_COMMIT_SHA;
  if (fromVercel) return fromVercel.slice(0, 7);
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'dev';
  } catch {
    return 'dev';
  }
}

export function buildIdentity(root: string, now: Date = new Date()): BuildIdentity {
  const stamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 12); // YYYYMMDDHHmm, UTC
  return {
    build: `${commitSha(root)}-${stamp}`,
    builtAt: now.toISOString(),
    mandatory: process.env.SEEN_UPDATE_MANDATORY === '1',
  };
}

/**
 * seen-sentry-setup-task.md 1: one release name for the browser, the server
 * and the uploaded source maps -- the commit (VERCEL_GIT_COMMIT_SHA), or the
 * build id off Vercel.
 */
export function sentryRelease(root: string, identity: BuildIdentity = buildIdentity(root)): string {
  return process.env.VERCEL_GIT_COMMIT_SHA || `seen@${identity.build}`;
}

/** production, staging (a Vercel preview = the staging branch) or development. */
export function sentryEnvironmentAtBuild(): string {
  const v = process.env.VERCEL_ENV;
  return v === 'production' ? 'production' : v === 'preview' ? 'staging' : 'development';
}

export function buildIdPlugin(root: string): Plugin {
  const identity = buildIdentity(root);
  return {
    name: 'seen-build-id',
    config() {
      return {
        define: {
          __BUILD_ID__: JSON.stringify(identity.build),
          __BUILT_AT__: JSON.stringify(identity.builtAt),
          __SENTRY_RELEASE__: JSON.stringify(sentryRelease(root, identity)),
          __SENTRY_ENVIRONMENT__: JSON.stringify(sentryEnvironmentAtBuild()),
        },
      };
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify(identity)}\n` });
    },
  };
}
