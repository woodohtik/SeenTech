import React, { useEffect, useState, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FileText, Calendar, ChevronLeft, ChevronRight, Loader2, AlertCircle } from 'lucide-react';
import { useDirection, localeOf } from '../lib/direction';
import { BlogPost, listPublishedPosts } from '../services/blogService';

const PAGE_SIZE = 10;

/** صفحة عامة (بلا مصادقة) تسرد تدوينات المدونة المنشورة فقط -- /blog */
export default function BlogList() {
  const { t, dir, locale } = useDirection();
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);

  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const { posts: data, total: count } = await listPublishedPosts(page, PAGE_SIZE);
      setPosts(data);
      setTotal(count);
    } catch (err) {
      console.error('Error loading published blog posts:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const goToPage = (p: number) => setSearchParams(p > 1 ? { page: String(p) } : {});

  return (
    <div className="min-h-screen bg-surface-muted py-10 px-4 font-sans" dir={dir}>
      <div className="max-w-3xl mx-auto">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-black text-content flex items-center justify-center gap-3">
            <FileText className="text-brand" size={32} />
            {t('blog.title', 'المدونة')}
          </h1>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-content-muted">
            <Loader2 className="animate-spin w-8 h-8 mb-3 text-brand" />
            <p>{t('blog.loading', 'جاري تحميل المقالات...')}</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-20 text-content-muted text-center">
            <AlertCircle className="w-8 h-8 mb-3 text-danger" />
            <p>{t('blog.load_failed', 'تعذّر تحميل المقالات، يرجى المحاولة لاحقاً')}</p>
          </div>
        ) : posts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-content-muted text-center">
            <FileText className="w-8 h-8 mb-3" />
            <p>{t('blog.no_posts', 'لا توجد مقالات منشورة بعد')}</p>
          </div>
        ) : (
          <div className="space-y-5">
            {posts.map((post) => (
              <Link
                key={post.id}
                to={`/blog/${post.slug}`}
                className="block bg-surface rounded-2xl border border-border shadow-sm overflow-hidden hover:shadow-md transition-shadow"
              >
                <div className="flex flex-col sm:flex-row">
                  {post.coverImageUrl && (
                    <div className="sm:w-48 shrink-0">
                      <img
                        src={post.coverImageUrl}
                        alt={post.title}
                        className="w-full h-40 sm:h-full object-cover"
                      />
                    </div>
                  )}
                  <div className="p-6 flex-1 min-w-0">
                    <h2 className="text-xl font-black text-content mb-2">{post.title}</h2>
                    {post.excerpt && (
                      <p className="text-content-muted text-sm mb-3 line-clamp-3">{post.excerpt}</p>
                    )}
                    {post.publishedAt && (
                      <div className="flex items-center gap-1.5 text-xs text-content-muted font-medium">
                        <Calendar size={14} />
                        <span>{new Date(post.publishedAt).toLocaleDateString(locale)}</span>
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {!loading && !error && totalPages > 1 && (
          <div className="flex items-center justify-center gap-4 mt-10">
            <button
              onClick={() => goToPage(page - 1)}
              disabled={page <= 1}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-surface border border-border text-content font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-surface-muted transition-colors cursor-pointer"
            >
              {dir === 'rtl' ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
              {t('blog.prev', 'السابق')}
            </button>
            <span className="text-sm text-content-muted font-medium">
              {t('blog.page_of', { current: page, total: totalPages, defaultValue: `${page} / ${totalPages}` })}
            </span>
            <button
              onClick={() => goToPage(page + 1)}
              disabled={page >= totalPages}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-surface border border-border text-content font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-surface-muted transition-colors cursor-pointer"
            >
              {t('blog.next', 'التالي')}
              {dir === 'rtl' ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
