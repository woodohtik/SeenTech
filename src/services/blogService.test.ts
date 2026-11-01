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
