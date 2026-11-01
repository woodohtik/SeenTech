# Blog System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a super-admin-managed, Arabic-only marketing blog: a `blog_posts` table, a `/admin/blog` management screen gated to the `super_admin` role, public `/blog` and `/blog/:slug` React pages with SEO-friendly titles/meta descriptions, and a link from the static landing page into the blog.

**Architecture:** Direct Supabase client calls gated by Row Level Security (no new `server.ts` endpoints — matches this codebase's existing super-admin-screen convention). Public read access is RLS-scoped to `status = 'published'` rows only; all other access requires the existing `app_is_super_admin()` RLS helper. The public blog pages are ordinary React Router routes registered outside the authenticated route tree, reusing the landing page's existing `postMessage` navigation bridge with zero new JavaScript on the static HTML side.

**Tech Stack:** React + TypeScript, Supabase/Postgres (migration + RLS), Vitest, React Router (lazy-loaded public routes), a markdown-to-HTML library (added in Task 5 if none already exists).

**Spec:** [docs/superpowers/specs/2026-11-01-blog-system-design.md](../specs/2026-11-01-blog-system-design.md)

## Global Constraints

- All blog content is Arabic-only — no per-language fields.
- No categories, tags, or future-dated scheduled publishing in this version.
- Only the `super_admin` role may manage posts; the other three SaaS roles (`support_tech`, `billing_admin`, `sales`) get no access to `/admin/blog` or to draft/unpublished content.
- Writes and privileged reads go through direct Supabase calls gated by RLS — never a new `server.ts` endpoint.
- Cover images go through the existing `uploadImageToSupabase()` helper, never a new upload path.
- Markdown content is rendered through a renderer that escapes/strips raw HTML — never `dangerouslySetInnerHTML` on unsanitized output.

## Review Focus

- Saving a post whose slug collides with an existing one (duplicate `UNIQUE` constraint) must surface a clear, recoverable error, not a crash or a silently-overwritten row — tested in Task 3.
- `getPublishedPostBySlug` must return `null` for a slug that exists but is still a draft — a reasonable site visitor who guesses or old-bookmarks a draft URL must see "not found," never unpublished content — tested in Task 3.
- RLS must actually block a non-`super_admin` write and an anonymous read of a draft row, not just the application-layer `RoleGuard` — verified manually against the real staging database in Task 1 (no RLS test harness exists in this codebase today).
- Markdown content containing a literal `<script>` or other raw HTML tag must not execute or render as live markup on the public post page — tested in Task 5 via an extracted rendering helper.
- The post page's `document.title`/meta-description must be restored to the app's defaults when the visitor navigates away — manually verified in Task 5 (no automated test precedent for page-level head-tag side effects in this codebase).

---

### Task 1: Database migration — `blog_posts` table and RLS

**Files:**
- Create: `supabase/migrations/20261108000000_blog_posts_table.sql`

**Interfaces:**
- Produces: `blog_posts` table with columns `id uuid PK`, `title text`, `slug text UNIQUE`, `excerpt text`, `content text`, `cover_image_url text`, `meta_title text`, `meta_description text`, `status text CHECK IN ('draft','published')`, `published_at timestamptz`, `created_at timestamptz`, `updated_at timestamptz`; RLS policies `blog_posts_public_read` (anon, `status = 'published'`) and `blog_posts_admin_all` (`app_is_super_admin()`, all operations).

- [ ] **Step 1: Write the migration**

```sql
CREATE TABLE blog_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  excerpt text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  cover_image_url text,
  meta_title text,
  meta_description text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX blog_posts_slug_idx ON blog_posts (slug);
CREATE INDEX blog_posts_status_published_idx ON blog_posts (status, published_at DESC);

ALTER TABLE blog_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY blog_posts_public_read ON blog_posts
  FOR SELECT TO anon
  USING (status = 'published');

CREATE POLICY blog_posts_admin_all ON blog_posts
  FOR ALL
  USING (app_is_super_admin())
  WITH CHECK (app_is_super_admin());
```

- [ ] **Step 2: Apply to staging and verify both policies**

Run `supabase db push` (staging project, already linked in prior sessions — re-link with `supabase link --project-ref yodvqhdjzjyhvrlhguzf` if this is a fresh worktree).

Verify with direct SQL (via `supabase db query --linked` or the Supabase SQL editor):
1. Insert one `draft` and one `published` row directly as the table owner (bypasses RLS from the SQL editor).
2. `SET ROLE anon; SELECT * FROM blog_posts;` — Expected: only the `published` row returned, 0 rows show the `draft` one.
3. `RESET ROLE;` afterward.

Expected: anon sees exactly 1 row (the published one); the draft row is invisible to anon.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20261108000000_blog_posts_table.sql
git commit -m "feat: add blog_posts table with public/super-admin RLS"
```

---

### Task 2: `slugify` utility

**Files:**
- Create: `src/utils/slugify.ts`
- Test: `src/utils/slugify.test.ts`

**Interfaces:**
- Produces: `export function slugify(title: string): string` — keeps Arabic/Latin letters, digits, and spaces (spaces become single hyphens); strips punctuation and other symbols; collapses repeated whitespace/hyphens; trims leading/trailing hyphens.

- [ ] **Step 1: Write the failing tests**

```ts
import { test, expect } from 'vitest';
import { slugify } from './slugify';

test('converts spaces to hyphens', () => {
  expect(slugify('مرحباً بكم في المدونة')).toBe('مرحباً-بكم-في-المدونة');
});

test('strips punctuation', () => {
  expect(slugify('سؤال: كيف تطّرز ثوباً؟!')).toBe('سؤال-كيف-تطّرز-ثوباً');
});

test('collapses repeated whitespace into one hyphen', () => {
  expect(slugify('عنوان   فيه   مسافات')).toBe('عنوان-فيه-مسافات');
});

test('trims leading and trailing punctuation/whitespace', () => {
  expect(slugify('  -- عنوان --  ')).toBe('عنوان');
});

test('keeps Latin letters and digits as-is', () => {
  expect(slugify('Seen POS 2026 إطلاق')).toBe('Seen-POS-2026-إطلاق');
});

test('empty input produces an empty string', () => {
  expect(slugify('')).toBe('');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- slugify --run`
Expected: FAIL — `Cannot find module './slugify'`

- [ ] **Step 3: Implement `slugify` in `src/utils/slugify.ts`**

Use a Unicode-aware regex that keeps `\p{L}` (any letter, Arabic included), `\p{N}` (digits), and whitespace, strips everything else, then collapses whitespace runs to a single `-` and trims leading/trailing `-`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- slugify --run`
Expected: PASS, 6/6

- [ ] **Step 5: Commit**

```bash
git add src/utils/slugify.ts src/utils/slugify.test.ts
git commit -m "feat: add Arabic-aware slugify utility"
```

---

### Task 3: `blogService.ts` data layer

**Files:**
- Create: `src/services/blogService.ts`
- Test: `src/services/blogService.test.ts`

**Interfaces:**
- Consumes: the `supabase` client from `src/lib/supabase/client.ts` (same import path used by `useMeasurementUnit.ts`); `blog_posts` table/columns from Task 1.
- Produces:
  ```ts
  export interface BlogPost {
    id: string;
    title: string;
    slug: string;
    excerpt: string;
    content: string;
    coverImageUrl: string | null;
    metaTitle: string | null;
    metaDescription: string | null;
    status: 'draft' | 'published';
    publishedAt: string | null;
    createdAt: string;
    updatedAt: string;
  }
  export function listPublishedPosts(page: number, pageSize: number): Promise<{ posts: BlogPost[]; total: number }>;
  export function getPublishedPostBySlug(slug: string): Promise<BlogPost | null>;
  export function listAllPostsForAdmin(): Promise<BlogPost[]>;
  export function createPost(input: Omit<BlogPost, 'id' | 'createdAt' | 'updatedAt'>): Promise<BlogPost>;
  export function updatePost(id: string, patch: Partial<Omit<BlogPost, 'id' | 'createdAt'>>): Promise<BlogPost>;
  export function deletePost(id: string): Promise<void>;
  export class DuplicateSlugError extends Error {}
  ```
  `createPost`/`updatePost` reject with `DuplicateSlugError` (not a raw Postgres error) when the underlying insert/update fails on the `slug` unique constraint, so callers can show a specific message instead of a generic failure.

- [ ] **Step 1: Write the failing tests**

```ts
// @vitest-environment jsdom
import { test, expect, vi, afterEach } from 'vitest';

const singleMock = vi.fn();
const fromMock = vi.fn();
vi.mock('../lib/supabase/client', () => ({
  supabase: { from: (...args: any[]) => fromMock(...args) },
}));

afterEach(() => { vi.clearAllMocks(); });

import { getPublishedPostBySlug, createPost, DuplicateSlugError } from './blogService';

test('getPublishedPostBySlug returns null for a slug that is a draft, not an error', async () => {
  // The query itself is scoped by RLS to published rows; simulate RLS
  // filtering the draft out entirely (maybeSingle resolves with no row).
  singleMock.mockResolvedValue({ data: null, error: null });
  fromMock.mockReturnValue({
    select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: singleMock }) }) }),
  });
  const result = await getPublishedPostBySlug('some-draft-slug');
  expect(result).toBeNull();
});

test('createPost rejects with DuplicateSlugError on a unique-constraint violation', async () => {
  const insertSingle = vi.fn().mockResolvedValue({
    data: null,
    error: { code: '23505', message: 'duplicate key value violates unique constraint "blog_posts_slug_key"' },
  });
  fromMock.mockReturnValue({
    insert: () => ({ select: () => ({ single: insertSingle }) }),
  });
  await expect(createPost({
    title: 'عنوان', slug: 'عنوان-مكرر', excerpt: '', content: '', coverImageUrl: null,
    metaTitle: null, metaDescription: null, status: 'draft', publishedAt: null,
  })).rejects.toBeInstanceOf(DuplicateSlugError);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- blogService --run`
Expected: FAIL — `Cannot find module './blogService'`

- [ ] **Step 3: Implement `src/services/blogService.ts`**

`listPublishedPosts`/`getPublishedPostBySlug` query `.eq('status', 'published')` explicitly (belt-and-suspenders alongside RLS — never rely on RLS alone to decide what the UI requests). `getPublishedPostBySlug` uses `.eq('slug', slug).eq('status', 'published').maybeSingle()` and returns `null` when `data` is null, matching the test. `createPost`/`updatePost` inspect the Supabase error's `code` field (`'23505'` is Postgres's unique-violation code) and throw `new DuplicateSlugError(...)` instead of the raw error; any other error rethrows as-is. Map snake_case DB columns (`cover_image_url`, `meta_title`, etc.) to the camelCase `BlogPost` shape in both directions.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- blogService --run`
Expected: PASS, 2/2

- [ ] **Step 5: Commit**

```bash
git add src/services/blogService.ts src/services/blogService.test.ts
git commit -m "feat: add blogService data layer"
```

---

### Task 4: `/admin/blog` management screen

**Files:**
- Create: `src/components/AdminBlog.tsx`
- Modify: `App.tsx:587-676` (admin routes block)

**Interfaces:**
- Consumes: `BlogPost`, `listAllPostsForAdmin`, `createPost`, `updatePost`, `deletePost`, `DuplicateSlugError` from Task 3; `slugify` from Task 2; `RoleGuard` (`src/components/RoleGuard.tsx`); `uploadImageToSupabase` (`src/lib/supabase/storage.ts`, same function `ProductImageUploader.tsx` uses); `useConfirm`, `useToast`, `IconInput` (existing, already used by `SaaSTeamManagement.tsx`).
- Produces: route `/admin/blog`, gated `RoleGuard allowedRoles={['super_admin']}`.

No test (matches this codebase's established convention for large admin screen components — `SaaSTeamManagement.tsx` and every component touched in the prior measurement-units plan have none). Verified by `npm run lint` + a manual check (Step 6).

- [ ] **Step 1: Add the route in `App.tsx`**

Inside the existing `/admin/*` routes block (587-676), following the exact pattern used for `/tailors` (601-606):

```tsx
<Route path="blog" element={
  <RouteBoundary><RoleGuard allowedRoles={['super_admin']}><AdminBlog /></RoleGuard></RouteBoundary>
} />
```

Add the corresponding import near the file's other admin-screen imports, matching whatever import style (direct `import` or `React.lazy`) the existing `/admin/*` screen imports already use in this file — do not assume it matches the public-page lazy-import convention from Task 5, which is a different part of the file.

- [ ] **Step 2: Build the post list view in `AdminBlog.tsx`**

Follow `SaaSTeamManagement.tsx`'s structure: `useState` for `posts`/`loading`/`isModalOpen`/`editingPost`, `useEffect` calling `listAllPostsForAdmin()` on mount. Render a list/table: title, a status badge (مسودة/منشور), last-updated date, an edit button, a delete button (wrapped in `useConfirm()`), and a "مقال جديد" button that opens the modal with `editingPost = null`.

- [ ] **Step 3: Build the add/edit form modal**

Fields, in this order: title (`IconInput`), slug (auto-fills from `slugify(title)` only while the user hasn't hand-edited the slug field yet — track with a `slugTouched` boolean that flips true on the slug field's own `onChange`), excerpt (textarea), content (large textarea, placeholder noting it's Markdown), cover image (reuse `ProductImageUploader.tsx`'s upload-then-compress flow via `uploadImageToSupabase(file, 'blog')`), meta title (`IconInput`, optional), meta description (textarea, optional), a status toggle (مسودة/منشور).

- [ ] **Step 4: Wire save/delete**

On submit: call `createPost`/`updatePost` depending on `editingPost`. On `updatePost`, if `status` is being set to `'published'` and the existing post's `publishedAt` is null, set `publishedAt` to `new Date().toISOString()` in the patch (never overwrite an existing `publishedAt`). Catch `DuplicateSlugError` specifically and show a toast telling the user the slug is taken (point at the slug field); catch any other error with a generic failure toast. On delete: `useConfirm()` first, then `deletePost(id)`, then refresh the list.

- [ ] **Step 5: Typecheck**

Run: `npm run lint`
Expected: 0 errors.

- [ ] **Step 6: Manual verification on staging**

Log in as a `super_admin` account, open `/admin/blog`, create a post (title, content, cover image, meta fields), save as draft, confirm it appears in the list as "مسودة". Edit it, switch to "منشور", save. Try creating a second post with the same slug as an existing one — confirm the duplicate-slug toast appears instead of a crash. Delete a post and confirm the confirmation dialog appears first.

- [ ] **Step 7: Commit**

```bash
git add src/components/AdminBlog.tsx App.tsx
git commit -m "feat: add /admin/blog management screen"
```

---

### Task 5: Public `/blog` and `/blog/:slug` pages

**Files:**
- Create: `src/pages/BlogList.tsx`, `src/pages/BlogPost.tsx`, `src/utils/renderMarkdown.ts`
- Test: `src/utils/renderMarkdown.test.ts`
- Modify: `App.tsx` (public routes section, near `566-577`)

**Interfaces:**
- Consumes: `BlogPost`, `listPublishedPosts`, `getPublishedPostBySlug` from Task 3.
- Produces: `export function renderMarkdown(content: string): string` (returns sanitized HTML, safe to pass to `dangerouslySetInnerHTML`); public routes `/blog`, `/blog/:slug`.

- [ ] **Step 1: Check for an existing markdown dependency, add one if needed**

Run: `grep -E '"(marked|markdown-it|react-markdown|remark)"' package.json`
If none of those appear, run `npm install marked` (a small, dependency-free markdown-to-HTML converter). If one is already present, use it instead and skip the install.

- [ ] **Step 2: Write the failing test for `renderMarkdown`**

```ts
import { test, expect } from 'vitest';
import { renderMarkdown } from './renderMarkdown';

test('converts basic markdown to HTML', () => {
  expect(renderMarkdown('# عنوان\n\nفقرة **عريضة**.')).toContain('<h1');
  expect(renderMarkdown('# عنوان\n\nفقرة **عريضة**.')).toContain('<strong>عريضة</strong>');
});

test('raw script tags in the source are not rendered as live markup', () => {
  const html = renderMarkdown('نص عادي <script>alert(1)</script> بعده');
  expect(html).not.toContain('<script>');
});

test('empty input renders to an empty or near-empty string', () => {
  expect(renderMarkdown('').trim()).toBe('');
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test -- renderMarkdown --run`
Expected: FAIL — `Cannot find module './renderMarkdown'`

- [ ] **Step 4: Implement `renderMarkdown` in `src/utils/renderMarkdown.ts`**

Call the chosen markdown library with raw-HTML input disabled/escaped (e.g. `marked.parse(content, { sanitize: true })` on older `marked` versions, or escape `<`/`>` in the source before parsing if the installed version's API differs — check the installed version's actual option name since `marked`'s sanitize API has changed across major versions, and use whatever that version calls it). The test in Step 2 is the source of truth: whatever approach is used, the `<script>` test must pass.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test -- renderMarkdown --run`
Expected: PASS, 3/3

- [ ] **Step 6: Build `src/pages/BlogList.tsx`**

Calls `listPublishedPosts(page, 10)` (page from a `?page=` query param, default 1). Renders a card per post: `coverImageUrl` (if present), `title`, `excerpt`, a formatted `publishedAt` date, linking to `/blog/${slug}`. Simple prev/next pagination using `total` from the response.

- [ ] **Step 7: Build `src/pages/BlogPost.tsx`**

Calls `getPublishedPostBySlug(slug)` from the route param. If `null`, render a simple "المقال غير موجود" message (not a thrown error/500). Otherwise render the title, cover image, and `renderMarkdown(content)` via `dangerouslySetInnerHTML` (safe per Task 5's sanitized renderer). Set `document.title` and the `meta[name="description"]` tag in a `useEffect`, restoring the previous values in the cleanup function:

```ts
useEffect(() => {
  const prevTitle = document.title;
  document.title = post.metaTitle || post.title;
  let meta = document.querySelector('meta[name="description"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'description');
    document.head.appendChild(meta);
  }
  const prevContent = meta.getAttribute('content');
  meta.setAttribute('content', post.metaDescription || post.excerpt);
  return () => {
    document.title = prevTitle;
    if (prevContent !== null) meta!.setAttribute('content', prevContent);
  };
}, [post]);
```

- [ ] **Step 8: Register the public routes in `App.tsx`**

Next to the existing public (no-auth) routes around line 566-577 (same pattern as `/track/:token`), outside the authenticated route tree:

```tsx
{/* Public blog (no auth) */}
<Route path="/blog" element={<BlogList />} />
<Route path="/blog/:slug" element={<BlogPost />} />
```

Lazy-import both: `const BlogList = React.lazy(() => import('./pages/BlogList'));` (same convention as the file's other `./pages/` lazy imports).

- [ ] **Step 9: Typecheck**

Run: `npm run lint`
Expected: 0 errors.

- [ ] **Step 10: Manual verification on staging**

Publish a post from `/admin/blog` (Task 4). Visit `/blog` logged out (or in a private window) — confirm the post appears with no login required, and that a draft post does NOT appear. Visit `/blog/<published-slug>` — confirm the content renders, the browser tab title changes to the post's title, then navigate back into the app and confirm the tab title reverts to the app's normal title (not stuck on the post's title).

- [ ] **Step 11: Commit**

```bash
git add src/pages/BlogList.tsx src/pages/BlogPost.tsx src/utils/renderMarkdown.ts src/utils/renderMarkdown.test.ts App.tsx package.json package-lock.json
git commit -m "feat: add public blog list and post pages"
```

---

### Task 6: Landing page link

**Files:**
- Modify: `src/components/LandingPage.html` (nav ~line 227, footer ~line 955)

**Interfaces:**
- Consumes: nothing new — the existing `public/assets/landing-bridge.js` delegated click handler already intercepts any `<a href="/...">` click and posts a `NAVIGATE` message to the parent app; this task only needs two anchor tags, no new script.

No test (static HTML, no project test harness for this file). Verified by manual check (Step 3).

- [ ] **Step 1: Add the nav link**

Inside `<nav class="nav" id="nav">` (~line 227), add a link to the other nav items' pattern: `<a href="/blog" target="_parent">المدونة</a>`.

- [ ] **Step 2: Add the footer link**

Inside the footer section (~line 955), add the same link in whatever list of footer links already exists there, matching its existing markup pattern.

- [ ] **Step 3: Manual verification on staging**

Load the landing page, click "المدونة" in the nav — confirm it navigates to `/blog` (not a dead link or a page reload inside the iframe). Repeat for the footer link.

- [ ] **Step 4: Commit**

```bash
git add src/components/LandingPage.html
git commit -m "feat: link the landing page to the blog"
```
