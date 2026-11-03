export function buildSitemapXml(urls: string[]): string {
  const entries = urls.map(url => `  <url><loc>${url}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>`;
}

export function buildRobotsTxt(sitemapUrl: string): string {
  return `User-agent: *
Allow: /blog/
Sitemap: ${sitemapUrl}
`;
}
