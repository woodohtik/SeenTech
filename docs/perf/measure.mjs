// Serves a measurement build with Vite's preview server, runs the median
// runner against it, and shuts the server down -- one command, no stray
// server left holding port 4173 between rounds.
// usage: TAG=after- OUT_DIR=dist-perf RUNS=3 node docs/perf/measure.mjs
// The runner is a separate process started asynchronously: a synchronous
// child would block this process, and with it the preview server.
import { preview } from 'vite';
import { spawn } from 'node:child_process';

const outDir = process.env.OUT_DIR || 'dist-perf';
const server = await preview({ build: { outDir }, preview: { port: 4173, strictPort: true }, logLevel: 'warn' });
const code = await new Promise((resolve) => {
  const child = spawn(process.execPath, ['docs/perf/run-probe-median.cjs'], { stdio: 'inherit', env: process.env });
  child.on('exit', (c) => resolve(c ?? 1));
});
await new Promise((resolve) => server.httpServer.close(resolve));
process.exit(code);
