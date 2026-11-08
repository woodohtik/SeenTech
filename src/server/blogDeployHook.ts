const DEPLOY_HOOK_TIMEOUT_MS = 5000;

/**
 * Best-effort trigger for a Vercel rebuild after a blog write.
 *
 * The GitHub write has already succeeded by the time this runs, so this must
 * never reject or block the save response: every failure is logged and
 * swallowed. The fetch carries its own timeout so a slow hook cannot hang the
 * caller regardless of what the save route awaits.
 */
export async function triggerBlogRebuild(): Promise<void> {
  try {
    const url = process.env.BLOG_DEPLOY_HOOK_URL;
    if (!url) {
      // Non-fatal everywhere this is called from (save routes must never fail
      // just because the hook isn't configured), but the cron sweep route's
      // entire job IS this hook, so ops needs a visible signal either way.
      console.warn('[blog] BLOG_DEPLOY_HOOK_URL is not set; skipping deploy hook trigger');
      return;
    }

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
}
