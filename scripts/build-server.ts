/**
 * Builds the server (server.ts -> server-build/server.cjs) for the Vercel
 * Function (api/index.js) and `npm start`.
 *
 * seen-sentry-setup-task.md:
 *  - Not in dist/ any more: dist/ is the public site, and dist/server.cjs and
 *    dist/server.cjs.map (the server's whole source) could be downloaded by
 *    anyone. server-build/ is only bundled into the Function.
 *  - With SENTRY_AUTH_TOKEN (Vercel), the source map goes to Sentry's
 *    seen-server project under the same release as the browser, and the
 *    .map file is deleted. Without it (local, a branch), the build runs as
 *    before and uploads nothing.
 */
import { build, type Plugin } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIdentity, sentryRelease } from './vite-build-id';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'server-build');

async function sentryPlugins(): Promise<Plugin[]> {
  const authToken = process.env.SENTRY_AUTH_TOKEN;
  if (!authToken) return [];
  const { sentryEsbuildPlugin } = await import('@sentry/bundler-plugins/esbuild');
  return [sentryEsbuildPlugin({
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_SERVER_PROJECT || 'seen-server',
    authToken,
    release: { name: sentryRelease(ROOT, buildIdentity(ROOT)), inject: false },
    sourcemaps: { filesToDeleteAfterUpload: [path.join(OUT_DIR, '**/*.map')] },
    telemetry: false,
  }) as Plugin];
}

await build({
  entryPoints: [path.join(ROOT, 'server.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  sourcemap: true,
  outfile: path.join(OUT_DIR, 'server.cjs'),
  plugins: await sentryPlugins(),
  logLevel: 'info',
});
