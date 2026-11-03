import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { getCategory } from './categories';

export interface ArticleFrontmatter {
  title: string;
  metaDescription: string;
  cluster: string;
  publishDate: string;
  related: string[];
}

export interface LoadedArticle {
  slug: string;
  frontmatter: ArticleFrontmatter;
  rawBody: string;
  readTimeMinutes: number;
  canonicalUrl: string;
}

const WORDS_PER_MINUTE = 180;
const MIN_READ_TIME_MINUTES = 2;

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

// Missing/malformed fields here were previously silently absorbed as
// `undefined`/malformed values, corrupting rendered pages downstream
// (e.g. an article titled literally "undefined") instead of failing the
// build with a clear, file-named error.
function validateFrontmatter(filename: string, data: Record<string, unknown>): void {
  if (typeof data.title !== 'string' || !data.title.trim()) {
    throw new Error(`${filename}: missing or empty "title" in frontmatter`);
  }
  if (typeof data.meta_description !== 'string' || !data.meta_description.trim()) {
    throw new Error(`${filename}: missing or empty "meta_description" in frontmatter`);
  }
  if (typeof data.publish_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.publish_date)) {
    throw new Error(`${filename}: "publish_date" must be a YYYY-MM-DD date string, got ${JSON.stringify(data.publish_date)}`);
  }
  if (data.related !== undefined && !Array.isArray(data.related)) {
    throw new Error(`${filename}: "related" must be an array of slugs when present`);
  }
}

export function loadArticles(contentDir: string): LoadedArticle[] {
  const filenames = readdirSync(contentDir).filter(f => f.endsWith('.md') && f.toLowerCase() !== 'readme.md');

  return filenames.map(filename => {
    const filePath = path.join(contentDir, filename);
    const raw = readFileSync(filePath, 'utf8');
    const { data, content } = matter(raw);

    const cluster = data.cluster as string;
    if (!getCategory(cluster)) {
      throw new Error(`${filename}: invalid cluster "${cluster}" — must be one of the eight fixed category slugs`);
    }
    validateFrontmatter(filename, data);

    const slug = filename.replace(/\.md$/, '');
    const rawBody = content.trim();
    const readTimeMinutes = Math.max(MIN_READ_TIME_MINUTES, Math.ceil(countWords(rawBody) / WORDS_PER_MINUTE));

    return {
      slug,
      frontmatter: {
        title: data.title as string,
        metaDescription: data.meta_description as string,
        cluster,
        publishDate: data.publish_date as string,
        related: (data.related as string[]) ?? [],
      },
      rawBody,
      readTimeMinutes,
      canonicalUrl: `https://seentech.io/blog/${slug}`,
    };
  });
}
