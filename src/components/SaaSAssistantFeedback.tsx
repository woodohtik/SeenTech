import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageSquareWarning, ThumbsDown, ThumbsUp } from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { cn } from '../lib/utils';

interface FeedbackItem {
  id: string;
  rating: 'up' | 'down';
  comment: string | null;
  question: string | null;
  toolNames: string[];
  page: string | null;
  at: string;
  shopName: string | null;
}

interface FeedbackData {
  totals: { up: number; down: number };
  items: FeedbackItem[];
}

/**
 * The super admin's list of ratings on the assistant's answers
 * (seen-ai-assistant-redesign-task.md 2-1). Read-only.
 */
export default function SaaSAssistantFeedback() {
  const { t, i18n } = useTranslation();
  const [onlyDown, setOnlyDown] = useState(false);
  const [data, setData] = useState<FeedbackData | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/super-admin/assistant-feedback${onlyDown ? '?rating=down' : ''}`, {
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      });
      if (!res.ok) throw new Error(String(res.status));
      setData(await res.json());
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [onlyDown]);

  useEffect(() => { void load(); }, [load]);

  const locale = i18n.language === 'en' ? 'en-US' : i18n.language === 'ur' ? 'ur-PK-u-nu-latn' : 'ar-SA-u-nu-latn';

  return (
    <div className="bg-surface p-8 rounded-[12px] border border-border space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-xl font-black text-content flex items-center gap-2">
            <MessageSquareWarning className="text-brand" size={22} />
            {t('saas.assistant_feedback.title')}
          </h3>
          <p className="text-content-muted text-sm font-medium">{t('saas.assistant_feedback.desc')}</p>
          {data && <p className="text-sm font-semibold text-content">{t('saas.assistant_feedback.totals', data.totals)}</p>}
        </div>
        <div className="flex rounded-[12px] border border-border p-1" role="group">
          {[false, true].map((down) => (
            <button
              key={String(down)}
              type="button"
              aria-pressed={onlyDown === down}
              onClick={() => setOnlyDown(down)}
              className={cn(
                'min-h-11 px-4 rounded-[10px] text-sm font-semibold',
                onlyDown === down ? 'bg-brand text-white' : 'text-content-muted hover:bg-surface-muted'
              )}
            >
              {t(down ? 'saas.assistant_feedback.only_down' : 'saas.assistant_feedback.all')}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="h-24 rounded-[12px] bg-surface-muted animate-pulse" />
      ) : failed ? (
        <p role="alert" className="text-sm font-semibold text-danger">{t('saas.assistant_feedback.load_error')}</p>
      ) : !data || data.items.length === 0 ? (
        <p className="text-sm text-content-muted">{t('saas.assistant_feedback.empty')}</p>
      ) : (
        <ul className="divide-y divide-border m-0 p-0 list-none">
          {data.items.map((item) => (
            <li key={item.id} className="py-3 flex gap-3">
              <span
                className={cn('mt-0.5 shrink-0', item.rating === 'up' ? 'text-success' : 'text-danger')}
                title={t(`saas.assistant_feedback.${item.rating}`)}
              >
                {item.rating === 'up' ? <ThumbsUp size={18} aria-hidden="true" /> : <ThumbsDown size={18} aria-hidden="true" />}
                <span className="sr-only">{t(`saas.assistant_feedback.${item.rating}`)}</span>
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="m-0 text-sm font-semibold text-content break-words">
                  {item.question || t('saas.assistant_feedback.no_question')}
                </p>
                {item.comment && <p className="m-0 text-sm text-content break-words">«{item.comment}»</p>}
                <p className="m-0 text-xs text-content-muted">
                  {[item.shopName, item.page, item.toolNames.join('، '), new Date(item.at).toLocaleString(locale)]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
