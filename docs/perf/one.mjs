import { preview } from 'vite';
import { spawn } from 'node:child_process';
const server = await preview({ root: process.cwd(), build: { outDir: 'dist-perf' }, preview: { port: 4173, strictPort: true }, logLevel: 'warn' });
const code = await new Promise((r) => { const c = spawn(process.execPath, ['docs/perf/seen-perf-probe.cjs', ...process.argv.slice(2)], { stdio: 'inherit', env: process.env }); c.on('exit', (x) => r(x ?? 1)); });
await new Promise((r) => server.httpServer.close(r));
process.exit(code);
