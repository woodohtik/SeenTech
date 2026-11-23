import React from 'react';
import { useTranslation } from 'react-i18next';

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

/**
 * Sprint 2 pagination project (seen-cto-sprint2-pagination-task.md item 0):
 * extracted from the two identical copies of this exact markup in
 * SuperAdminDashboard.tsx (audit logs / activity logs tabs) so every new
 * paginated list reuses one component instead of a third copy. Renders
 * nothing when the whole list already fits on one page, matching that
 * screen's own `total > pageSize` gate.
 */
export function Pagination({ page, pageSize, total, onPageChange }: PaginationProps) {
  const { t } = useTranslation();
  if (total <= pageSize) return null;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex items-center justify-between pt-4 mt-4 border-t border-border/60">
      <button
        disabled={page === 0}
        onClick={() => onPageChange(Math.max(0, page - 1))}
        className="px-3 py-1.5 rounded-xl text-sm font-black bg-surface-muted hover:bg-border disabled:opacity-40 disabled:cursor-not-allowed text-content-muted transition-all cursor-pointer"
      >
        {t('saas.pagination_prev', 'السابق')}
      </button>
      <span className="text-sm font-black text-content-muted uppercase">
        {t('saas.pagination_page_of', { page: page + 1, total: totalPages })}
      </span>
      <button
        disabled={(page + 1) * pageSize >= total}
        onClick={() => onPageChange(page + 1)}
        className="px-3 py-1.5 rounded-xl text-sm font-black bg-surface-muted hover:bg-border disabled:opacity-40 disabled:cursor-not-allowed text-content-muted transition-all cursor-pointer"
      >
        {t('saas.pagination_next', 'التالي')}
      </button>
    </div>
  );
}
