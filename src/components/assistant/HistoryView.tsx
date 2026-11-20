import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, LoaderCircle, Trash2 } from 'lucide-react';
import { localeOf } from '../../lib/direction';
import { cn } from '../../lib/utils';
import { useConfirm } from '../../contexts/ConfirmContext';
import { IconButton } from './parts';
import { relativeDay, clockTime } from './formatters';
import type { ConversationSummary } from './useAssistantChat';

export interface HistoryViewProps {
  currentId: string;
  onList: () => Promise<ConversationSummary[]>;
  onOpen: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  /** Back to the conversation, after opening one or with nothing chosen. */
  onDone: () => void;
}

/** The person's past conversations (2-4): open one, or delete it. */
export function HistoryView({ currentId, onList, onOpen, onDelete, onDone }: HistoryViewProps) {
  const { t, i18n } = useTranslation();
  const { confirm } = useConfirm();
  const locale = localeOf(i18n.language);
  const [items, setItems] = useState<ConversationSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionFailed, setActionFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setItems(await onList());
    } catch {
      setFailed(true);
    }
  }, [onList]);

  useEffect(() => { void load(); }, [load]);

  const when = (iso: string) => {
    const day = relativeDay(iso, locale);
    if (!day) return '';
    const dayText = 'text' in day ? day.text : t(`ai.day.${day.kind}`);
    return day.kind === 'today' ? clockTime(new Date(iso).getTime(), locale) : dayText;
  };

  const open = async (id: string) => {
    setBusyId(id);
    setActionFailed(false);
    try {
      await onOpen(id);
      onDone();
    } catch {
      setActionFailed(true);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (item: ConversationSummary) => {
    const ok = await confirm({
      title: t('ai.history_delete_title'),
      description: t('ai.history_delete_confirm', { title: item.title }),
      confirmLabel: t('ai.history_delete'),
      danger: true,
    });
    if (!ok) return;
    setBusyId(item.id);
    setActionFailed(false);
    try {
      await onDelete(item.id);
      setItems((prev) => (prev || []).filter((c) => c.id !== item.id));
    } catch {
      setActionFailed(true);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-5 pt-4 pb-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="m-0 text-base font-bold text-content">{t('ai.history_title')}</h3>
        <button
          type="button"
          onClick={onDone}
          className="min-h-11 px-3 rounded-[12px] text-sm font-semibold text-brand hover:bg-surface-muted"
        >
          {t('ai.history_back')}
        </button>
      </div>
      <p className="m-0 text-sm text-content-muted">{t('ai.history_note')}</p>

      {(failed || actionFailed) && (
        <div role="alert" className="rounded-[12px] bg-warning/10 p-3 flex items-center justify-between gap-2 text-sm text-content">
          <span>{t('ai.history_error')}</span>
          {failed && (
            <button type="button" onClick={() => void load()} className="min-h-11 px-3 rounded-[12px] font-semibold text-brand hover:bg-surface">
              {t('common.retry', 'إعادة المحاولة')}
            </button>
          )}
        </div>
      )}

      {!items && !failed && (
        <div role="status" className="flex items-center gap-2 text-sm text-content-muted">
          <LoaderCircle size={20} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
          <span>{t('ai.history_loading')}</span>
        </div>
      )}

      {items && items.length === 0 && <p className="m-0 text-[15px] text-content-muted">{t('ai.history_empty')}</p>}

      {items && items.length > 0 && (
        <ul className="m-0 p-0 list-none flex flex-col gap-2">
          {items.map((item) => (
            <li
              key={item.id}
              className={cn(
                'flex items-center gap-1 rounded-[12px] border',
                item.id === currentId ? 'border-brand bg-brand/5' : 'border-border'
              )}
            >
              <button
                type="button"
                onClick={() => void open(item.id)}
                disabled={busyId !== null}
                aria-current={item.id === currentId ? 'true' : undefined}
                className="flex-1 min-w-0 min-h-12 flex items-center gap-2 ps-4 py-2 text-start rounded-[12px] hover:bg-surface-muted disabled:opacity-60"
              >
                <span className="flex-1 min-w-0 flex flex-col">
                  <span className="text-[15px] font-semibold text-content truncate">{item.title}</span>
                  <span className="text-sm text-content-muted tabular-nums">{when(item.updatedAt)}</span>
                </span>
                {busyId === item.id
                  ? <LoaderCircle size={20} className="shrink-0 animate-spin motion-reduce:animate-none text-content-muted" aria-hidden="true" />
                  : <ChevronLeft size={20} className="shrink-0 text-content-muted ltr:-scale-x-100" aria-hidden="true" />}
              </button>
              <IconButton
                size={44}
                label={t('ai.history_delete_named', { title: item.title })}
                onClick={() => void remove(item)}
                disabled={busyId !== null}
                className="hover:text-danger"
              >
                <Trash2 size={20} aria-hidden="true" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
