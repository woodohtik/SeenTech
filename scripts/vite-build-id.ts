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

export function buildIdPlugin(root: string): Plugin {
  const identity = buildIdentity(root);
  return {
    name: 'seen-build-id',
    config() {
      return {
        define: {
          __BUILD_ID__: JSON.stringify(identity.build),
          __BUILT_AT__: JSON.stringify(identity.builtAt),
        },
      };
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify(identity)}\n` });
    },
  };
}
