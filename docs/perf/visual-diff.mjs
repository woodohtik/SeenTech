/**
 * Pixel comparison of two screenshot folders (seen-verticals-readiness-task.md
 * Phase 8, men's tailoring before/after):
 *   node docs/perf/visual-diff.mjs perf-out/visual-before perf-out/visual-after [out-dir]
 * For each PNG in both folders: the number and share of pixels that differ
 * (any channel by more than 16), and a diff image (differences in red) in
 * out-dir. Compared inside a headless browser's canvas -- no image library
 * to install.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const [beforeDir, afterDir, outDir = 'perf-out/visual-diff'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const files = fs.readdirSync(beforeDir).filter((f) => f.endsWith('.png') && fs.existsSync(path.join(afterDir, f)));
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');
const results = [];
for (const f of files) {
  const a = 'data:image/png;base64,' + fs.readFileSync(path.join(beforeDir, f)).toString('base64');
  const b = 'data:image/png;base64,' + fs.readFileSync(path.join(afterDir, f)).toString('base64');
  const r = await page.evaluate(async ([a, b]) => {
    const load = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = src; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const w = Math.max(ia.width, ib.width); const h = Math.max(ia.height, ib.height);
    const ca = new OffscreenCanvas(w, h); const cb = new OffscreenCanvas(w, h);
    ca.getContext('2d').drawImage(ia, 0, 0); cb.getContext('2d').drawImage(ib, 0, 0);
    const da = ca.getContext('2d').getImageData(0, 0, w, h).data;
    const db = cb.getContext('2d').getImageData(0, 0, w, h).data;
    const out = new OffscreenCanvas(w, h); const oc = out.getContext('2d');
    oc.drawImage(ib, 0, 0); oc.globalAlpha = 0.25; oc.fillStyle = '#fff'; oc.fillRect(0, 0, w, h); oc.globalAlpha = 1;
    const od = oc.getImageData(0, 0, w, h);
    let diff = 0;
    for (let i = 0; i < da.length; i += 4) {
      if (Math.abs(da[i] - db[i]) > 16 || Math.abs(da[i + 1] - db[i + 1]) > 16 || Math.abs(da[i + 2] - db[i + 2]) > 16) {
        diff++; od.data[i] = 255; od.data[i + 1] = 0; od.data[i + 2] = 0; od.data[i + 3] = 255;
      }
    }
    oc.putImageData(od, 0, 0);
    const blob = await out.convertToBlob({ type: 'image/png' });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = ''; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    return { diff, total: w * h, png: btoa(bin), same: ia.width === ib.width && ia.height === ib.height };
  }, [a, b]);
  fs.writeFileSync(path.join(outDir, f), Buffer.from(r.png, 'base64'));
  results.push({ page: f.replace('.png', ''), differing: r.diff, share: (r.diff / r.total * 100).toFixed(3) + '%', sameSize: r.same });
}
await browser.close();
console.table(results);
