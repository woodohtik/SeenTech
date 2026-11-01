// @vitest-environment jsdom
import { test, expect, vi, afterEach } from 'vitest';

const singleMock = vi.fn();
const fromMock = vi.fn();
vi.mock('../lib/supabase/client', () => ({
  supabase: { from: (...args: any[]) => fromMock(...args) },
}));

afterEach(() => { vi.clearAllMocks(); });

import { getPublishedPostBySlug, createPost, updatePost, DuplicateSlugError, InvalidScheduleError } from './blogService';

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
    metaTitle: null, metaDescription: null, status: 'draft', publishedAt: null, scheduledFor: null,
  })).rejects.toBeInstanceOf(DuplicateSlugError);
});

test('createPost rejects with InvalidScheduleError when scheduled without a scheduledFor date', async () => {
  await expect(createPost({
    title: 'عنوان', slug: 'slug', excerpt: '', content: '', coverImageUrl: null,
    metaTitle: null, metaDescription: null, status: 'scheduled', publishedAt: null, scheduledFor: null,
  })).rejects.toBeInstanceOf(InvalidScheduleError);
  expect(fromMock).not.toHaveBeenCalled();
});

test('createPost rejects with InvalidScheduleError when scheduledFor is in the past', async () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  await expect(createPost({
    title: 'عنوان', slug: 'slug', excerpt: '', content: '', coverImageUrl: null,
    metaTitle: null, metaDescription: null, status: 'scheduled', publishedAt: null, scheduledFor: past,
  })).rejects.toBeInstanceOf(InvalidScheduleError);
  expect(fromMock).not.toHaveBeenCalled();
});

test('createPost sends scheduled_for through to the insert when scheduled with a valid future date', async () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const insertFn = vi.fn().mockReturnValue({
    select: () => ({ single: vi.fn().mockResolvedValue({
      data: {
        id: '1', title: 'عنوان', slug: 'slug', excerpt: '', content: '', cover_image_url: null,
        meta_title: null, meta_description: null, status: 'scheduled', published_at: null,
        scheduled_for: future, created_at: future, updated_at: future,
      },
      error: null,
    }) }),
  });
  fromMock.mockReturnValue({ insert: insertFn });
  const result = await createPost({
    title: 'عنوان', slug: 'slug', excerpt: '', content: '', coverImageUrl: null,
    metaTitle: null, metaDescription: null, status: 'scheduled', publishedAt: null, scheduledFor: future,
  });
  expect(insertFn).toHaveBeenCalledWith(expect.objectContaining({ scheduled_for: future }));
  expect(result.scheduledFor).toBe(future);
});

test('updatePost rejects with InvalidScheduleError when patching status to scheduled without a scheduledFor', async () => {
  await expect(updatePost('1', { status: 'scheduled' })).rejects.toBeInstanceOf(InvalidScheduleError);
  expect(fromMock).not.toHaveBeenCalled();
});
