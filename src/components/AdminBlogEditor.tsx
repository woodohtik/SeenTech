/**
 * Admin screen for the GitHub-backed blog: list, create, edit, preview and
 * delete articles. Talks directly to the Task 7 server routes
 * (`/api/admin/blog/articles[/:slug]`, `/api/admin/blog/preview`) with plain
 * `fetch` -- no dedicated data-fetching library, per the plan.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle, XCircle } from 'lucide-react';
import { CATEGORIES } from '../../scripts/blog/categories';
import { supabase } from '../lib/supabase/client';
import { Button } from './ui/Button';
import { Card } from './ui/Card';

interface ArticleListItem {
  slug: string;
  title: string;
  cluster: string;
  publishDate: string;
  status: 'published' | 'scheduled';
}

interface ArticleFormState {
  title: string;
  metaDescription: string;
  cluster: string;
  // The raw value of the <input type="datetime-local">: a naive local
  // datetime string with NO timezone/offset information.
  publishDateLocal: string;
  related: string[];
  body: string;
}

const EMPTY_FORM: ArticleFormState = {
  title: '',
  metaDescription: '',
  cluster: CATEGORIES[0]?.slug ?? '',
  publishDateLocal: '',
  related: [],
  body: '',
};

// Reused everywhere this screen renders a plain text input/select/textarea --
// this app's Tailwind reset otherwise leaves them borderless/invisible.
// Copied verbatim from src/components/forms/CustomerForm.tsx's own pattern.
const FIELD_CLASS = 'mt-1 block w-full rounded-md border-border shadow-sm focus:border-info focus:ring-info sm:text-sm';

/** `status === 'published' ? 'منشورة' : 'مجدولة لـ <formatted publishDate>'`. */
function statusLabel(article: ArticleListItem): string {
  if (article.status === 'published') return 'منشورة';
  const formatted = new Date(article.publishDate).toLocaleString('ar');
  return `مجدولة لـ ${formatted}`;
}

/**
 * Converts the datetime-local input's naive local value into a real
 * offset-aware ISO string via `new Date(value).toISOString()` -- the local
 * string itself must never be sent as-is. An empty field (left blank by the
 * author) falls back to "now" rather than throwing on `new Date('')`.
 */
function publishDateToIso(localValue: string): string {
  if (!localValue) return new Date().toISOString();
  return new Date(localValue).toISOString();
}

/** Inverse of the above, used to prefill the datetime-local input when editing. */
function isoToLocalInputValue(iso: string | undefined | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Pulls the server's `{ error: string }` body off a failed response (the
 * shape every `src/server/blogAdmin.ts` handler uses for 400/404/409/502),
 * falling back to `fallback` when the body isn't JSON or has no `error`.
 */
async function extractErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    return typeof data?.error === 'string' && data.error ? data.error : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Every call to the admin blog API must carry the current session's bearer
 * token, or `authenticate` (src/server/middleware/authMiddleware.ts) 401s it
 * in real use -- same pattern as SaaSTeamManagement.tsx's own fetch calls.
 */
