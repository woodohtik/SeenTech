/**
 * blogService -- طبقة الوصول لبيانات التدوينة (super-admin-managed blog).
 *
 * الجدول: blog_posts (Task 1). RLS تحصر الكتابة وقراءة المسودات على
 * super_admin فقط. مع ذلك نُضيف هنا `.eq('status', 'published')` بشكل
 * صريح في الاستعلامات العامة -- لا نعتمد على RLS وحدها لتحديد ما تطلبه
 * الواجهة (belt-and-suspenders).
 *
 * ملاحظة مهمة من مراجعة Task 1: لا يوجد trigger تلقائي على الجدول يحدّث
 * updated_at عند UPDATE (هناك DEFAULT now() فقط عند الإنشاء). لذلك يجب أن
 * يرسل `updatePost` دائماً updated_at صريحاً، وإلا يبقى التاريخ قديماً
 * للأبد في كل تعديل.
 */

import { supabase } from '../lib/supabase/client';

export interface BlogPost {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  coverImageUrl: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  status: 'draft' | 'scheduled' | 'published';
  publishedAt: string | null;
  scheduledFor: string | null;
  createdAt: string;
  updatedAt: string;
}

/** رمز الخطأ الذي ترجعه Postgres عند انتهاك قيد UNIQUE. */
const POSTGRES_UNIQUE_VIOLATION = '23505';

export class DuplicateSlugError extends Error {
  constructor(message = 'A post with this slug already exists.') {
    super(message);
    this.name = 'DuplicateSlugError';
  }
}

export class InvalidScheduleError extends Error {
  constructor(message = 'A scheduled post requires a future scheduledFor date.') {
    super(message);
    this.name = 'InvalidScheduleError';
  }
}

/** يتحقق من صحة الجدولة قبل الإرسال لقاعدة البيانات -- دفاع إضافي بجانب تحقق الواجهة. */
function validateSchedule(status: BlogPost['status'] | undefined, scheduledFor: string | null | undefined): void {
  if (status !== 'scheduled') return;
  if (!scheduledFor) throw new InvalidScheduleError();
  const date = new Date(scheduledFor);
  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
    throw new InvalidScheduleError();
  }
}

/** صف الجدول (snake_case) كما يرجعه Supabase. */
interface BlogPostRow {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  cover_image_url: string | null;
  meta_title: string | null;
  meta_description: string | null;
  status: 'draft' | 'scheduled' | 'published';
  published_at: string | null;
  scheduled_for: string | null;
  created_at: string;
  updated_at: string;
}

function rowToPost(row: BlogPostRow): BlogPost {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    content: row.content,
    coverImageUrl: row.cover_image_url,
    metaTitle: row.meta_title,
    metaDescription: row.meta_description,
    status: row.status,
    publishedAt: row.published_at,
    scheduledFor: row.scheduled_for,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** يحوّل الحقول الاختيارية الممرّرة من الواجهة (camelCase) إلى أعمدة الجدول (snake_case). */
function postPatchToRow(patch: Partial<Omit<BlogPost, 'id' | 'createdAt'>>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if ('title' in patch) row.title = patch.title;
  if ('slug' in patch) row.slug = patch.slug;
  if ('excerpt' in patch) row.excerpt = patch.excerpt;
  if ('content' in patch) row.content = patch.content;
  if ('coverImageUrl' in patch) row.cover_image_url = patch.coverImageUrl;
  if ('metaTitle' in patch) row.meta_title = patch.metaTitle;
  if ('metaDescription' in patch) row.meta_description = patch.metaDescription;
  if ('status' in patch) row.status = patch.status;
  if ('publishedAt' in patch) row.published_at = patch.publishedAt;
  if ('scheduledFor' in patch) row.scheduled_for = patch.scheduledFor;
  if ('updatedAt' in patch) row.updated_at = patch.updatedAt;
  return row;
}

function throwMapped(error: { code?: string; message?: string }): never {
  if (error.code === POSTGRES_UNIQUE_VIOLATION) {
    throw new DuplicateSlugError();
  }
  throw error;
}

/** يجلب صفحة من التدوينات المنشورة فقط، مرتّبة بتاريخ النشر الأحدث أولاً. */
export async function listPublishedPosts(
  page: number,
  pageSize: number,
): Promise<{ posts: BlogPost[]; total: number }> {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const { data, error, count } = await supabase
    .from('blog_posts')
    .select('*', { count: 'exact' })
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .range(from, to);
  if (error) throw error;
  return { posts: ((data || []) as BlogPostRow[]).map(rowToPost), total: count ?? 0 };
}

/** يجلب تدوينة منشورة واحدة بالـslug، أو null إن لم توجد/كانت مسودة. */
export async function getPublishedPostBySlug(slug: string): Promise<BlogPost | null> {
  const { data, error } = await supabase
    .from('blog_posts')
    .select('*')
    .eq('slug', slug)
    .eq('status', 'published')
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return rowToPost(data as BlogPostRow);
}

/** يجلب كل التدوينات (مسودات ومنشورة) لواجهة إدارة super-admin. تعتمد على RLS لحصر الوصول. */
export async function listAllPostsForAdmin(): Promise<BlogPost[]> {
  const { data, error } = await supabase
    .from('blog_posts')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ((data || []) as BlogPostRow[]).map(rowToPost);
}

export async function createPost(
  input: Omit<BlogPost, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<BlogPost> {
  validateSchedule(input.status, input.scheduledFor);
  const row = {
    title: input.title,
    slug: input.slug,
    excerpt: input.excerpt,
    content: input.content,
    cover_image_url: input.coverImageUrl,
    meta_title: input.metaTitle,
    meta_description: input.metaDescription,
    status: input.status,
    published_at: input.publishedAt,
    scheduled_for: input.scheduledFor,
  };
  const { data, error } = await supabase
    .from('blog_posts')
    .insert(row)
    .select()
    .single();
  if (error) throwMapped(error);
  return rowToPost(data as BlogPostRow);
}

/**
 * يحدّث تدوينة. يُضمّن updated_at دائماً بشكل صريح (الجدول لا يملك trigger
 * تلقائي لذلك -- انظر ملاحظة مراجعة Task 1 أعلى الملف).
 */
export async function updatePost(
  id: string,
  patch: Partial<Omit<BlogPost, 'id' | 'createdAt'>>,
): Promise<BlogPost> {
  validateSchedule(patch.status, patch.scheduledFor);
  const row = {
    ...postPatchToRow(patch),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('blog_posts')
    .update(row)
    .eq('id', id)
    .select()
    .single();
  if (error) throwMapped(error);
  return rowToPost(data as BlogPostRow);
}

export async function deletePost(id: string): Promise<void> {
  const { error } = await supabase.from('blog_posts').delete().eq('id', id);
  if (error) throw error;
}
