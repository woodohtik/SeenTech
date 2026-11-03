import type { LoadedArticle } from './frontmatter';

export interface SearchEntry {
  slug: string;
  title: string;
  excerpt: string;
}

export function buildSearchIndex(articles: LoadedArticle[]): SearchEntry[] {
  return articles.map(a => ({
    slug: a.slug,
    title: a.frontmatter.title,
    excerpt: a.frontmatter.metaDescription,
  }));
}

export function filterSearchIndex(index: SearchEntry[], query: string): SearchEntry[] {
  const needle = query.toLowerCase();
  return index.filter(entry =>
    entry.title.toLowerCase().includes(needle) || entry.excerpt.toLowerCase().includes(needle)
  );
}
