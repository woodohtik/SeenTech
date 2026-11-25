import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

// seen-whatsapp-templates-task.md: every WhatsApp message goes through
// openWhatsApp (utils/whatsapp.ts) -- the number in international form and
// the shop's switch. No screen builds its own wa.me / api.whatsapp.com link.
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe('one way to open WhatsApp', () => {
  it('no file but utils/whatsapp.ts opens a WhatsApp link', () => {
    const offenders = sources('src')
      .filter((f) => relative('src', f).split(sep).join('/') !== 'utils/whatsapp.ts')
      // A real address (https://...), not a comment that names the service.
      .filter((f) => /https:\/\/(wa\.me|api\.whatsapp\.com)/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
