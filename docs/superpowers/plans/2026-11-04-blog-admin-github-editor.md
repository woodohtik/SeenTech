# Blog Admin Editor (GitHub-backed) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the super_admin a `/admin/blog` screen to create/edit/delete/schedule blog articles, which commits real Markdown files to the `staging` branch via the GitHub Contents API (the only way an admin action can ever reach the build-time SSG blog), with a Vercel Cron + Deploy Hook sweep so scheduled articles actually go live.

**Architecture:** New server-side modules (`src/server/blogGitHub.ts`, `src/server/blogDeployHook.ts`, `src/server/blogAdmin.ts`) wrap the GitHub Contents API and the Vercel Deploy Hook; `server.ts` registers them as `/api/admin/blog/*` routes behind the existing `authenticate, authorize(['super_admin'])` guard, plus a `CRON_SECRET`-protected `/api/cron/blog-rebuild-sweep` route. A new React screen calls those routes. `scripts/blog/frontmatter.ts` gains a real future-date filter and a shared frontmatter-parsing primitive both the local build and the new remote-content routes use.

**Tech Stack:** Express (`server.ts`), GitHub REST Contents API via `fetch`, React + react-router-dom, Vitest + @testing-library/react, existing `gray-matter`/`marked` dependencies.

**Spec:** `docs/superpowers/specs/2026-11-04-blog-admin-github-editor-design.md`

## Global Constraints

- Target branch is `staging` only, read from `BLOG_GITHUB_BRANCH` (no literal elsewhere) — this tool never touches `main`.
- Required env vars for the primary write path: `BLOG_GITHUB_TOKEN`, `BLOG_GITHUB_REPO`, `BLOG_GITHUB_BRANCH`. Missing any one of these when a route actually needs it is a 500 naming the exact missing variable — never a silent no-op.
- `BLOG_DEPLOY_HOOK_URL` is best-effort/secondary: a missing value or a failed POST to it is logged and swallowed, never fails the calling request — the GitHub commit is already the source of truth, and the 15-minute sweep catches it regardless.
- Every `/api/admin/blog/*` route is gated by `authenticate, authorize(['super_admin'])`, the exact middleware chain already used at `server.ts:1241` (`/api/admin/stats`) — do not invent a new guard.
- `/api/cron/blog-rebuild-sweep` is gated by the `CRON_SECRET` bearer-token check, the exact pattern already at `server.ts:2806-2810` (`/api/cron/zatca-cert-expiry-check`) — not the `authenticate`/`authorize` guard.
- CSP must stay intact: `script-src 'self'`, no `unsafe-inline`. Nothing in this plan adds an inline `<script>` to any public blog page.
- The preview route never writes to GitHub and never calls the deploy hook.
- The related-articles field in the editor UI is a picker populated from the real current article list, never free text.
- `related` slugs that can't be resolved are skipped with a console warning at render time — this already exists (`articlePage.ts`'s `renderArticlePage`) and this plan does not change it.

## Review Focus

- A GitHub 409/422 on create (two near-simultaneous saves racing on the same slug) must surface as a clear "that slug is taken" error, not a generic 500 — Task 5's tests cover the create path's own 409, but a *concurrent* collision arriving as a 422 from GitHub itself (not our own pre-check) is a distinct response shape worth asserting on explicitly.
- `publishDate`'s timezone basis: the datetime picker produces a value in the *author's browser* timezone, but the sweep and `loadArticles`'s filter both compare against the *server's* `now()`. A reasonable person scheduling "11:25 PM" expects that to mean their own local time, not UTC or the server's timezone — Task 8's save step must send a real offset-aware ISO string (not a naive local string), and Task 1's filter test must exercise a `publishDate` with a non-UTC offset to confirm the comparison is correct regardless of the server process's own TZ.
- The deploy hook hanging (slow network) must never make a save request itself hang — Task 4's `triggerBlogRebuild` needs its own short timeout, independent of the GitHub write's own request.
- Deleting an article that other published articles list in their own `related` array isn't blocked (the public build already tolerates a dangling slug by skipping it with a warning), but the admin UI should tell the author this before they confirm a delete, not leave them guessing why a related card vanished elsewhere later — Task 8's delete-confirmation step.
- An article whose `related` list includes a slug that doesn't resolve must not crash rendering — already true today (`articlePage.ts`'s `renderArticlePage` skips an unresolved slug with a console warning, covered by its pre-existing test "a dangling related slug is skipped without throwing"). No new task needed; flagged here only so the plan doesn't accidentally regress it while `fetchAllArticles` and `previewArticle` are wired through the same `renderArticlePage` call.

---

### Task 1: Frontmatter schema — full-datetime `publishDate`, exported validation, shared parse primitive, future-date filter

**Files:**
- Modify: `scripts/blog/frontmatter.ts`
- Modify: `scripts/blog/frontmatter.test.ts`
- Modify: `scripts/build-blog.test.ts`