async function getAuthHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${session?.access_token || ''}` };
}

export default function AdminBlogEditor(): React.JSX.Element {
  const [articles, setArticles] = useState<ArticleListItem[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [mode, setMode] = useState<'list' | 'form'>('list');
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [form, setForm] = useState<ArticleFormState>(EMPTY_FORM);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [confirmingDeleteSlug, setConfirmingDeleteSlug] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // Same toast shape/lifecycle as the existing admin-screen pattern (see
  // AdminTailors.tsx's `toast`/`showToast`): a dismissible banner that
  // auto-clears after 3s, reused here instead of inventing a new mechanism.
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const showToast = useCallback((message: string, type: 'success' | 'error' = 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const loadArticles = useCallback(async () => {
    setIsLoadingList(true);
    try {
      const authHeader = await getAuthHeader();
      const res = await fetch('/api/admin/blog/articles', { headers: authHeader });
      if (!res.ok) {
        showToast(await extractErrorMessage(res, 'تعذر تحميل قائمة المقالات'));
        return;
      }
      const data = await res.json();
      setArticles(data.articles ?? []);
    } catch {
      showToast('تعذر تحميل قائمة المقالات');
    } finally {
      setIsLoadingList(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadArticles();
  }, [loadArticles]);

  const openCreateForm = () => {
    setEditingSlug(null);
    setForm(EMPTY_FORM);
    setPreviewHtml(null);
    setMode('form');
  };

  const openEditForm = async (slug: string) => {
    try {
      const authHeader = await getAuthHeader();
      const res = await fetch(`/api/admin/blog/articles/${slug}`, { headers: authHeader });
      if (!res.ok) {
        // Never open a blank form on a failed fetch (e.g. 404 if the file
        // was deleted elsewhere in the meantime) -- stay on the list.
        showToast(await extractErrorMessage(res, 'تعذر تحميل المقالة'));
        return;
      }
      const data = await res.json();
      setEditingSlug(slug);
      setForm({
        title: data.title ?? '',
        metaDescription: data.metaDescription ?? '',
        cluster: data.cluster ?? (CATEGORIES[0]?.slug ?? ''),
        publishDateLocal: isoToLocalInputValue(data.publishDate),
        related: data.related ?? [],
        body: data.body ?? '',
      });
      setPreviewHtml(null);
      setMode('form');
    } catch {
      showToast('تعذر تحميل المقالة');
    }
  };

  const currentPayload = () => ({
    title: form.title,
    metaDescription: form.metaDescription,
    cluster: form.cluster,
    publishDate: publishDateToIso(form.publishDateLocal),
    related: form.related,
    body: form.body,
  });

  const handlePreview = async () => {
    try {
      const authHeader = await getAuthHeader();
      const res = await fetch('/api/admin/blog/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify(currentPayload()),
      });
      if (!res.ok) {
        showToast(await extractErrorMessage(res, 'تعذر إنشاء المعاينة'));
        return;
      }
      const data = await res.json();
      setPreviewHtml(data.html ?? '');
    } catch {
      showToast('تعذر إنشاء المعاينة');
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const url = editingSlug ? `/api/admin/blog/articles/${editingSlug}` : '/api/admin/blog/articles';
      const method = editingSlug ? 'PUT' : 'POST';
      const authHeader = await getAuthHeader();
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify(currentPayload()),
      });
      if (!res.ok) {
        // A failed save (400 invalid frontmatter, 409 slug collision, 502
        // GitHub failure, ...) must never look like a successful one: stay
        // on the form with the author's input intact, don't refresh the
        // list, don't clear anything.
        if (res.status === 409) {
          const data = await res.json().catch(() => ({} as any));
          const existingTitle = typeof data?.existingTitle === 'string' ? data.existingTitle : '';
          showToast(`الاسم مستخدم من قبل: ${existingTitle}`);
        } else {
          showToast(await extractErrorMessage(res, 'تعذر حفظ المقالة'));
        }
        return;
      }

      // Decide "نُشرت الآن" vs "مجدولة لـ ..." from the submitted publish
      // date BEFORE resetting the form -- a scheduled (future) date must say
      // so explicitly rather than implying the article is live right now.
      const publishIso = publishDateToIso(form.publishDateLocal);
      const successMessage =
        new Date(publishIso) > new Date()
          ? `مجدولة لـ ${new Date(publishIso).toLocaleString('ar')}`
          : 'نُشرت الآن';

      await loadArticles();
      setMode('list');
      setEditingSlug(null);
      setForm(EMPTY_FORM);
      setPreviewHtml(null);
      showToast(successMessage, 'success');
    } catch {
      showToast('تعذر حفظ المقالة');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (slug: string) => {
    try {
      const authHeader = await getAuthHeader();
      const res = await fetch(`/api/admin/blog/articles/${slug}`, { method: 'DELETE', headers: authHeader });
      if (!res.ok) {
        // Keep the confirmation open on failure -- the article is still
        // there, so silently closing the dialog would be misleading.
        showToast(await extractErrorMessage(res, 'تعذر حذف المقالة'));
        return;
      }
      setConfirmingDeleteSlug(null);
      await loadArticles();
    } catch {
      showToast('تعذر حذف المقالة');
    }
  };

  const handleRelatedChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = Array.from(e.target.selectedOptions).map(o => o.value);
    setForm(f => ({ ...f, related: selected }));
  };

  const toastBanner = toast && (
    <div role="alert">
      {toast.type === 'success' ? <CheckCircle size={16} /> : <XCircle size={16} />}
      {toast.message}
    </div>
  );

  if (mode === 'form') {
    return (
      <div>
        {toastBanner}
        <h1>{editingSlug ? 'تعديل مقالة' : 'مقالة جديدة'}</h1>

        <Card>
          <label htmlFor="admin-blog-title">العنوان</label>
          <input
            id="admin-blog-title"
            className={FIELD_CLASS}
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
          />

          <label htmlFor="admin-blog-meta">الوصف التعريفي</label>
          <textarea
            id="admin-blog-meta"
            className={FIELD_CLASS}
            rows={3}
            value={form.metaDescription}
            onChange={e => setForm(f => ({ ...f, metaDescription: e.target.value }))}
          />

          <label htmlFor="admin-blog-cluster">التصنيف</label>
          <select
            id="admin-blog-cluster"
            className={FIELD_CLASS}
            value={form.cluster}
            onChange={e => setForm(f => ({ ...f, cluster: e.target.value }))}
          >
            {CATEGORIES.map(category => (
              <option key={category.slug} value={category.slug}>{category.label}</option>
            ))}
          </select>

          <label htmlFor="admin-blog-publish-date">تاريخ النشر</label>
          <input
            id="admin-blog-publish-date"
            type="datetime-local"
            className={FIELD_CLASS}
            value={form.publishDateLocal}
            onChange={e => setForm(f => ({ ...f, publishDateLocal: e.target.value }))}
          />

          <label htmlFor="admin-blog-related">مقالات ذات صلة</label>
          <select
            id="admin-blog-related"
            multiple
            className={FIELD_CLASS}
            value={form.related}
            onChange={handleRelatedChange}
          >
            {articles.filter(a => a.slug !== editingSlug).map(a => (
              <option key={a.slug} value={a.slug}>{a.title}</option>
            ))}
          </select>

          <label htmlFor="admin-blog-body">المحتوى</label>
          <textarea
            id="admin-blog-body"
            className={FIELD_CLASS}
            rows={20}
            value={form.body}
            onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
          />

          <div>
            <Button type="button" variant="secondary" onClick={handlePreview}>معاينة</Button>
            <Button type="button" variant="primary" loading={isSaving} onClick={handleSave} disabled={isSaving}>
              {editingSlug ? 'حفظ التعديلات' : 'حفظ المقالة'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setMode('list')}>إلغاء</Button>
          </div>

          {previewHtml !== null && (
            <iframe title="معاينة المقالة" srcDoc={previewHtml} className="w-full h-[70vh]" />
          )}
        </Card>
      </div>
    );
  }

  return (
    <div>
      {toastBanner}
      <h1>إدارة المقالات</h1>
      {/* Hidden while any row's delete confirmation is open: otherwise this
          button's own text ("مقالة جديدة") can collide with the confirmation
          naming an article whose title is itself just "مقالة", and it keeps
          the admin from navigating away mid-confirmation either way. */}
      {confirmingDeleteSlug === null && (
        <Button type="button" variant="primary" onClick={openCreateForm}>مقالة جديدة</Button>
      )}
      <Card>
        {isLoadingList ? (
          <p>...جارٍ التحميل</p>
        ) : (
          <table>
            <tbody>
              {articles.map(article => (
                <tr key={article.slug}>
                  {confirmingDeleteSlug === article.slug ? (
                    <td colSpan={4}>
                      <strong>تأكيد الحذف</strong>
                      <p>{`هل تريد حذف "${article.title}"؟ قد تشير إليها مقالات أخرى.`}</p>
                      <Button type="button" variant="danger" onClick={() => handleDelete(article.slug)}>نعم، حذف</Button>
                      <Button type="button" variant="ghost" onClick={() => setConfirmingDeleteSlug(null)}>إلغاء</Button>
                    </td>
                  ) : (
                    <>
                      <td>{article.title}</td>
                      <td>{statusLabel(article)}</td>
                      <td>
                        <Button type="button" variant="secondary" size="sm" onClick={() => openEditForm(article.slug)}>تعديل</Button>
                      </td>
                      <td>
                        <Button type="button" variant="danger" size="sm" onClick={() => setConfirmingDeleteSlug(article.slug)}>حذف</Button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
