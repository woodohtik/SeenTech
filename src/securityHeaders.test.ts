import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// seen-readiness-fixes-task.md P6 (SECURITY-15): the app's pages allow no
// marketing scripts (only the blog loads them), and the inline script in
// index.html runs because its hash is in the policy -- change the script
// and this test names the new hash.
const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as { headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }> };
const csp = (source: string) => vercel.headers.find((h) => h.source === source)?.headers.find((x) => x.key === 'Content-Security-Policy')?.value ?? '';
const directive = (policy: string, name: string) => (policy.split(';').map((p) => p.trim()).find((p) => p.startsWith(`${name} `)) ?? '').split(/\s+/).slice(1);
const MARKETING = ['https://www.googletagmanager.com', 'https://sc-static.net', 'https://connect.facebook.net', 'https://tr.snapchat.com', 'https://www.google-analytics.com'];

const app = csp('/((?!api/|blog(?:/|$)).*)');
const blog = csp('/blog(/.*)?');

describe('security headers', () => {
  it('there is one policy for the app and one for the blog', () => {
    expect(app).not.toBe('');
    expect(blog).not.toBe('');
    expect(vercel.headers.some((h) => h.source === '/((?!api/).*)')).toBe(false);
  });

  it('the app allows no marketing origins', () => {
    for (const origin of MARKETING) expect(app).not.toContain(origin);
  });

  it('the blog keeps the ones it loads', () => {
    expect(directive(blog, 'script-src')).toEqual(expect.arrayContaining(['https://www.googletagmanager.com', 'https://connect.facebook.net']));
  });

  it('every inline script in index.html has its hash in the app policy', () => {
    const html = readFileSync('index.html', 'utf8');
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(inline.length).toBeGreaterThan(0);
    for (const body of inline) {
      const hash = `'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`;
      expect(directive(app, 'script-src'), `add ${hash} to the app's script-src in vercel.json`).toContain(hash);
    }
  });

  it('the app policy keeps its hard limits', () => {
    expect(directive(app, 'object-src')).toEqual(["'none'"]);
    expect(directive(app, 'script-src')).not.toContain("'unsafe-inline'");
    expect(directive(app, 'frame-ancestors')).toEqual(["'self'"]);
  });
});