**Interfaces:**
- Consumes: `getCategory` (`scripts/blog/categories.ts`, unchanged).
- Produces: `validateFrontmatter(filename: string, data: Record<string, unknown>): void` (now exported, throws `Error` on any invalid field). `parseArticleFrontmatter(filename: string, raw: string): { frontmatter: ArticleFrontmatter; rawBody: string }` (new — parses gray-matter + validates + maps fields; both `loadArticles` and Task 5's remote-content routes call this so frontmatter rules live in exactly one place). `loadArticles(contentDir: string, now?: Date): LoadedArticle[]` (new optional `now` parameter, defaults to `new Date()`). `ArticleFrontmatter.publishDate` is now a full ISO-8601 datetime string, not date-only.

- [ ] **Step 1: Write the failing tests for the relaxed datetime validation**

```ts
test('accepts a full ISO-8601 datetime with a timezone offset for publish_date', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'blog-'));
  writeArticle(dir, 'how-to.md', 'title: "ق"\nmeta_description: "و"\ncluster: orders\npublish_date: "2026-11-04T23:25:00+03:00"\nrelated: []', 'نص.');
  const [article] = loadArticles(dir);
  expect(article.frontmatter.publishDate).toBe('2026-11-04T23:25:00+03:00');
  rmSync(dir, { recursive: true });
});

test('still accepts a date-only publish_date (midnight UTC that day)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'blog-'));
  writeArticle(dir, 'how-to.md', 'title: "ق"\nmeta_description: "و"\ncluster: orders\npublish_date: "2026-11-03"\nrelated: []', 'نص.');
  expect(() => loadArticles(dir)).not.toThrow();
  rmSync(dir, { recursive: true });
});

test('still throws with the file name when publish_date is not a parseable date at all', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'blog-'));
  writeArticle(dir, 'bad.md', 'title: "ق"\nmeta_description: "و"\ncluster: orders\npublish_date: "3 نوفمبر"\nrelated: []', 'نص.');
  expect(() => loadArticles(dir)).toThrow(/bad\.md/);
  rmSync(dir, { recursive: true });
});
```

- [ ] **Step 2: Run to verify the first two fail and the third still passes**

Run: `npx vitest run scripts/blog/frontmatter.test.ts`
Expected: the two new accept-cases FAIL against the current date-only regex; the reject-case already passes (it was already rejected, just for a different reason).

- [ ] **Step 3: Relax `validateFrontmatter`'s `publish_date` check and export it**

Replace the date-only regex with one that accepts `YYYY-MM-DD` optionally followed by a time and offset: `/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/`, AND keep the existing `Number.isNaN(Date.parse(value))` style guard so a syntactically-matching-but-impossible date (e.g. month 13) still fails. Add `export` to `function validateFrontmatter`.

- [ ] **Step 4: Run to verify all three pass**

Run: `npx vitest run scripts/blog/frontmatter.test.ts`
Expected: PASS (plus all pre-existing tests in this file still pass).

- [ ] **Step 5: Write the failing test for `parseArticleFrontmatter`**

```ts
test('parseArticleFrontmatter parses the same raw string loadArticles would read from disk', () => {
  const raw = '---\ntitle: "عنوان"\nmeta_description: "وصف"\ncluster: orders\npublish_date: "2026-11-03"\nrelated: []\n---\n\nنص المقالة.';
  const { frontmatter, rawBody } = parseArticleFrontmatter('how-to.md', raw);
  expect(frontmatter.title).toBe('عنوان');
  expect(rawBody).toBe('نص المقالة.');
});

test('parseArticleFrontmatter throws with the filename for an invalid cluster', () => {
  const raw = '---\ntitle: "ق"\nmeta_description: "و"\ncluster: not-a-cluster\npublish_date: "2026-11-03"\nrelated: []\n---\n\nنص.';
  expect(() => parseArticleFrontmatter('bad.md', raw)).toThrow(/bad\.md/);
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run scripts/blog/frontmatter.test.ts`
Expected: FAIL with "parseArticleFrontmatter is not defined".

- [ ] **Step 7: Extract `parseArticleFrontmatter` and make `loadArticles` call it**

`parseArticleFrontmatter` does exactly what `loadArticles`'s per-file body currently does (minus the filesystem read): `matter(raw)`, the cluster/`getCategory` check, `validateFrontmatter`, and the field mapping into `ArticleFrontmatter`. `loadArticles` becomes: `readdirSync` + filter → for each file, `readFileSync` the raw string, call `parseArticleFrontmatter(filename, raw)`, then compute `slug`/`readTimeMinutes`/`canonicalUrl` as before.

- [ ] **Step 8: Run to verify it passes**

Run: `npx vitest run scripts/blog/frontmatter.test.ts`
Expected: PASS, full file.

- [ ] **Step 9: Write the failing test for the future-date filter**

```ts
test('an article dated after `now` is excluded from loadArticles entirely', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'blog-'));
  writeArticle(dir, 'future.md', 'title: "ق"\nmeta_description: "و"\ncluster: orders\npublish_date: "2026-11-05T00:00:00Z"\nrelated: []', 'نص.');
  const articles = loadArticles(dir, new Date('2026-11-04T12:00:00Z'));
  expect(articles).toHaveLength(0);
  rmSync(dir, { recursive: true });
});

test('an article dated at or before `now` is still included', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'blog-'));
  writeArticle(dir, 'due.md', 'title: "ق"\nmeta_description: "و"\ncluster: orders\npublish_date: "2026-11-04T11:00:00Z"\nrelated: []', 'نص.');
  const articles = loadArticles(dir, new Date('2026-11-04T12:00:00Z'));
  expect(articles).toHaveLength(1);
  rmSync(dir, { recursive: true });
});

test('a publishDate in a different timezone offset is compared by real instant, not wall-clock digits', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'blog-'));
  // 23:25 +03:00 is 20:25 UTC -- still due at "now" = 20:30 UTC
  writeArticle(dir, 'tz.md', 'title: "ق"\nmeta_description: "و"\ncluster: orders\npublish_date: "2026-11-04T23:25:00+03:00"\nrelated: []', 'نص.');
  const articles = loadArticles(dir, new Date('2026-11-04T20:30:00Z'));
  expect(articles).toHaveLength(1);
  rmSync(dir, { recursive: true });
});
```

- [ ] **Step 10: Run to verify it fails**

Run: `npx vitest run scripts/blog/frontmatter.test.ts`
Expected: FAIL (no filtering happens yet, all 3 would currently return length 1 or the future one wrongly included).

- [ ] **Step 11: Implement the filter in `loadArticles`**

`loadArticles(contentDir: string, now: Date = new Date())`: after mapping each file to a `LoadedArticle`, `.filter(a => new Date(a.frontmatter.publishDate).getTime() <= now.getTime())` before returning.

- [ ] **Step 12: Run to verify it passes**

Run: `npx vitest run scripts/blog/frontmatter.test.ts`
Expected: PASS, full file (all tests, old and new).

- [ ] **Step 13: Extend the build-blog end-to-end fixture test for the same filter**

In `scripts/build-blog.test.ts`'s first test, add one more fixture article under a fresh temp dir reusing the existing `content/blog/__fixtures__` sample plus a new future-dated one (e.g. copy the existing fixture pattern, `publish_date: "2099-01-01T00:00:00Z"`), then assert:

```ts
expect(existsSync(path.join(outDir, 'blog/far-future/index.html'))).toBe(false);
expect(readFileSync(path.join(outDir, 'blog/index.html'), 'utf8')).not.toContain('far-future');
```

- [ ] **Step 14: Run to verify it fails, then wire `buildBlog` to pass real `new Date()` into `loadArticles`, then verify it passes**

Run: `npx vitest run scripts/build-blog.test.ts`
Expected: FAIL first (buildBlog doesn't pass `now` yet, article appears), then implement (`buildBlog` calls `loadArticles(contentDir, new Date())` — explicit even though it's the default, so the call site documents intent), then PASS.

- [ ] **Step 15: Run the full scripts suite and commit**

Run: `npx vitest run scripts`
Expected: all pass.

```bash
git add scripts/blog/frontmatter.ts scripts/blog/frontmatter.test.ts scripts/build-blog.ts scripts/build-blog.test.ts
git commit -m "feat(blog): full-datetime publishDate, exported validation, future-date filter"
```

---

### Task 2: Date formatting/sorting — stop string-splitting `publishDate`

**Files:**
- Modify: `scripts/blog/templates/articlePage.ts`
- Modify: `scripts/blog/templates/articlePage.test.ts`
- Modify: `scripts/blog/templates/indexPage.ts`
- Modify: `scripts/blog/templates/indexPage.test.ts`

**Interfaces:**
- Consumes: Task 1's `ArticleFrontmatter.publishDate` (now a full datetime string).
- Produces: no new exports — `formatArabicDate` and `sortByDateDesc` in both files keep their existing names and call sites; only their internals change.

**Why this task exists:** both files' `formatArabicDate(isoDate)` currently does `isoDate.split('-').map(Number)`, which silently produces garbage (`NaN` day) once `publishDate` carries a time component (`"2026-11-04T23:25:00+03:00".split('-')` does not split on the `T`). `sortByDateDesc` (`indexPage.ts`) uses `localeCompare` on the raw string, which happens to still sort correctly for same-format ISO strings but is fragile once mixed date-only and full-datetime values coexist.

- [ ] **Step 1: Write the failing test for `formatArabicDate` with a full datetime**

In `articlePage.test.ts`:
```ts
test('byline date formats correctly even when publishDate carries a time component', () => {
  const withTime = { ...baseArticle, frontmatter: { ...baseArticle.frontmatter, publishDate: '2026-11-04T23:25:00+03:00' } };
  const html = renderArticlePage(withTime, parsed, [withTime]);
  expect(html).toContain('4 نوفمبر 2026');
});
```
Mirror the same test in `indexPage.test.ts` against `renderArticleCard`'s output (via `renderIndexPage`).

- [ ] **Step 2: Run to verify both fail**

Run: `npx vitest run scripts/blog/templates/articlePage.test.ts scripts/blog/templates/indexPage.test.ts`
Expected: FAIL (wrong/garbled date text, or a thrown error from `NaN` array indexing).

- [ ] **Step 3: Rewrite `formatArabicDate` in both files to parse a real `Date`**

```ts
function formatArabicDate(isoDateTime: string): string {
  const d = new Date(isoDateTime);
  return `${d.getDate()} ${ARABIC_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
```
Keep `ARABIC_MONTHS` as-is. `.getDate()`/`.getMonth()`/`.getFullYear()` use the JS runtime's local timezone — since the build runs in one process with one fixed `TZ`, use `d.getUTCDate()`/`.getUTCMonth()`/`.getUTCFullYear()` instead so the displayed date doesn't shift depending on the build server's locale.

- [ ] **Step 4: Run to verify both pass**

Run: `npx vitest run scripts/blog/templates/articlePage.test.ts scripts/blog/templates/indexPage.test.ts`
Expected: PASS.

- [ ] **Step 5: Fix `sortByDateDesc` the same way**

In `indexPage.ts`: `(a, b) => new Date(b.frontmatter.publishDate).getTime() - new Date(a.frontmatter.publishDate).getTime()`, replacing the `localeCompare` call.

- [ ] **Step 6: Run the full scripts suite and commit**

Run: `npx vitest run scripts`
Expected: all pass.

```bash
git add scripts/blog/templates/articlePage.ts scripts/blog/templates/articlePage.test.ts scripts/blog/templates/indexPage.ts scripts/blog/templates/indexPage.test.ts
git commit -m "fix(blog): parse publishDate as a real Date instead of splitting the string"
```

---

### Task 3: GitHub Contents API client

**Files:**
- Create: `src/server/blogGitHub.ts`
- Test: `src/server/blogGitHub.test.ts`

**Interfaces:**
- Consumes: nothing from this plan's other tasks.
- Produces:
```ts
export class BlogGitHubError extends Error {
  constructor(message: string, public readonly status?: number) { ... }
}
export interface BlogFileListing { name: string; sha: string }
export interface BlogFileContent { path: string; sha: string; content: string }
export async function listBlogFiles(): Promise<BlogFileListing[]>
export async function getBlogFile(filename: string): Promise<BlogFileContent> // throws BlogGitHubError('<filename> not found', 404) on a GitHub 404
export async function createBlogFile(filename: string, content: string, message: string): Promise<void> // throws BlogGitHubError on any non-2xx, with GitHub's own message and status attached
export async function updateBlogFile(filename: string, content: string, sha: string, message: string): Promise<void>
export async function deleteBlogFile(filename: string, sha: string, message: string): Promise<void>
```
All five read `BLOG_GITHUB_TOKEN`, `BLOG_GITHUB_REPO`, `BLOG_GITHUB_BRANCH` from `process.env` on each call (not cached at module load) via an internal `requireBlogGitHubConfig()` that throws a plain `Error` naming the first missing variable it finds, checked in that order. All paths operate under `content/blog/` on the configured branch (i.e. `getBlogFile('how-to.md')` fetches `content/blog/how-to.md`).

- [ ] **Step 1: Write the failing test for the missing-config error**

```ts
test('throws naming the first missing required env var', async () => {
  delete process.env.BLOG_GITHUB_TOKEN;
  await expect(listBlogFiles()).rejects.toThrow(/BLOG_GITHUB_TOKEN/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/server/blogGitHub.test.ts`
Expected: FAIL with "listBlogFiles is not defined".

- [ ] **Step 3: Implement `requireBlogGitHubConfig` and `listBlogFiles`**

`listBlogFiles` calls `GET https://api.github.com/repos/{BLOG_GITHUB_REPO}/contents/content/blog?ref={BLOG_GITHUB_BRANCH}` with `Authorization: Bearer {token}` and `Accept: application/vnd.github+json`, filters the array response to `.md` files, returns `{name, sha}[]`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/server/blogGitHub.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing tests for `getBlogFile`, mocking global `fetch`**

```ts
test('getBlogFile decodes base64 content and returns the sha', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true, status: 200,
    json: async () => ({ path: 'content/blog/how-to.md', sha: 'abc123', content: Buffer.from('---\ntitle: x\n---\n').toString('base64'), encoding: 'base64' }),
  }));
  const file = await getBlogFile('how-to.md');
  expect(file.sha).toBe('abc123');
  expect(file.content).toContain('title: x');
});

test('getBlogFile throws BlogGitHubError with status 404 when GitHub returns 404', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ message: 'Not Found' }) }));
  await expect(getBlogFile('missing.md')).rejects.toMatchObject({ status: 404 });
});
```

- [ ] **Step 6: Run to verify both fail, then implement `getBlogFile`, then verify both pass**

Run: `npx vitest run src/server/blogGitHub.test.ts`
Expected: FAIL first ("getBlogFile is not defined"), then implement (`GET .../contents/content/blog/{filename}?ref={branch}`, decode `content` from base64, wrap non-2xx in `BlogGitHubError`), then PASS.

- [ ] **Step 7: Write the failing tests for `createBlogFile`/`updateBlogFile`/`deleteBlogFile`**

```ts
test('createBlogFile PUTs base64 content with no sha', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({}) });
  vi.stubGlobal('fetch', fetchMock);
  await createBlogFile('new.md', 'body', 'feat: add new.md');
  const [, init] = fetchMock.mock.calls[0];
  const body = JSON.parse(init.body);
  expect(body.sha).toBeUndefined();
  expect(Buffer.from(body.content, 'base64').toString('utf8')).toBe('body');
  expect(body.branch).toBe(process.env.BLOG_GITHUB_BRANCH);
});

test('createBlogFile throws BlogGitHubError with GitHub\'s message on a 422 (e.g. file already exists)', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 422, json: async () => ({ message: 'sha wasn\'t supplied' }) }));
  await expect(createBlogFile('exists.md', 'body', 'msg')).rejects.toMatchObject({ status: 422, message: expect.stringContaining('sha wasn\'t supplied') });
});

test('updateBlogFile PUTs with the given sha', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  vi.stubGlobal('fetch', fetchMock);
  await updateBlogFile('existing.md', 'new body', 'sha1', 'feat: update');
  const [, init] = fetchMock.mock.calls[0];
  expect(JSON.parse(init.body).sha).toBe('sha1');
});

test('deleteBlogFile DELETEs with the given sha', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  vi.stubGlobal('fetch', fetchMock);
  await deleteBlogFile('gone.md', 'sha2', 'feat: delete');
  const [, init] = fetchMock.mock.calls[0];
  expect(init.method).toBe('DELETE');
  expect(JSON.parse(init.body).sha).toBe('sha2');
});
```

- [ ] **Step 8: Run to verify all fail, then implement the three functions, then verify all pass**

Run: `npx vitest run src/server/blogGitHub.test.ts`
Expected: FAIL first, then PASS after implementing `createBlogFile`/`updateBlogFile`/`deleteBlogFile` against `PUT`/`DELETE .../contents/content/blog/{filename}` with a JSON body of `{message, content?, sha?, branch}`.

- [ ] **Step 9: Run the full file and commit**

Run: `npx vitest run src/server/blogGitHub.test.ts`
Expected: all pass.

```bash
git add src/server/blogGitHub.ts src/server/blogGitHub.test.ts
git commit -m "feat(blog): GitHub Contents API client for the admin editor"
```

---

### Task 4: Deploy-hook trigger (best-effort, never throws)

**Files:**
- Create: `src/server/blogDeployHook.ts`
- Test: `src/server/blogDeployHook.test.ts`

**Interfaces:**
- Consumes: nothing from this plan's other tasks.
- Produces: `export async function triggerBlogRebuild(): Promise<void>` — never rejects. Logs (via `console.warn`, matching this file's own locality since it has no logger import elsewhere nearby) and returns normally in every failure case: missing `BLOG_DEPLOY_HOOK_URL`, non-2xx response, network error, or timeout.

- [ ] **Step 1: Write the failing tests**

```ts
test('does nothing (no throw) when BLOG_DEPLOY_HOOK_URL is unset', async () => {
  delete process.env.BLOG_DEPLOY_HOOK_URL;
  await expect(triggerBlogRebuild()).resolves.toBeUndefined();
});

test('POSTs to the configured hook URL', async () => {
  process.env.BLOG_DEPLOY_HOOK_URL = 'https://api.vercel.com/v1/integrations/deploy/test';
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  vi.stubGlobal('fetch', fetchMock);
  await triggerBlogRebuild();
  expect(fetchMock).toHaveBeenCalledWith('https://api.vercel.com/v1/integrations/deploy/test', expect.objectContaining({ method: 'POST' }));
});

test('does not throw when the hook responds with a non-2xx status', async () => {
  process.env.BLOG_DEPLOY_HOOK_URL = 'https://api.vercel.com/v1/integrations/deploy/test';
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
  await expect(triggerBlogRebuild()).resolves.toBeUndefined();
});

test('does not throw and does not hang when the request itself errors (network failure)', async () => {
  process.env.BLOG_DEPLOY_HOOK_URL = 'https://api.vercel.com/v1/integrations/deploy/test';
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
  await expect(triggerBlogRebuild()).resolves.toBeUndefined();
});
```

- [ ] **Step 2: Run to verify all fail**

Run: `npx vitest run src/server/blogDeployHook.test.ts`
Expected: FAIL with "triggerBlogRebuild is not defined".

- [ ] **Step 3: Implement `triggerBlogRebuild`**

Wrap the whole body in `try { ... } catch (err) { console.warn('[blog] deploy hook trigger failed:', err); }`; inside the `try`, return early (no-op) if `!process.env.BLOG_DEPLOY_HOOK_URL`; otherwise `fetch(url, { method: 'POST', signal: AbortSignal.timeout(5000) })` (Review Focus: the save request must never hang on this — a 5s timeout caps it regardless of what the save route awaits), and if `!res.ok`, `console.warn` with the status instead of throwing.

- [ ] **Step 4: Run to verify all pass, then commit**

Run: `npx vitest run src/server/blogDeployHook.test.ts`
Expected: PASS.

```bash
git add src/server/blogDeployHook.ts src/server/blogDeployHook.test.ts
git commit -m "feat(blog): best-effort Vercel deploy-hook trigger"
```

---

### Task 5: Blog admin CRUD route handlers

**Files:**
- Create: `src/server/blogAdmin.ts`
- Test: `src/server/blogAdmin.test.ts`

**Interfaces:**
- Consumes: Task 1's `parseArticleFrontmatter`, `validateFrontmatter`, `ArticleFrontmatter`, `LoadedArticle` (`scripts/blog/frontmatter.ts`); Task 3's `listBlogFiles`/`getBlogFile`/`createBlogFile`/`updateBlogFile`/`deleteBlogFile`/`BlogGitHubError` (`src/server/blogGitHub.ts`); Task 4's `triggerBlogRebuild` (`src/server/blogDeployHook.ts`); `slugify` (`src/utils/slugify.ts`); `CATEGORIES`/`getCategory` (`scripts/blog/categories.ts`, unchanged).

**Import style note:** `blogAdmin.ts` must `import * as blogGitHub from './blogGitHub.ts'` and `import * as blogDeployHook from './blogDeployHook.ts'` (namespace imports, not named) — the test steps below mock them with `vi.spyOn(blogGitHub, 'getBlogFile')` etc., which only works on a namespace object, not a named ESM binding (those are read-only live bindings `vi.spyOn` can't intercept). `blogAdmin.test.ts` likewise does `import * as blogAdmin from './blogAdmin.ts'` so its own later steps can `vi.spyOn(blogAdmin, 'fetchAllArticles')` when testing `listArticles`/`createArticle` in isolation from it.

- Produces:
```ts
export async function fetchAllArticles(): Promise<LoadedArticle[]> // every content/blog/*.md on the configured branch, parsed via parseArticleFrontmatter -- includes scheduled/future-dated ones (Task 6 needs those for its own preview-time related-article resolution)
export async function listArticles(req: any, res: any): Promise<void>  // GET /api/admin/blog/articles
export async function getArticle(req: any, res: any): Promise<void>    // GET /api/admin/blog/articles/:slug
export async function createArticle(req: any, res: any): Promise<void> // POST /api/admin/blog/articles
export async function updateArticle(req: any, res: any): Promise<void> // PUT /api/admin/blog/articles/:slug
export async function deleteArticle(req: any, res: any): Promise<void> // DELETE /api/admin/blog/articles/:slug
```

`req.body` shape for create/update: `{ title: string, metaDescription: string, cluster: string, publishDate: string, related: string[], body: string }`.
Response shapes: `listArticles` → `200 { articles: { slug, title, cluster, publishDate, status: 'published'|'scheduled' }[] }`. `getArticle` → `200 { title, metaDescription, cluster, publishDate, related, body }` or `404 { error }`. `createArticle`/`updateArticle` → `200 { slug }` or `400 { error }` (validation) / `409 { error, existingTitle }` (slug taken, create only) / `502 { error }` (GitHub failure, message from `BlogGitHubError`). `deleteArticle` → `200 {}` or `404`/`502`.

- [ ] **Step 1: Write the failing test for `fetchAllArticles`**

```ts
test('fetchAllArticles parses every file listBlogFiles returns, including future-dated ones', async () => {
  vi.spyOn(blogGitHub, 'listBlogFiles').mockResolvedValue([{ name: 'a.md', sha: 's1' }]);
  vi.spyOn(blogGitHub, 'getBlogFile').mockResolvedValue({ path: 'content/blog/a.md', sha: 's1', content: '---\ntitle: "ق"\nmeta_description: "و"\ncluster: orders\npublish_date: "2099-01-01T00:00:00Z"\nrelated: []\n---\n\nنص.' });
  const articles = await fetchAllArticles();
  expect(articles).toHaveLength(1);
  expect(articles[0].frontmatter.title).toBe('ق');
});
```

- [ ] **Step 2: Run to verify it fails, implement, verify it passes**

Run: `npx vitest run src/server/blogAdmin.test.ts`
Expected: FAIL ("fetchAllArticles is not defined"), then implement (`listBlogFiles()` → `Promise.all` of `getBlogFile` per name → `parseArticleFrontmatter(filename, content)` per result → compute `slug`/`canonicalUrl`/`readTimeMinutes` the same way `loadArticles` does), then PASS.

- [ ] **Step 3: Write the failing tests for `listArticles`'s computed status**

```ts
function mockRes() { const res: any = { statusCode: 200 }; res.status = (c: number) => { res.statusCode = c; return res; }; res.json = (b: any) => { res.body = b; return res; }; return res; }

test('listArticles marks a future publishDate as scheduled and a past one as published', async () => {
  vi.spyOn(blogAdmin, 'fetchAllArticles').mockResolvedValue([
    { slug: 'future', frontmatter: { title: 'ق', metaDescription: 'و', cluster: 'orders', publishDate: '2099-01-01T00:00:00Z', related: [] }, rawBody: '', readTimeMinutes: 2, canonicalUrl: '' },
    { slug: 'past', frontmatter: { title: 'س', metaDescription: 'ص', cluster: 'orders', publishDate: '2020-01-01T00:00:00Z', related: [] }, rawBody: '', readTimeMinutes: 2, canonicalUrl: '' },
  ]);
  const res = mockRes();
  await listArticles({} as any, res);
  const byStatus = Object.fromEntries(res.body.articles.map((a: any) => [a.slug, a.status]));
  expect(byStatus.future).toBe('scheduled');
  expect(byStatus.past).toBe('published');
});
```

- [ ] **Step 4: Run to verify it fails, implement, verify it passes**

Run: `npx vitest run src/server/blogAdmin.test.ts`
Expected: FAIL, then implement `listArticles` (call `fetchAllArticles()`, map each to `{slug, title: frontmatter.title, cluster: frontmatter.cluster, publishDate: frontmatter.publishDate, status: new Date(frontmatter.publishDate) <= new Date() ? 'published' : 'scheduled'}`, `res.status(200).json({articles})`), then PASS.

- [ ] **Step 5: Write the failing tests for `createArticle`: happy path, validation failure, and slug collision**

```ts
test('createArticle validates with validateFrontmatter\'s own rules before ever calling GitHub', async () => {
  const createSpy = vi.spyOn(blogGitHub, 'createBlogFile');
  const res = mockRes();
  await createArticle({ body: { title: '', metaDescription: 'و', cluster: 'orders', publishDate: '2026-11-04T10:00:00Z', related: [], body: 'نص' } } as any, res);
  expect(res.statusCode).toBe(400);
  expect(createSpy).not.toHaveBeenCalled();
});

test('createArticle derives the slug from the title and commits via createBlogFile', async () => {
  vi.spyOn(blogGitHub, 'listBlogFiles').mockResolvedValue([]);
  const createSpy = vi.spyOn(blogGitHub, 'createBlogFile').mockResolvedValue(undefined);
  const hookSpy = vi.spyOn(blogDeployHook, 'triggerBlogRebuild').mockResolvedValue(undefined);
  const res = mockRes();
  await createArticle({ body: { title: 'عنوان جديد', metaDescription: 'وصف', cluster: 'orders', publishDate: '2026-11-04T10:00:00Z', related: [], body: 'نص المقالة' } } as any, res);
  expect(res.statusCode).toBe(200);
  expect(createSpy).toHaveBeenCalledWith(expect.stringContaining('.md'), expect.any(String), expect.any(String));
  expect(hookSpy).toHaveBeenCalled();
});

test('createArticle returns 409 with the existing title when the derived slug is already taken', async () => {
  vi.spyOn(blogGitHub, 'listBlogFiles').mockResolvedValue([{ name: 'existing-slug.md', sha: 's1' }]);
  vi.spyOn(blogAdmin, 'fetchAllArticles').mockResolvedValue([
    { slug: 'existing-slug', frontmatter: { title: 'العنوان الموجود', metaDescription: 'و', cluster: 'orders', publishDate: '2026-11-04T10:00:00Z', related: [] }, rawBody: '', readTimeMinutes: 2, canonicalUrl: '' },
  ]);
  const res = mockRes();
  await createArticle({ body: { title: 'العنوان الموجود', metaDescription: 'وصف', cluster: 'orders', publishDate: '2026-11-04T10:00:00Z', related: [], body: 'نص' } } as any, res);
  expect(res.statusCode).toBe(409);
  expect(res.body.existingTitle).toBe('العنوان الموجود');
});

// Review Focus: a 422 from GitHub ITSELF (e.g. a second save raced in between our
// own pre-check and the actual PUT, so GitHub rejects the create outright) is a
// different shape than our own pre-check 409 above, and must not surface as an
// opaque 500.
test('createArticle returns 502 with GitHub\'s own message when createBlogFile itself rejects with a 422', async () => {
  vi.spyOn(blogGitHub, 'listBlogFiles').mockResolvedValue([]);
  vi.spyOn(blogGitHub, 'createBlogFile').mockRejectedValue(new BlogGitHubError('Invalid request.\n\n"sha" wasn\'t supplied.', 422));
  const res = mockRes();
  await createArticle({ body: { title: 'عنوان جديد', metaDescription: 'وصف', cluster: 'orders', publishDate: '2026-11-04T10:00:00Z', related: [], body: 'نص' } } as any, res);
  expect(res.statusCode).toBe(502);
  expect(res.body.error).toContain('sha');
});
```

- [ ] **Step 6: Run to verify all three fail, implement `createArticle`, verify all three pass**

Run: `npx vitest run src/server/blogAdmin.test.ts`
Expected: FAIL first, then implement: `slug = slugify(req.body.title)`; build the frontmatter object + call `validateFrontmatter(slug + '.md', {title, meta_description: metaDescription, cluster, publish_date: publishDate, related})` (note the snake_case mapping `validateFrontmatter` expects — the same shape `gray-matter`'s `data` carries) inside a `try/catch` returning 400 with the caught message on failure; then `fetchAllArticles()` to check for an existing article whose slug matches, returning 409 with its title if found; then build the full Markdown string (frontmatter block + body) and call `createBlogFile(slug + '.md', fullMarkdown, `feat(blog): add ${title}`)`; on success call `triggerBlogRebuild()` (awaited, but its own errors never propagate per Task 4) and respond `200 {slug}`; wrap the `createBlogFile` call in a `try/catch` that responds `502 {error: err.message}` on a `BlogGitHubError`. Then PASS.

- [ ] **Step 7: Write the failing tests for `getArticle`, `updateArticle`, `deleteArticle`**

```ts
test('getArticle 404s when the slug has no matching file', async () => {
  vi.spyOn(blogGitHub, 'getBlogFile').mockRejectedValue(new BlogGitHubError('not found', 404));
  const res = mockRes();
  await getArticle({ params: { slug: 'missing' } } as any, res);
  expect(res.statusCode).toBe(404);
});

test('getArticle returns the parsed frontmatter and body for an existing slug', async () => {
  vi.spyOn(blogGitHub, 'getBlogFile').mockResolvedValue({ path: 'content/blog/x.md', sha: 's1', content: '---\ntitle: "ق"\nmeta_description: "و"\ncluster: orders\npublish_date: "2026-11-04T10:00:00Z"\nrelated: []\n---\n\nنص.' });
  const res = mockRes();
  await getArticle({ params: { slug: 'x' } } as any, res);
  expect(res.body.title).toBe('ق');
});

test('updateArticle fetches the current sha first, then updates with it', async () => {
  vi.spyOn(blogGitHub, 'getBlogFile').mockResolvedValue({ path: 'content/blog/x.md', sha: 'current-sha', content: '' });
  const updateSpy = vi.spyOn(blogGitHub, 'updateBlogFile').mockResolvedValue(undefined);
  vi.spyOn(blogDeployHook, 'triggerBlogRebuild').mockResolvedValue(undefined);
  const res = mockRes();
  await updateArticle({ params: { slug: 'x' }, body: { title: 'عنوان', metaDescription: 'وصف', cluster: 'orders', publishDate: '2026-11-04T10:00:00Z', related: [], body: 'نص' } } as any, res);
  expect(updateSpy).toHaveBeenCalledWith('x.md', expect.any(String), 'current-sha', expect.any(String));
  expect(res.statusCode).toBe(200);
});

test('deleteArticle fetches the current sha first, then deletes with it', async () => {
  vi.spyOn(blogGitHub, 'getBlogFile').mockResolvedValue({ path: 'content/blog/x.md', sha: 'current-sha', content: '' });
  const deleteSpy = vi.spyOn(blogGitHub, 'deleteBlogFile').mockResolvedValue(undefined);
  vi.spyOn(blogDeployHook, 'triggerBlogRebuild').mockResolvedValue(undefined);
  const res = mockRes();
  await deleteArticle({ params: { slug: 'x' } } as any, res);
  expect(deleteSpy).toHaveBeenCalledWith('x.md', 'current-sha', expect.any(String));
  expect(res.statusCode).toBe(200);
});
```

- [ ] **Step 8: Run to verify all fail, implement the three handlers, verify all pass**

Run: `npx vitest run src/server/blogAdmin.test.ts`
Expected: FAIL first. Implement `getArticle` (try `getBlogFile(slug + '.md')`, catch `BlogGitHubError` with `status === 404` → `res.status(404).json({error:'not found'})`, else parse via `parseArticleFrontmatter` and respond with the frontmatter fields + body). Implement `updateArticle` (same validate-first flow as create, but no slug-collision check — fetch the current file's `sha` via `getBlogFile(slug + '.md')` first, then `updateBlogFile(slug + '.md', fullMarkdown, sha, message)`, then `triggerBlogRebuild()`). Implement `deleteArticle` (fetch `sha` via `getBlogFile`, then `deleteBlogFile(slug + '.md', sha, message)`, then `triggerBlogRebuild()`). Then PASS.

- [ ] **Step 9: Run the full file and commit**

Run: `npx vitest run src/server/blogAdmin.test.ts`
Expected: all pass.

```bash
git add src/server/blogAdmin.ts src/server/blogAdmin.test.ts
git commit -m "feat(blog): admin CRUD route handlers backed by the GitHub Contents API"
```

---

### Task 6: Preview route handler

**Files:**
- Modify: `src/server/blogAdmin.ts`
- Modify: `src/server/blogAdmin.test.ts`

**Interfaces:**
- Consumes: Task 5's `fetchAllArticles` (same file); `parseArticleSections` (`scripts/blog/parseArticleSections.ts`); `renderArticlePage` (`scripts/blog/templates/articlePage.ts`); `validateFrontmatter`, `parseArticleFrontmatter` is not needed here since the request body already arrives as structured fields, not raw Markdown-with-frontmatter.
- Produces: `export async function previewArticle(req: any, res: any): Promise<void>` // `POST /api/admin/blog/preview`, body same shape as create/update, response `200 { html: string }` or `400 { error }`.

- [ ] **Step 1: Write the failing tests**

```ts
test('previewArticle validates the same way create/update do', async () => {
  const res = mockRes();
  await previewArticle({ body: { title: '', metaDescription: 'و', cluster: 'orders', publishDate: '2026-11-04T10:00:00Z', related: [], body: 'نص' } } as any, res);
  expect(res.statusCode).toBe(400);
});

test('previewArticle renders the real article page HTML without touching GitHub or the deploy hook', async () => {
  vi.spyOn(blogAdmin, 'fetchAllArticles').mockResolvedValue([]);
  const createSpy = vi.spyOn(blogGitHub, 'createBlogFile');
  const hookSpy = vi.spyOn(blogDeployHook, 'triggerBlogRebuild');
  const res = mockRes();
  await previewArticle({ body: { title: 'عنوان المعاينة', metaDescription: 'وصف', cluster: 'orders', publishDate: '2026-11-04T10:00:00Z', related: [], body: '## قسم\nنص.' } } as any, res);
  expect(res.statusCode).toBe(200);
  expect(res.body.html).toContain('عنوان المعاينة');
  expect(createSpy).not.toHaveBeenCalled();
  expect(hookSpy).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify both fail**

Run: `npx vitest run src/server/blogAdmin.test.ts`
Expected: FAIL with "previewArticle is not defined".

- [ ] **Step 3: Implement `previewArticle`**

Validate the same way `createArticle` does (400 on failure, same error shape). On success: build a synthetic `LoadedArticle` (`slug: 'preview'`, the given frontmatter fields, `rawBody: body`, `readTimeMinutes` computed the same way `frontmatter.ts` does — word count / 180, floored at 2 — `canonicalUrl: 'https://seentech.io/blog/preview'`); call `parseArticleSections(body)`; call `fetchAllArticles()` for the related-articles pool; call `renderArticlePage(syntheticArticle, parsed, allArticles)`; respond `200 {html}`.

- [ ] **Step 4: Run to verify both pass, then the full file, then commit**

Run: `npx vitest run src/server/blogAdmin.test.ts`
Expected: all pass.

```bash
git add src/server/blogAdmin.ts src/server/blogAdmin.test.ts
git commit -m "feat(blog): article preview rendering, no GitHub write and no deploy trigger"
```

---

### Task 7: Wire routes into server.ts, the cron sweep, and vercel.json

**Files:**
- Modify: `server.ts`
- Modify: `vercel.json`

**Interfaces:**
- Consumes: Task 5/6's `listArticles`/`getArticle`/`createArticle`/`updateArticle`/`deleteArticle`/`previewArticle` (`src/server/blogAdmin.ts`); Task 4's `triggerBlogRebuild` (`src/server/blogDeployHook.ts`); `authenticate`/`authorize` (already imported in `server.ts:7`); `asyncHandler` (already defined in `server.ts:188`).
- Produces: the six `/api/admin/blog/*` routes and `/api/cron/blog-rebuild-sweep`, all live in `server.ts`. No new exports — this task is wiring, not logic, so it has no unit test of its own; Task 8's eventual manual verification against the running app is what exercises this wiring end-to-end (per this project's "ask the user to test live, don't fabricate credentials" convention — there is no automated test for a real GitHub commit or a real Vercel deploy hook).

- [ ] **Step 1: Add the import and the six admin routes**

Near the other `/api/admin/*` routes (after line ~1241's `/api/admin/stats`), add:

```ts
import { listArticles, getArticle, createArticle, updateArticle, deleteArticle, previewArticle } from "./src/server/blogAdmin.ts";
import { triggerBlogRebuild } from "./src/server/blogDeployHook.ts";

app.get("/api/admin/blog/articles", authenticate, authorize(['super_admin']), asyncHandler(listArticles));
app.get("/api/admin/blog/articles/:slug", authenticate, authorize(['super_admin']), asyncHandler(getArticle));
app.post("/api/admin/blog/articles", authenticate, authorize(['super_admin']), asyncHandler(createArticle));
app.put("/api/admin/blog/articles/:slug", authenticate, authorize(['super_admin']), asyncHandler(updateArticle));
app.delete("/api/admin/blog/articles/:slug", authenticate, authorize(['super_admin']), asyncHandler(deleteArticle));
app.post("/api/admin/blog/preview", authenticate, authorize(['super_admin']), asyncHandler(previewArticle));
```

- [ ] **Step 2: Add the cron sweep route**

Next to the existing `/api/cron/zatca-cert-expiry-check` route (`server.ts:2806`), using the identical `CRON_SECRET` bearer-check pattern:

```ts
app.post("/api/cron/blog-rebuild-sweep", asyncHandler(async (req: any, res) => {
  const cronSecret = (process.env.CRON_SECRET || '').trim();
  if (!cronSecret || req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  await triggerBlogRebuild();
  res.status(200).json({ ok: true });
}));
```

- [ ] **Step 3: Add the cron entry to `vercel.json`**

In the existing `crons` array, add:
```json
{
  "path": "/api/cron/blog-rebuild-sweep",
  "schedule": "*/15 * * * *"
}
```

- [ ] **Step 4: Run the full test suite and typecheck to confirm nothing broke**

Run: `npx tsc --noEmit && npx vitest run`
Expected: both clean — this task adds no new tests of its own (pure wiring), so "nothing broke" is the completion signal.

- [ ] **Step 5: Commit**

```bash
git add server.ts vercel.json
git commit -m "feat(blog): wire admin routes and the rebuild-sweep cron into the server"
```

---

### Task 8: Admin editor screen

**Files:**
- Create: `src/components/AdminBlogEditor.tsx`
- Test: `src/components/AdminBlogEditor.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/SaaSLayout.tsx`

**Interfaces:**
- Consumes: `GET/POST/PUT/DELETE /api/admin/blog/articles[/:slug]` and `POST /api/admin/blog/preview` (Task 7); `CATEGORIES` (`scripts/blog/categories.ts`) for the category `<select>`; the existing `RouteBoundary`/`RoleGuard` pattern (`App.tsx`) and `SAAS_MENU_ITEMS` array (`SaaSLayout.tsx`).
- Produces: `export default function AdminBlogEditor(): JSX.Element` — no other module consumes this; it's a leaf route component.

- [ ] **Step 1: Write the failing test for the list view**

```tsx
test('renders every article from the API with its computed status', async () => {
  vi.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ articles: [
      { slug: 'a', title: 'مقالة أولى', cluster: 'orders', publishDate: '2020-01-01T00:00:00Z', status: 'published' },
      { slug: 'b', title: 'مقالة مجدولة', cluster: 'orders', publishDate: '2099-01-01T00:00:00Z', status: 'scheduled' },
    ] }),
  } as any);
  render(<AdminBlogEditor />);
  expect(await screen.findByText('مقالة أولى')).toBeInTheDocument();
  expect(await screen.findByText('مقالة مجدولة')).toBeInTheDocument();
  expect(screen.getByText(/منشورة/)).toBeInTheDocument();
  expect(screen.getByText(/مجدولة/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/AdminBlogEditor.test.tsx`
Expected: FAIL (module doesn't exist).

- [ ] **Step 3: Implement the list view**

On mount, `fetch('/api/admin/blog/articles')`, render a table/list of `{title, computed status label, edit button, delete button}`. Status label: `status === 'published' ? 'منشورة' : `مجدولة لـ ${formatted publishDate}``.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/AdminBlogEditor.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the create form + preview**

```tsx
test('filling the form and clicking preview calls the preview endpoint and shows the returned html', async () => {
  const fetchMock = vi.spyOn(global, 'fetch')
    .mockResolvedValueOnce({ ok: true, json: async () => ({ articles: [] }) } as any) // initial list load
    .mockResolvedValueOnce({ ok: true, json: async () => ({ html: '<html><body>معاينة</body></html>' }) } as any); // preview
  render(<AdminBlogEditor />);
  await screen.findByRole('button', { name: /مقالة جديدة/ });
  fireEvent.click(screen.getByRole('button', { name: /مقالة جديدة/ }));
  fireEvent.change(screen.getByLabelText(/العنوان/), { target: { value: 'عنوان تجريبي' } });
  fireEvent.click(screen.getByRole('button', { name: /معاينة/ }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/blog/preview', expect.objectContaining({ method: 'POST' })));
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run src/components/AdminBlogEditor.test.tsx`
Expected: FAIL (no "مقالة جديدة" button/form yet).

- [ ] **Step 7: Implement the create/edit form and preview**

Form fields: title (`<label>العنوان</label>`), meta description, category `<select>` from `CATEGORIES`, a datetime-local `<input type="datetime-local">` for `publishDate` (convert its value to a real offset-aware ISO string via `new Date(value).toISOString()` before sending — Review Focus: never send the naive local string as-is), a related-articles multi-select populated from the list already fetched, and a `<textarea>` for the body. "معاينة" button calls `POST /api/admin/blog/preview` with the current field values and renders the returned `html` in an `<iframe srcDoc={html}>`.

- [ ] **Step 8: Run to verify it passes**

Run: `npx vitest run src/components/AdminBlogEditor.test.tsx`
Expected: PASS.

- [ ] **Step 9: Write the failing test for save (create) and delete-confirmation**

```tsx
test('saving a new article POSTs to the articles endpoint and refreshes the list', async () => {
  const fetchMock = vi.spyOn(global, 'fetch')
    .mockResolvedValueOnce({ ok: true, json: async () => ({ articles: [] }) } as any)
    .mockResolvedValueOnce({ ok: true, json: async () => ({ slug: 'new-article' }) } as any)
    .mockResolvedValueOnce({ ok: true, json: async () => ({ articles: [{ slug: 'new-article', title: 'عنوان جديد', cluster: 'orders', publishDate: '2026-11-04T10:00:00Z', status: 'published' }] }) } as any);
  render(<AdminBlogEditor />);
  await screen.findByRole('button', { name: /مقالة جديدة/ });
  fireEvent.click(screen.getByRole('button', { name: /مقالة جديدة/ }));
  fireEvent.change(screen.getByLabelText(/العنوان/), { target: { value: 'عنوان جديد' } });
  fireEvent.click(screen.getByRole('button', { name: /^حفظ/ }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/blog/articles', expect.objectContaining({ method: 'POST' })));
  expect(await screen.findByText('عنوان جديد')).toBeInTheDocument();
});

test('clicking delete asks for confirmation before calling the delete endpoint', async () => {
  vi.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: true, json: async () => ({ articles: [
    { slug: 'a', title: 'مقالة', cluster: 'orders', publishDate: '2020-01-01T00:00:00Z', status: 'published' },
  ] }) } as any);
  render(<AdminBlogEditor />);
  await screen.findByText('مقالة');
  fireEvent.click(screen.getByRole('button', { name: /حذف/ }));
  expect(screen.getByText(/تأكيد الحذف/)).toBeInTheDocument();
});

// Review Focus: deleting an article doesn't update other articles' own `related`
// arrays (the public build already tolerates the resulting dangling slug by
// skipping it with a console warning -- pre-existing behavior, not new scope
// here), so the author should be told this up front rather than discovering a
// related-card silently vanished elsewhere later.
test('the delete confirmation names the article and warns that other articles may reference it', async () => {
  vi.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: true, json: async () => ({ articles: [
    { slug: 'a', title: 'مقالة', cluster: 'orders', publishDate: '2020-01-01T00:00:00Z', status: 'published' },
  ] }) } as any);
  render(<AdminBlogEditor />);
  await screen.findByText('مقالة');
  fireEvent.click(screen.getByRole('button', { name: /حذف/ }));
  expect(screen.getByText(/مقالة/)).toBeInTheDocument(); // the confirmation names it
  expect(screen.getByText(/قد تشير إليها مقالات أخرى/)).toBeInTheDocument();
});
```

- [ ] **Step 10: Run to verify both fail**

Run: `npx vitest run src/components/AdminBlogEditor.test.tsx`
Expected: FAIL (no save button wired to POST yet, no delete-confirmation dialog yet).

- [ ] **Step 11: Implement save and the delete-confirmation dialog**

Save button: `POST`/`PUT` to `/api/admin/blog/articles[/:slug]` with the form's current values (ISO `publishDate` as above), then re-`fetch` the list. Delete button opens an inline confirmation ("تأكيد الحذف") naming the article's title and warning "قد تشير إليها مقالات أخرى" (other articles may reference it) before actually calling `DELETE`.

- [ ] **Step 12: Run to verify both pass**

Run: `npx vitest run src/components/AdminBlogEditor.test.tsx`
Expected: PASS.

- [ ] **Step 13: Wire the route and the sidebar menu entry**

In `App.tsx`: `const AdminBlogEditor = React.lazy(() => import('./components/AdminBlogEditor'));` near the other super_admin lazy imports, and inside the `/admin/*` `Routes` block (next to the `/audit` route, `App.tsx:670`):
```tsx
<Route path="/blog" element={
  <RouteBoundary>
    <RoleGuard allowedRoles={['super_admin']}>
      <AdminBlogEditor />
    </RoleGuard>
  </RouteBoundary>
} />
```
In `SaaSLayout.tsx`'s `SAAS_MENU_ITEMS` array (`SaaSLayout.tsx:64`), add one entry reusing the existing `menu_blog` i18n key (already present in `ar.json`/`en.json`/`ur.json` from the old, now-removed screen):
```ts
{ id: 'blog', labelKey: 'saas.menu_blog', icon: Newspaper, path: '/admin/blog', roles: ['super_admin'] },
```
(`Newspaper` icon: re-add the import removed in the earlier migration's Task 13, `import { Newspaper } from 'lucide-react'` alongside the other icon imports at the top of the file.)

- [ ] **Step 14: Run the full test suite and typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: both clean.

- [ ] **Step 15: Commit**

```bash
git add src/components/AdminBlogEditor.tsx src/components/AdminBlogEditor.test.tsx src/App.tsx src/components/SaaSLayout.tsx
git commit -m "feat(blog): admin editor screen for creating/scheduling/editing/deleting articles"
```

---

## Manual verification (not automated — real credentials, real GitHub, real Vercel hook)

Per this project's standing convention (never fabricate credentials, ask the user to test live):

1. User creates the fine-grained GitHub PAT (Contents: Read and write, scoped to this one repo) and the Vercel Deploy Hook (targeting `staging`), and sets `BLOG_GITHUB_TOKEN`, `BLOG_GITHUB_REPO`, `BLOG_GITHUB_BRANCH=staging`, `BLOG_DEPLOY_HOOK_URL` on the staging Vercel project.
2. Log in as super_admin on staging, open `/admin/blog`, create a real article with `publishDate` set to "now", confirm it appears in the list as "منشورة" and the GitHub repo's `staging` branch has the new commit.
3. Create a second article scheduled ~5 minutes in the future, confirm it's absent from the live `/blog` page immediately, then reappears within ~15 minutes without any manual action (the cron sweep).
4. Edit an existing article's title, confirm the change lands on the live page after the triggered rebuild.
5. Delete an article, confirm it's gone from both the admin list and the live site.
