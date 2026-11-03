import { existsSync, readFileSync } from 'node:fs';

export function assertStaticContentPresent(filePath: string, expectedSubstrings: string[]): void {
  if (!existsSync(filePath)) {
    throw new Error(`missing: ${filePath}`);
  }
  const raw = readFileSync(filePath, 'utf8');
  for (const s of expectedSubstrings) {
    if (!raw.includes(s)) {
      throw new Error(`${filePath} is missing expected text: "${s}"`);
    }
  }
}

assertStaticContentPresent('dist/blog/index.html', ['المدونة']);
assertStaticContentPresent('dist/blog/category/management/index.html', ['قريباً']);
console.log('[verify-blog-ssr] OK — real text found in raw HTML, no JS execution needed.');
