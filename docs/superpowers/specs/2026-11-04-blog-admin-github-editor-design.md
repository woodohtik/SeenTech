# Blog Admin Editor (GitHub-backed) — Design

**Status:** approved by user, 2026-11-04.
**Supersedes:** nothing — this is new scope discovered after `2026-11-03-blog-ssg-migration` shipped to staging and removed the old `AdminBlog.tsx`/`blog_posts` admin screen entirely.

## Context

The blog is now pure build-time SSG (`scripts/build-blog.ts` reads `content/blog/*.md`, writes static HTML into `dist/`). There is no admin UI and no database involved in publishing a blog article anymore — on purpose, per the prior migration's design.

The super_admin (one person, publishes roughly one article per day, and wants to schedule some for a future date/time) needs a way to add/edit/delete articles without hand-editing files and running git commands themselves. This spec covers that admin screen.

**Non-negotiable constraint carried from the prior migration:** the public blog stays pure static HTML with no client-side JS needed to read content, and CSP's `script-src 'self'` (no `unsafe-inline`) stays intact. Nothing in this design may reintroduce a database-backed public blog or weaken that CSP.

## Why GitHub, not a database (decision record)

Vercel's serverless functions (`server.ts`) have no persistent writable disk — anything written at runtime is gone before the next build, and never reaches `dist/blog/`. The only way for an admin action to ever appear on the built site is for the `.md` file to exist in the git repository before the next build runs. A database-backed admin (the old architecture) was explicitly rejected: it would require either reverting to CSR delivery (defeats the whole point of this session's SSG migration) or building real SSR (rejected at that migration's own kickoff). Scheduling precision is identical either way (~15 minutes, see below) — so there is no real-world upside to reverting, only the downside of undoing the migration.

## Architecture

```
Super-admin browser
  └─ /admin/blog (new React screen, super_admin-gated, same guard pattern as other /admin/* routes)
       │  (no token ever reaches the browser)
       ▼
server.ts — new routes under /api/admin/blog/*
       │  (GitHub Contents API calls, using BLOG_GITHUB_TOKEN)
       ▼
GitHub repo, `staging` branch, content/blog/*.md
       │  (push to `staging` already auto-deploys via Vercel's GitHub integration — confirmed this session)
       ▼
Vercel build → scripts/build-blog.ts → dist/blog/* (static)
```

Every write path (create/edit/delete) also immediately calls the Vercel Deploy Hook (see Scheduling below) so an admin action doesn't wait for the next periodic sweep.

**Scope: `staging` only.** This tool writes to the `staging` branch's `content/blog/`, matching this project's "staging only by default" deployment convention. Production (`main`) still runs the old CSR blog entirely separately and is untouched by this feature; migrating production's blog delivery is a separate, later decision.

### New environment variables (server-side only, never sent to the client)

- `BLOG_GITHUB_TOKEN` — a fine-grained GitHub Personal Access Token, scoped to this one repository only, with **Contents: Read and write** permission and nothing else. The user creates this themselves (never fabricated).
- `BLOG_GITHUB_REPO` — `owner/repo` (e.g. `woodohtik/SeenTech`).
- `BLOG_GITHUB_BRANCH` — `staging` (hardcoded default, but kept as an env var rather than a literal so it can't silently drift from vercel.json's own branch assumptions).
- `BLOG_DEPLOY_HOOK_URL` — a Vercel Deploy Hook URL (created in the Vercel project settings, targeting the `staging` branch), called via a server-side POST whenever a rebuild should happen.

Reading any of these as missing/empty must produce a clear 500 error naming the missing variable, not a silent no-op — this backend feature has no safe "do nothing" default.

## Scheduling and the future-dated-article filter

**Finding from this brainstorming session, part 1:** `loadArticles()`/`buildBlog()` as they exist today do **not** filter by `publishDate` at all — any committed article appears immediately regardless of its date. This must change for "schedule for later" to mean anything.

**Finding from this brainstorming session, part 2 (self-review catch):** `publishDate` is currently validated (as of yesterday's final-review fix pass) as a **date-only** string, `/^\d{4}-\d{2}-\d{2}$/`. The user's own motivating report was scheduling to a specific *time of day* ("11:25"), which a date-only field cannot represent at all. `publishDate`'s format must change to a full timestamp:

- `ArticleFrontmatter.publishDate` becomes a full ISO-8601 datetime string (e.g. `2026-11-04T23:25:00+03:00`), not date-only. `validateFrontmatter`'s regex changes from the date-only pattern to `Date.parse(value)` succeeding (reject `NaN`).
- Every place that currently treats `publishDate` as `YYYY-MM-DD` and parses it by splitting on `-` (`articlePage.ts`'s and `indexPage.ts`'s `formatArabicDate`, `sortByDateDesc`'s `localeCompare`) must switch to `new Date(publishDate)` and format from that, instead of string-splitting. `formatArabicDate` keeps showing only the date (not the time) to readers — the time component exists for scheduling precision, not for display.
- The one existing real fixture/test article's `publish_date` values get a time component appended (e.g. `2026-11-03` → `2026-11-03T09:00:00+03:00`) — no behavior change for already-published content, just a format migration.
- `loadArticles(contentDir, now = new Date())` gains a `now` parameter. Any article whose `frontmatter.publishDate` (now a real timestamp) is strictly after `now` is excluded from the returned list entirely — not built, not in the index/category pages, not in the sitemap, not in the search index. `buildBlog` passes real `new Date()` in production use; tests pass a fixed date.
- A scheduled article becomes visible only once a build runs at or after its `publishDate` instant. This is why the periodic rebuild below exists, and why its ~15-minute cadence is the real precision bound on "11:25" — it may appear a few minutes after, never before.

**Periodic rebuild (catches due articles even with no admin action):**
- A new `vercel.json` cron entry (same pattern as the existing `zatca-cert-expiry-check`), `*/15 * * * *`, hits a new lightweight server route, e.g. `POST /api/cron/blog-rebuild-sweep`.
- That route's only job: POST to `BLOG_DEPLOY_HOOK_URL`. No DB, no GitHub read needed — it's unconditional, exactly mirroring the old `pg_cron` sweep's own ~15-minute cadence (no regression, same granularity as the system being replaced).
- This matches daily-cadence usage: one extra Vercel deployment every 15 minutes is cheap and simple; a "only redeploy if something's actually due" optimization was considered and explicitly deferred (see Deferred, below) as unnecessary complexity for one article/day.

**Immediate rebuild (admin action feels instant):**
- Every create/edit/delete route, after a successful GitHub commit, also POSTs to `BLOG_DEPLOY_HOOK_URL` itself. A "publish now" (today's date) article goes live in one normal Vercel build (~20-30s), not up to 15 minutes later.

## API routes (`server.ts`)

All routes below require the same `super_admin` auth guard already used by other `/api/admin/*` routes in this file — follow the existing pattern, do not invent a new one.

- `GET /api/admin/blog/articles` — lists every article in `content/blog/` on the `staging` branch (via GitHub Contents API directory listing, then fetching each file's content in parallel to read its frontmatter — see Scaling note below). Returns `{ slug, title, cluster, publishDate, status }[]`, where `status` is computed as `'published'` if `publishDate <= now` (full timestamp comparison, not date-only) else `'scheduled'` — never stored, always derived.
- `GET /api/admin/blog/articles/:slug` — fetches one article's raw frontmatter + body (for editing).
- `POST /api/admin/blog/articles` — creates a new article. Body: `{ title, metaDescription, cluster, publishDate, related, body }`. Slug is derived server-side from `title` via the existing `slugify` util, checked against the current file listing for a collision (409 if taken), then validated with the same rules as the build-time `validateFrontmatter` (see Shared validation below), then committed via `PUT /repos/{repo}/contents/content/blog/{slug}.md` on the `staging` branch, then triggers the deploy hook.
- `PUT /api/admin/blog/articles/:slug` — edits an existing article. Same validation, requires the file's current `sha` (fetched first) for the GitHub API's optimistic-concurrency update, then triggers the deploy hook.
- `DELETE /api/admin/blog/articles/:slug` — deletes the file via GitHub's delete-contents API (needs current `sha`), then triggers the deploy hook. The super_admin confirms in the UI before this is called (destructive).
- `POST /api/admin/blog/preview` — body: `{ title, metaDescription, cluster, publishDate, related, body }` (the in-progress, unsaved form state). Builds a synthetic `LoadedArticle` (computed `readTimeMinutes`, a placeholder `canonicalUrl`), runs the real `parseArticleSections` + `renderArticlePage` against it (reusing `allArticles` from the current listing, so related-article cards resolve for real), and returns the resulting HTML string for the client to render in an iframe. No git write, no deploy hook call.

### Shared validation

`scripts/blog/frontmatter.ts`'s `validateFrontmatter` is currently a private, unexported function. It must be exported (or extracted to its own small module) so these new API routes import and reuse the exact same rules — title/meta_description/publish_date format/related-is-array — rather than re-implementing them. This is a one-line export change plus updating its call sites' imports; no behavior change to the existing build-time path.

### Scaling note (accepted limit, not a bug)

Listing articles fetches every file's content (to read frontmatter for the list view) in parallel. At today's "~1 article/day" cadence this stays well under a second even after a year of posts. If this ever becomes slow, revisit with a cache or GitHub's GraphQL batch-content API — out of scope for this pass.

## Editor screen (`/admin/blog`, super_admin only)

- **List view:** every article (published + scheduled + any future-dated ones not yet live), each showing its computed status ("منشورة" / "مجدولة لـ <date>"), with edit and delete actions.
- **Editor form:** title, meta description, category (the 8 fixed `CATEGORIES` slugs, a select), publish date+time picker (same value used for "now" = publish immediately, or a future value = schedule), related articles (multi-select populated from the real current article list — not free-text, so a typo can never produce a dangling slug), and a single large `<textarea>` for the full Markdown body — matching the old screen's own editor style (it was a plain textarea too, not a rich-text editor), so there's nothing new to learn.
- **Preview button:** calls `POST /api/admin/blog/preview` with the current form state and renders the returned HTML in an iframe, so section-parsing mistakes (e.g. a malformed "**الجواب المختصر:**" prefix) are visible before saving, not after.
- **Save button:** calls create or update accordingly; on success, shows the live or scheduled state clearly ("نُشرت الآن" vs "مجدولة لـ..."), matching what the status column will show afterward.

## Error handling

- GitHub API errors (rate limit, network, bad token, 404 on an expected file) surface as a clear toast in the UI with the GitHub error message, not a generic "failed" — the super_admin is a non-technical content author and needs to know e.g. "التوكن غير صالح" vs "تعارض نسخة، أعد المحاولة" vs "الاسم مستخدم من قبل".
- A slug collision on create is a 409 with the existing article's title, so the author can decide to edit that one instead.
- Deploy-hook POST failures are logged server-side but do **not** fail the save response — the commit already succeeded (the source of truth), and the periodic sweep will catch it within 15 minutes regardless.

## Testing

- `scripts/blog/frontmatter.ts`: new tests for the `now`-parameterized future-date filter (an article dated tomorrow is excluded from `loadArticles`'s result; one dated today or earlier is included).
- `scripts/build-blog.test.ts`: extend the end-to-end fixture test to include one future-dated fixture article and assert it's absent from the generated index/sitemap/search-index, present in none of the output.
- New unit tests for the GitHub Contents API client wrapper (mocking `fetch`, not hitting real GitHub) covering: create, update-with-sha, delete-with-sha, 404 translated to a clear "not found", and rate-limit/network-error translated to a clear message.
- New unit tests for the `/api/admin/blog/*` route handlers (mocking the GitHub client and the deploy-hook POST) covering: validation rejects the same bad inputs `validateFrontmatter` already rejects, slug collision returns 409, successful create/update/delete each trigger exactly one deploy-hook POST, and the preview route never calls the GitHub client or the deploy hook.
- No new test infrastructure for the real GitHub API or the real Vercel Deploy Hook — those are verified manually against the real `staging` project once implemented (per this project's existing "ask the user to log in / test live, don't fabricate credentials" convention), not from an automated suite.

## Deferred (explicitly out of scope for this pass)

- A "smart" sweep that only redeploys when something is actually due (checking frontmatter dates via GitHub API before calling the deploy hook) — the unconditional every-15-minutes hook call is simpler and cheap enough at current volume.
- Draft states that are never git-committed (e.g. autosave-to-localStorage before the author is ready) — every save is a real commit; the author decides when to save.
- Multi-author review/approval workflows — single author, not needed.
- Migrating production (`main`)'s blog off the old CSR/Supabase system — separate, later decision.
