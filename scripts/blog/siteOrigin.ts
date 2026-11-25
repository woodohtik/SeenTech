/**
 * The site's one public address (seen-search-appearance-task.md, question 3):
 * seentech.io redirects to www, so canonical links, the sitemap, JSON-LD,
 * og:image and robots.txt all name www -- the address actually served.
 */
export const SITE_ORIGIN = 'https://www.seentech.io';

/**
 * The sign-up screen (seen-blog-cta-to-signup-task.md): every blog button --
 * "ابدأ الآن" and "نوريك إياه في محلك" -- opens it, as the landing page's
 * own "ابدأ الآن مجاناً" buttons do (Login.tsx opens register on this view).
 */
export const SIGNUP_URL = `${SITE_ORIGIN}/login?view=register`;
