import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import imageCompression from 'browser-image-compression';
import {
  FileText,
  Plus,
  Edit,
  Trash2,
  Search,
  Clock,
  CheckCircle2,
  Upload,
  X,
  Loader2,
  Image as ImageIcon,
  Type,
  Link as LinkIcon,
} from 'lucide-react';
import { IconInput } from './ui/IconInput';
import { SmartSelect } from './ui/SmartSelect';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { useTranslation } from 'react-i18next';
import { isRtlLang, localeOf } from '../lib/direction';
import { cn } from '../lib/utils';
import { slugify } from '../utils/slugify';
import { uploadImageToSupabase } from '../lib/supabase/storage';
import { isAllowedImageFile } from '../lib/imageValidation';
import {
  BlogPost,
  listAllPostsForAdmin,
  createPost,
  updatePost,
  deletePost,
  DuplicateSlugError,
} from '../services/blogService';

interface FormState {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  coverImageUrl: string | null;
  metaTitle: string;
  metaDescription: string;
  status: 'draft' | 'published';
}

const emptyForm: FormState = {
  title: '',
  slug: '',
  excerpt: '',
  content: '',
  coverImageUrl: null,
  metaTitle: '',
  metaDescription: '',
  status: 'draft',
};

export default function AdminBlog() {
  const { t, i18n } = useTranslation();
  const isRtl = isRtlLang(i18n.language);
  const { success, error: toastError } = useToast();
  const { confirm } = useConfirm();

  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingPost, setEditingPost] = useState<BlogPost | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState<FormState>(emptyForm);
  // Tracks whether the user has hand-edited the slug field -- while false,
  // the slug keeps auto-filling from slugify(title) as the user types.
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugError, setSlugError] = useState(false);

  const [isUploadingCover, setIsUploadingCover] = useState(false);
  const [coverUploadError, setCoverUploadError] = useState<string | null>(null);

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listAllPostsForAdmin();
      setPosts(data);
    } catch (err) {
      console.error('Error loading blog posts:', err);
      toastError(t('blog_admin.load_failed', 'تعذّر تحميل التدوينات'));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  const handleOpenModal = (post?: BlogPost) => {
    setSlugError(false);
    setCoverUploadError(null);
    if (post) {
      setEditingPost(post);
      setFormData({
        title: post.title,
        slug: post.slug,
        excerpt: post.excerpt,
        content: post.content,
        coverImageUrl: post.coverImageUrl,
        metaTitle: post.metaTitle || '',
        metaDescription: post.metaDescription || '',
        status: post.status,
      });
      // Editing an existing post -- its slug is already set and must never
      // be silently overwritten by further title edits.
      setSlugTouched(true);
    } else {
      setEditingPost(null);
      setFormData(emptyForm);
      setSlugTouched(false);
    }
    setIsModalOpen(true);
  };

  const handleTitleChange = (value: string) => {
    setFormData((prev) => ({
      ...prev,
      title: value,
      slug: slugTouched ? prev.slug : slugify(value),
    }));
  };

  const handleSlugChange = (value: string) => {
    setSlugTouched(true);
    setSlugError(false);
    setFormData((prev) => ({ ...prev, slug: value }));
  };

  const handleCoverFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/') || !(await isAllowedImageFile(file))) {
      setCoverUploadError(t('blog_admin.invalid_image', 'يرجى اختيار ملف صورة صالح'));
      return;
    }

    try {
      setIsUploadingCover(true);
      setCoverUploadError(null);

      const compressedFile = await imageCompression(file, {
        maxSizeMB: 0.3,
        maxWidthOrHeight: 1200,
        useWebWorker: true,
      });

      const publicUrl = await uploadImageToSupabase(compressedFile, 'blog');
      setFormData((prev) => ({ ...prev, coverImageUrl: publicUrl }));
    } catch (err) {
      console.error('Cover image upload error:', err);
      setCoverUploadError(t('blog_admin.cover_upload_failed', 'تعذّر رفع صورة الغلاف'));
    } finally {
      setIsUploadingCover(false);
    }
  };

  const clearCoverImage = () => {
    setFormData((prev) => ({ ...prev, coverImageUrl: null }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSlugError(false);

    if (!formData.title.trim() || !formData.slug.trim()) {
      toastError(t('blog_admin.title_slug_required', 'العنوان والرابط المختصر مطلوبان'));
      return;
    }

    setIsSubmitting(true);
    try {
      if (editingPost) {
        const patch: Partial<Omit<BlogPost, 'id' | 'createdAt'>> = {
          title: formData.title,
          slug: formData.slug,
          excerpt: formData.excerpt,
          content: formData.content,
          coverImageUrl: formData.coverImageUrl,
          metaTitle: formData.metaTitle || null,
          metaDescription: formData.metaDescription || null,
          status: formData.status,
        };
        // Only stamp publishedAt the first time a post goes live -- never
        // overwrite an already-published post's original publish date.
        if (formData.status === 'published' && !editingPost.publishedAt) {
          patch.publishedAt = new Date().toISOString();
        }
        await updatePost(editingPost.id, patch);
        success(t('blog_admin.update_success', 'تم تحديث التدوينة بنجاح'));
      } else {
        await createPost({
          title: formData.title,
          slug: formData.slug,
          excerpt: formData.excerpt,
          content: formData.content,
          coverImageUrl: formData.coverImageUrl,
          metaTitle: formData.metaTitle || null,
          metaDescription: formData.metaDescription || null,
          status: formData.status,
          publishedAt: formData.status === 'published' ? new Date().toISOString() : null,
        });
        success(t('blog_admin.create_success', 'تمت إضافة التدوينة بنجاح'));
      }

      setIsModalOpen(false);
      fetchPosts();
    } catch (err) {
      if (err instanceof DuplicateSlugError) {
        setSlugError(true);
        toastError(t('blog_admin.duplicate_slug', 'هذا الرابط المختصر مستخدم في تدوينة أخرى، يرجى اختيار رابط آخر'));
      } else {
        console.error('Error saving blog post:', err);
        toastError(t('blog_admin.save_failed', 'حدث خطأ أثناء حفظ التدوينة'));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (post: BlogPost) => {
    const ok = await confirm({
      title: t('blog_admin.delete_confirm_title', 'حذف التدوينة'),
      description: t('blog_admin.delete_confirm_desc', {
        title: post.title,
        defaultValue: `سيتم حذف "${post.title}" نهائياً. هل تريد المتابعة؟`,
      }),
      confirmLabel: t('common.delete', 'حذف'),
      danger: true,
    });
    if (!ok) return;

    setDeletingId(post.id);
    try {
      await deletePost(post.id);
      setPosts((prev) => prev.filter((p) => p.id !== post.id));
      success(t('blog_admin.delete_success', 'تم حذف التدوينة بنجاح'));
    } catch (err) {
      console.error('Error deleting blog post:', err);
      toastError(t('blog_admin.delete_failed', 'تعذّر حذف التدوينة'));
    } finally {
      setDeletingId(null);
    }
  };

  const filteredPosts = posts.filter(
    (p) =>
      p.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.slug.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black text-content flex items-center gap-3">
            <FileText className="text-brand" size={32} />
            {t('blog_admin.title', 'إدارة التدوينات')}
          </h1>
          <p className="text-content-muted mt-1">
            {t('blog_admin.subtitle', 'إنشاء وتحرير ونشر مقالات المدونة العامة')}
          </p>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="flex-1 md:w-64">
            <IconInput
              startIcon={Search}
              placeholder={t('blog_admin.search_placeholder', 'ابحث بالعنوان أو الرابط...')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button
            onClick={() => handleOpenModal()}
            className="bg-brand text-white px-6 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-brand/90 transition-all shadow-lg shadow-brand/20 whitespace-nowrap cursor-pointer"
          >
            <Plus size={20} />
            <span>{t('blog_admin.new_post_btn', 'مقال جديد')}</span>
          </button>
        </div>
      </div>

      {/* List */}
      <div className="bg-surface rounded-2xl p-6 shadow-sm border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-start rtl:text-right ltr:text-left">
            <thead>
              <tr className="border-b border-border">
                <th className="px-6 py-4 text-start rtl:text-right ltr:text-left text-xs font-black text-content-muted uppercase tracking-wider">
                  {t('blog_admin.col_title', 'العنوان')}
                </th>
                <th className="px-6 py-4 text-start rtl:text-right ltr:text-left text-xs font-black text-content-muted uppercase tracking-wider">
                  {t('common.status', 'الحالة')}
                </th>
                <th className="px-6 py-4 text-start rtl:text-right ltr:text-left text-xs font-black text-content-muted uppercase tracking-wider">
                  {t('blog_admin.col_updated_at', 'آخر تحديث')}
                </th>
                <th className="px-6 py-4 text-end rtl:text-left ltr:text-right text-xs font-black text-content-muted uppercase tracking-wider">
                  {t('common.actions', 'إجراءات')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={4} className="py-12 text-center text-content-muted">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand mx-auto mb-4"></div>
                    {t('blog_admin.loading', 'جاري تحميل التدوينات...')}
                  </td>
                </tr>
              ) : filteredPosts.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-12 text-center text-content-muted font-bold">
                    {t('blog_admin.no_posts', 'لا توجد تدوينات بعد')}
                  </td>
                </tr>
              ) : (
                filteredPosts.map((post) => (
                  <tr key={post.id} className="hover:bg-surface-muted/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        {post.coverImageUrl ? (
                          <img
                            src={post.coverImageUrl}
                            alt=""
                            className="w-10 h-10 rounded-xl object-cover shrink-0 border border-border"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-xl bg-brand/10 text-brand flex items-center justify-center shrink-0">
                            <FileText size={18} />
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="font-bold text-content truncate">{post.title}</p>
                          <p className="text-xs text-content-muted truncate" dir="ltr">
                            /{post.slug}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {post.status === 'published' ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-success/10 text-success">
                          <CheckCircle2 size={14} />
                          {t('blog_admin.status_published', 'منشور')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-warning/10 text-warning">
                          <Edit size={14} />
                          {t('blog_admin.status_draft', 'مسودة')}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-content-muted font-medium">
                      <div className="flex items-center gap-1.5">
                        <Clock size={14} />
                        <span>
                          {new Date(post.updatedAt).toLocaleDateString(localeOf(i18n.language))}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-end rtl:text-left ltr:text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleOpenModal(post)}
                          className="p-2 text-content-muted hover:text-brand hover:bg-brand/10 rounded-xl transition-all cursor-pointer"
                          title={t('common.edit', 'تعديل')}
                        >
                          <Edit size={18} />
                        </button>
                        <button
                          onClick={() => handleDelete(post)}
                          disabled={deletingId === post.id}
                          className="p-2 text-content-muted hover:text-danger hover:bg-danger/10 rounded-xl transition-all cursor-pointer disabled:opacity-50"
                          title={t('common.delete', 'حذف')}
                        >
                          {deletingId === post.id ? (
                            <Loader2 size={18} className="animate-spin" />
                          ) : (
                            <Trash2 size={18} />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => !isSubmitting && setIsModalOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-surface w-full max-w-2xl rounded-3xl shadow-2xl relative z-10 border border-border p-8 max-h-[90vh] overflow-y-auto"
            >
              <h2 className="text-2xl font-black text-content mb-6">
                {editingPost ? t('blog_admin.edit_post', 'تعديل التدوينة') : t('blog_admin.add_post', 'إضافة تدوينة جديدة')}
              </h2>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-content-muted">{t('blog_admin.field_title', 'العنوان')}</label>
                  <IconInput
                    startIcon={Type}
                    value={formData.title}
                    onChange={(e) => handleTitleChange(e.target.value)}
                    placeholder={t('blog_admin.field_title_placeholder', 'عنوان المقال')}
                    required
                    className="bg-surface-muted"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-content-muted">{t('blog_admin.field_slug', 'الرابط المختصر')}</label>
                  <IconInput
                    startIcon={LinkIcon}
                    value={formData.slug}
                    onChange={(e) => handleSlugChange(e.target.value)}
                    placeholder="my-post-slug"
                    required
                    dir="ltr"
                    error={slugError ? t('blog_admin.duplicate_slug', 'هذا الرابط المختصر مستخدم في تدوينة أخرى، يرجى اختيار رابط آخر') : undefined}
                    className="bg-surface-muted"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-content-muted">{t('blog_admin.field_excerpt', 'مقتطف مختصر')}</label>
                  <textarea
                    value={formData.excerpt}
                    onChange={(e) => setFormData((prev) => ({ ...prev, excerpt: e.target.value }))}
                    placeholder={t('blog_admin.field_excerpt_placeholder', 'ملخص قصير يظهر في قائمة التدوينات')}
                    rows={2}
                    className="w-full px-4 py-3 bg-surface-muted border border-border rounded-xl outline-none transition-all focus:ring-2 focus:ring-brand/20 focus:border-brand font-semibold text-content text-sm resize-none"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-content-muted">{t('blog_admin.field_content', 'المحتوى')}</label>
                  <textarea
                    value={formData.content}
                    onChange={(e) => setFormData((prev) => ({ ...prev, content: e.target.value }))}
                    placeholder={t('blog_admin.field_content_placeholder', 'نص المقال الكامل (يدعم تنسيق Markdown)')}
                    rows={10}
                    className="w-full px-4 py-3 bg-surface-muted border border-border rounded-xl outline-none transition-all focus:ring-2 focus:ring-brand/20 focus:border-brand font-semibold text-content text-sm resize-y"
                  />
                </div>

                {/* Cover image */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-content-muted">{t('blog_admin.field_cover_image', 'صورة الغلاف')}</label>
                  <div
                    className={cn(
                      'relative group cursor-pointer border-2 border-dashed rounded-2xl transition-all duration-300 flex flex-col items-center justify-center min-h-[140px] p-4 bg-surface-muted',
                      formData.coverImageUrl ? 'border-brand/30' : 'border-border hover:border-brand/50 hover:bg-brand/5'
                    )}
                    onClick={() => document.getElementById('blog-cover-upload-input')?.click()}
                  >
                    <input
                      id="blog-cover-upload-input"
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleCoverFileChange}
                      disabled={isUploadingCover}
                    />

                    {formData.coverImageUrl ? (
                      <div className="relative w-full h-full flex items-center justify-center">
                        <img
                          src={formData.coverImageUrl}
                          alt={t('blog_admin.field_cover_image', 'صورة الغلاف')}
                          className="max-h-[120px] rounded-xl object-contain shadow-sm"
                        />
                        {!isUploadingCover && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              clearCoverImage();
                            }}
                            className="absolute -top-2 -end-2 p-1.5 bg-danger text-white rounded-full shadow-lg hover:scale-110 transition-transform z-10"
                          >
                            <X size={16} />
                          </button>
                        )}
                        {isUploadingCover && (
                          <div className="absolute inset-0 bg-surface/60 backdrop-blur-[2px] rounded-xl flex items-center justify-center">
                            <Loader2 className="w-8 h-8 text-brand animate-spin" />
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-center">
                        <div className="w-12 h-12 bg-surface rounded-2xl shadow-sm flex items-center justify-center mx-auto mb-3 text-content-muted">
                          {isUploadingCover ? <Loader2 className="animate-spin text-brand" /> : <Upload size={24} />}
                        </div>
                        <p className="text-sm font-bold text-content">
                          {t('blog_admin.cover_drag_drop', 'اسحب صورة أو اضغط للاختيار')}
                        </p>
                      </div>
                    )}

                    {coverUploadError && (
                      <p className="text-xs text-danger font-bold mt-2">{coverUploadError}</p>
                    )}
                  </div>
                  <p className="text-[10px] text-content-muted flex items-center gap-1">
                    <ImageIcon size={10} />
                    {t('blog_admin.cover_supported_formats', 'JPG، PNG أو WebP')}
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-content-muted">
                    {t('blog_admin.field_meta_title', 'عنوان SEO (اختياري)')}
                  </label>
                  <IconInput
                    startIcon={Type}
                    value={formData.metaTitle}
                    onChange={(e) => setFormData((prev) => ({ ...prev, metaTitle: e.target.value }))}
                    placeholder={t('blog_admin.field_meta_title_placeholder', 'عنوان مخصّص لمحركات البحث')}
                    className="bg-surface-muted"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-content-muted">
                    {t('blog_admin.field_meta_description', 'وصف SEO (اختياري)')}
                  </label>
                  <textarea
                    value={formData.metaDescription}
                    onChange={(e) => setFormData((prev) => ({ ...prev, metaDescription: e.target.value }))}
                    placeholder={t('blog_admin.field_meta_description_placeholder', 'وصف مخصّص يظهر في نتائج البحث')}
                    rows={2}
                    className="w-full px-4 py-3 bg-surface-muted border border-border rounded-xl outline-none transition-all focus:ring-2 focus:ring-brand/20 focus:border-brand font-semibold text-content text-sm resize-none"
                  />
                </div>

                <div className="pt-4 border-t border-border space-y-2">
                  <label className="text-xs font-bold text-content-muted">{t('common.status', 'الحالة')}</label>
                  <SmartSelect
                    value={formData.status}
                    onChange={(v) => setFormData((prev) => ({ ...prev, status: v as 'draft' | 'published' }))}
                    options={[
                      { value: 'draft', label: t('blog_admin.status_draft', 'مسودة') },
                      { value: 'published', label: t('blog_admin.status_published', 'منشور') },
                    ]}
                  />
                </div>

                <div className="flex gap-3 pt-6 mt-6">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    disabled={isSubmitting}
                    className="flex-1 py-3 bg-surface-muted text-content font-bold rounded-2xl hover:bg-border transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {t('common.cancel', 'إلغاء')}
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting || isUploadingCover}
                    className="flex-1 py-3 bg-brand text-white font-bold rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-brand/20 hover:bg-brand/90 transition-all disabled:opacity-50 cursor-pointer"
                  >
                    {isSubmitting ? (
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    ) : editingPost ? (
                      t('common.save_changes', 'حفظ التعديلات')
                    ) : (
                      t('blog_admin.new_post_btn', 'مقال جديد')
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
