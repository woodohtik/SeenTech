import { createBlogFile, getBlogFile, updateBlogFile, BlogGitHubError } from './blogGitHub';

const DEPLOY_HOOK_TIMEOUT_MS = 5000;
const REBUILD_MARKER_FILE = '.rebuild-trigger';

/**
 * Fallback path when no BLOG_DEPLOY_HOOK_URL is configured for this
 * environment: commit a trivial, non-article file to the same branch the
 * blog editor already writes to (content/blog/*.md authoring reuses this
 * exact token/repo/branch and is proven to work there), so Vercel's
 * existing git-push deploy pipeline rebuilds the static blog -- no new
 * per-environment secret to remember to create. loadArticles only ever
 * reads *.md files (scripts/blog/frontmatter.ts), so this marker is never
 * mistaken for an article.
 */
async function touchRebuildMarker(): Promise<void> {
  const message = `chore(blog): rebuild trigger ${new Date().toISOString()}`;
  let sha: string | undefined;
  try {
    sha = (await getBlogFile(REBUILD_MARKER_FILE)).sha;
  } catch (err) {
    if (!(err instanceof BlogGitHubError && err.status === 404)) throw err;
  }
  const content = new Date().toISOString();
  if (sha) {
    await updateBlogFile(REBUILD_MARKER_FILE, content, sha, message);
  } else {
    await createBlogFile(REBUILD_MARKER_FILE, content, message);
  }
}

/**
 * Best-effort trigger for a Vercel rebuild after a blog write.
 *
 * The GitHub write has already succeeded by the time this runs, so this must
 * never reject or block the save response: every failure is logged and
 * swallowed. The fetch carries its own timeout so a slow hook cannot hang the
 * caller regardless of what the save route awaits.
 */
export async function triggerBlogRebuild(): Promise<void> {
  const url = process.env.BLOG_DEPLOY_HOOK_URL;
  if (url) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(DEPLOY_HOOK_TIMEOUT_MS),
      });
      if (!res.ok) {
        console.warn('[blog] deploy hook responded with non-2xx status:', res.status);
      }
    } catch (err) {
      console.warn('[blog] deploy hook trigger failed:', err);
    }
    return;
  }

  // No deploy hook configured for this environment -- fall back to the
  // GitHub-commit trigger instead of silently no-op'ing (the gap that broke
  // scheduled publishing in production: nobody had created a per-environment
  // Deploy Hook there).
  try {
    await touchRebuildMarker();
  } catch (err) {
    console.warn('[blog] rebuild marker commit failed:', err);
  }
}
