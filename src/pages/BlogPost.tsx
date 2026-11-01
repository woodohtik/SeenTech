import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Calendar, Loader2, FileX } from 'lucide-react';
import { useDirection, localeOf } from '../lib/direction';
import { BlogPost as BlogPostType, getPublishedPostBySlug } from '../services/blogService';
import { renderMarkdown } from '../utils/renderMarkdown';

/** صفحة عامة (بلا مصادقة) تعرض تدوينة واحدة منشورة بالـslug -- /blog/:slug */
export default function BlogPost() {
  const { t, dir, locale } = useDirection();
  const { slug } = useParams<{ slug: string }>();

  const [post, setPost] = useState<BlogPostType | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchPost = async () => {
      if (!slug) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setLoading(true);
      setNotFound(false);
      try {
        const data = await getPublishedPostBySlug(slug);
        if (cancelled) return;
        if (!data) {
          setNotFound(true);
          setPost(null);
        } else {
          setPost(data);
        }
      } catch (err) {
        console.error('Error loading blog post:', err);
        if (!cancelled) {
          setNotFound(true);
          setPost(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchPost();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // يضبط عنوان التبويب ووصف meta عند توفر المقال، ويُرجعهما لقيمتهما السابقة
  // عند الخروج من الصفحة -- لا يبقى عنوان التبويب "عالقاً" على عنوان المقال.
  useEffect(() => {
    if (!post) return;
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

  const BackIcon = dir === 'rtl' ? ArrowRight : ArrowLeft;

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-muted flex flex-col items-center justify-center py-20 text-content-muted" dir={dir}>
        <Loader2 className="animate-spin w-8 h-8 mb-3 text-brand" />
        <p>{t('blog.loading', 'جاري تحميل المقال...')}</p>
      </div>
    );
  }

  if (notFound || !post) {
    return (
      <div className="min-h-screen bg-surface-muted flex flex-col items-center justify-center py-20 text-center px-4" dir={dir}>
        <FileX className="w-10 h-10 mb-3 text-content-muted" />
        <h1 className="text-xl font-black text-content mb-2">{t('blog.not_found', 'المقال غير موجود')}</h1>
        <Link to="/blog" className="text-brand font-bold hover:underline inline-flex items-center gap-1.5 mt-2">
          <BackIcon size={16} />
          {t('blog.back_to_list', 'العودة إلى المدونة')}
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-muted py-10 px-4 font-sans" dir={dir}>
      <div className="max-w-2xl mx-auto">
        <Link
          to="/blog"
          className="inline-flex items-center gap-1.5 text-sm font-bold text-content-muted hover:text-brand transition-colors mb-6"
        >
          <BackIcon size={16} />
          {t('blog.back_to_list', 'العودة إلى المدونة')}
        </Link>

        <article className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden">
          {post.coverImageUrl && (
            <img src={post.coverImageUrl} alt={post.title} className="w-full h-64 object-cover" />
          )}
          <div className="p-6 sm:p-8">
            <h1 className="text-2xl sm:text-3xl font-black text-content mb-3">{post.title}</h1>
            {post.publishedAt && (
              <div className="flex items-center gap-1.5 text-xs text-content-muted font-medium mb-6">
                <Calendar size={14} />
                <span>{new Date(post.publishedAt).toLocaleDateString(locale)}</span>
              </div>
            )}
            <div
              className="prose prose-sm sm:prose-base max-w-none text-content [&_h1]:font-black [&_h2]:font-black [&_h3]:font-bold [&_a]:text-brand [&_strong]:font-bold"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(post.content) }}
            />
          </div>
        </article>
      </div>
    </div>
  );
}
