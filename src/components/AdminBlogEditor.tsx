/**
 * Admin screen for the GitHub-backed blog: list, create, edit, preview and
 * delete articles. Talks directly to the Task 7 server routes
 * (`/api/admin/blog/articles[/:slug]`, `/api/admin/blog/preview`) with plain
 * `fetch` -- no dedicated data-fetching library, per the plan.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle, XCircle, FileText, Pencil, Trash2, Plus, Clock, BadgeCheck } from 'lucide-react';
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

  const toastBanner = (
    <AnimatePresence>
      {toast && (
        <motion.div
          role="alert"
          initial={{ opacity: 0, y: 50, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
          className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 font-bold text-sm min-w-[300px] justify-center text-white ${toast.type === 'success' ? 'bg-success' : 'bg-danger'}`}
        >
          {toast.type === 'success' ? <CheckCircle size={20} /> : <XCircle size={20} />}
          {toast.message}
        </motion.div>
      )}
    </AnimatePresence>
  );

  if (mode === 'form') {
    return (
      <div className="space-y-10">
        {toastBanner}
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div>
            <h2 className="text-3xl font-black text-content flex items-center gap-3">
              <Pencil className="text-brand" size={32} />
              {editingSlug ? 'تعديل مقالة' : 'مقالة جديدة'}
            </h2>
            <p className="text-content-muted font-bold text-sm mt-1">
              {editingSlug ? 'عدّل الحقول ثم احفظ التعديلات' : 'عبّئ الحقول واحفظ لنشرها أو جدولتها'}
            </p>
          </div>
        </header>

        <Card className="rounded-3xl p-8 space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="md:col-span-2">
              <label htmlFor="admin-blog-title" className="block text-sm font-bold text-content-muted mb-1.5">العنوان</label>
              <input
                id="admin-blog-title"
                className={FIELD_CLASS}
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              />
            </div>

            <div className="md:col-span-2">
              <label htmlFor="admin-blog-meta" className="block text-sm font-bold text-content-muted mb-1.5">الوصف التعريفي</label>
              <textarea
                id="admin-blog-meta"
                className={FIELD_CLASS}
                rows={3}
                value={form.metaDescription}
                onChange={e => setForm(f => ({ ...f, metaDescription: e.target.value }))}
              />
            </div>

            <div>
              <label htmlFor="admin-blog-cluster" className="block text-sm font-bold text-content-muted mb-1.5">التصنيف</label>
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
            </div>

            <div>
              <label htmlFor="admin-blog-publish-date" className="block text-sm font-bold text-content-muted mb-1.5">تاريخ النشر</label>
              <input
                id="admin-blog-publish-date"
                type="datetime-local"
                className={FIELD_CLASS}
                value={form.publishDateLocal}
                onChange={e => setForm(f => ({ ...f, publishDateLocal: e.target.value }))}
              />
            </div>

            <div className="md:col-span-2">
              <label htmlFor="admin-blog-related" className="block text-sm font-bold text-content-muted mb-1.5">مقالات ذات صلة</label>
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
            </div>

            <div className="md:col-span-2">
              <label htmlFor="admin-blog-body" className="block text-sm font-bold text-content-muted mb-1.5">المحتوى (Markdown)</label>
              <textarea
                id="admin-blog-body"
                className={`${FIELD_CLASS} font-mono text-sm`}
                rows={20}
                value={form.body}
                onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
              />
            </div>
          </div>

          <div className="flex items-center gap-3 border-t border-border pt-6">
            <Button type="button" variant="secondary" onClick={handlePreview}>معاينة</Button>
            <Button type="button" variant="primary" loading={isSaving} onClick={handleSave} disabled={isSaving}>
              {editingSlug ? 'حفظ التعديلات' : 'حفظ المقالة'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setMode('list')}>إلغاء</Button>
          </div>

          {previewHtml !== null && (
            <div className="space-y-2">
              <p className="text-sm font-bold text-content-muted">معاينة</p>
              <div className="rounded-2xl border border-border overflow-hidden">
                <iframe title="معاينة المقالة" srcDoc={previewHtml} className="w-full h-[70vh]" />
              </div>
            </div>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {toastBanner}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <h2 className="text-3xl font-black text-content flex items-center gap-3">
            <FileText className="text-brand" size={32} />
            إدارة المقالات
          </h2>
          <p className="text-content-muted font-bold text-sm mt-1">مدونة سين — إنشاء وتعديل وجدولة المقالات</p>
        </div>
        {/* Hidden while any row's delete confirmation is open: otherwise this
            button's own text ("مقالة جديدة") can collide with the confirmation
            naming an article whose title is itself just "مقالة", and it keeps
            the admin from navigating away mid-confirmation either way. */}
        {confirmingDeleteSlug === null && (
          <Button type="button" variant="primary" onClick={openCreateForm}>
            <Plus size={18} />
            مقالة جديدة
          </Button>
        )}
      </header>

      <div className="bg-surface rounded-3xl border border-border shadow-sm overflow-hidden">
        {isLoadingList ? (
          <div className="p-12 text-center text-sm text-content-muted font-bold">...جارٍ التحميل</div>
        ) : articles.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <FileText className="mx-auto text-content-muted/40" size={40} />
            <p className="text-sm text-content-muted font-bold">لا توجد مقالات بعد</p>
            <Button type="button" variant="secondary" size="sm" onClick={openCreateForm}>
              <Plus size={16} />
              أنشئ أول مقالة
            </Button>
          </div>
        ) : (
          <table className="w-full text-right">
            <thead className="bg-surface-muted text-content-muted text-[10px] font-black uppercase tracking-widest border-b border-border">
              <tr>
                <th className="px-8 py-5">العنوان</th>
                <th className="px-8 py-5">الحالة</th>
                <th className="px-8 py-5 text-left">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {articles.map(article => (
                <tr key={article.slug} className="hover:bg-surface-muted/30 transition-all">
                  {confirmingDeleteSlug === article.slug ? (
                    <td colSpan={3} className="px-8 py-6">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-black text-content text-sm">تأكيد الحذف</p>
                          <p className="text-xs text-content-muted mt-0.5 font-bold">{`هل تريد حذف "${article.title}"؟ قد تشير إليها مقالات أخرى.`}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Button type="button" variant="danger" size="sm" onClick={() => handleDelete(article.slug)}>نعم، حذف</Button>
                          <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmingDeleteSlug(null)}>إلغاء</Button>
                        </div>
                      </div>
                    </td>
                  ) : (
                    <>
                      <td className="px-8 py-6 font-black text-content">{article.title}</td>
                      <td className="px-8 py-6">
                        {article.status === 'published' ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase bg-success/10 text-success border border-success/20">
                            <BadgeCheck size={12} />
                            {statusLabel(article)}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase bg-warning/10 text-warning border border-warning/20">
                            <Clock size={12} />
                            {statusLabel(article)}
                          </span>
                        )}
                      </td>
                      <td className="px-8 py-6">
                        <div className="flex items-center justify-start gap-2">
                          <button
                            type="button"
                            onClick={() => openEditForm(article.slug)}
                            className="p-2 text-content-muted hover:text-brand hover:bg-brand/5 rounded-xl transition-all"
                            title="تعديل"
                          >
                            <Pencil size={18} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmingDeleteSlug(article.slug)}
                            className="p-2 text-danger hover:bg-danger/5 rounded-xl transition-all"
                            title="حذف"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
