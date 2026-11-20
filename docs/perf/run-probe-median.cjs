// Runs docs/perf/seen-perf-probe.cjs several times per scenario and prints
// the median of each number (seen-performance-first-open-login-task.md:
// "شغّل كل سيناريو 3 مرات وخذ الوسيط").
// usage: TAG=before- RUNS=3 node docs/perf/run-probe-median.cjs
// Needs `npx vite preview --port 4173` running on a build made with the fake
// Supabase URL (see seen-perf-probe.cjs). Writes perf-out/<TAG>medians.json.
const { execFileSync } = require('child_process');
const fs = require('fs');

const TAG = process.env.TAG || '';
const RUNS = Number(process.env.RUNS || 3);
const SCENARIOS = [
  { args: ['login-cold', '4g'] },
  { args: ['app-open-cold', '4g'] },
  { args: ['app-open-warm', '4g'] },
  { args: ['app-open-cold', 'wifi'] },
  { args: ['app-open-cold', '4g'], env: { DATA: 'big' } },
  { args: ['app-open-warm', 'wifi'], env: { REFOCUS: '1' } },
];

const median = (xs) => {
  const v = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
};

const out = {};
for (const s of SCENARIOS) {
  const name = s.args.join(' ') + (s.env ? ' ' + Object.entries(s.env).map(([k, v]) => `${k}=${v}`).join(' ') : '');
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    const text = execFileSync('node', ['docs/perf/seen-perf-probe.cjs', ...s.args], {
      env: { ...process.env, ...(s.env || {}), TAG }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
    const lines = text.trim().split('\n');
    const summary = JSON.parse(lines[lines.length - 1]);
    const refocus = text.match(/REFOCUS: .*?:\s*(\d+)/);
    if (refocus) summary.refocusSupabase = Number(refocus[1]);
    runs.push(summary);
    process.stderr.write(`${name} run ${i + 1}: ${JSON.stringify(summary.marks)} tbt=${summary.tbtMs}\n`);
  }
  const markKeys = [...new Set(runs.flatMap((r) => Object.keys(r.marks)))];
  out[name] = {
    marks: Object.fromEntries(markKeys.map((k) => [k, median(runs.map((r) => r.marks[k]))])),
    tbtMs: median(runs.map((r) => r.tbtMs)),
    supabaseRequests: median(runs.map((r) => r.supabaseRequests)),
    jsKB: median(runs.map((r) => r.jsKB)),
    pageBytesKB: median(runs.map((r) => r.pageBytesKB)),
    swBytesKB: median(runs.map((r) => r.swBytesKB)),
    ...(runs[0].refocusSupabase !== undefined ? { refocusSupabase: median(runs.map((r) => r.refocusSupabase)) } : {}),
  };
}
fs.mkdirSync('perf-out', { recursive: true });
fs.writeFileSync(`perf-out/${TAG}medians.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
