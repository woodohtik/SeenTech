import type { LoadedArticle } from './frontmatter';
import type { FaqItem } from './parseArticleSections';

export function buildArticleJsonLd(article: LoadedArticle): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.frontmatter.title,
    description: article.frontmatter.metaDescription,
    mainEntityOfPage: article.canonicalUrl,
    datePublished: article.frontmatter.publishDate,
    dateModified: article.frontmatter.publishDate,
    inLanguage: 'ar-SA',
    image: `https://seentech.io/blog/og/${article.slug}.png`,
    author: {
      '@type': 'Organization',
      name: 'سين',
      url: 'https://seentech.io',
    },
    publisher: {
      '@type': 'Organization',
      name: 'سين',
      url: 'https://seentech.io',
    },
  };
}

export function buildFaqJsonLd(faq: FaqItem[]): object | null {
  if (faq.length === 0) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map(item => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answerHtml,
      },
    })),
  };
}
