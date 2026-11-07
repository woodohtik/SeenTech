export function buildSitemapXml(urls: string[]): string {
  const entries = urls.map(url => `  <url><loc>${url}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>`;
}

// A non-production build (staging, local) must never invite crawling --
// it isn't the canonical copy of this content and shouldn't compete with
// (or get indexed ahead of) the real production pages.
export function buildRobotsTxt(sitemapUrl: string, allowIndexing: boolean): string {
  if (!allowIndexing) {
    return `User-agent: *
Disallow: /
`;
  }
  return `User-agent: *
Allow: /blog/
Sitemap: ${sitemapUrl}
`;
}
