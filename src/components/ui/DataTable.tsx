import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, ChevronUp, ChevronDown } from 'lucide-react';

interface Column<T> {
  header: string;
  accessor: keyof T | ((row: T) => React.ReactNode);
  sortable?: boolean;
}

interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  searchPlaceholder?: string;
  onRowClick?: (row: T) => void;
  isLoading?: boolean;
}

export function DataTable<T extends Record<string, any>>({ 
  data, 
  columns, 
  searchPlaceholder, 
  onRowClick,
  isLoading 
}: DataTableProps<T>) {
  const { t } = useTranslation();
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);

  const filteredAndSortedData = useMemo(() => {
    let result = data;

    if (searchTerm) {
      result = result.filter(item => 
        Object.values(item).some(val => 
          String(val).toLowerCase().includes(searchTerm.toLowerCase())
        )
      );
    }

    if (sortConfig) {
      result = [...result].sort((a, b) => {
        const aVal = a[sortConfig.key];
        const bVal = b[sortConfig.key];
        if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return result;
  }, [data, searchTerm, sortConfig]);

  const handleSort = (key: string) => {
    setSortConfig(current => {
      if (current?.key === key) {
        if (current.direction === 'asc') return { key, direction: 'desc' };
        return null;
      }
      return { key, direction: 'asc' };
    });
  };

  return (
    <div className="w-full bg-surface shadow-sm rounded-lg border border-border">
      <div className="p-4 border-b border-border">
        <div className="relative">
          <div className="absolute inset-y-0 end-0 pe-3 flex items-center pointer-events-none">
            <Search className="h-5 w-5 text-content-muted" />
          </div>
          <input
            type="text"
            className="block w-full sm:text-sm bg-surface border-border text-content rounded-md outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand pe-10"
            placeholder={searchPlaceholder ?? t('common.search')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="overflow-x-auto w-full">
        {/* Mobile View: Vertical Stacked Card List */}
        <div className="md:hidden flex flex-col divide-y divide-border">
          {isLoading ? (
            <div className="p-6 text-center text-sm text-content-muted">{t('common.loading')}</div>
          ) : filteredAndSortedData.length === 0 ? (
            <div className="p-6 text-center text-sm text-content-muted">{t('common.no_matching_records')}</div>
          ) : (
            filteredAndSortedData.map((row, rowIndex) => (
              <div
                key={rowIndex}
                onClick={() => onRowClick?.(row)}
                className={`p-4 flex flex-col gap-2 transition-colors ${onRowClick ? 'cursor-pointer active:bg-surface-muted' : ''}`}
              >
                {columns.map((col, colIndex) => (
                  <div key={colIndex} className="flex justify-between items-center text-sm">
                    <span className="font-bold text-content-muted">{col.header}:</span>
                    <span className="text-content text-end max-w-[60%] truncate">
                      {typeof col.accessor === 'function' ? col.accessor(row) : (row[col.accessor as keyof T] as any)}
                    </span>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>

        {/* Tablet and Desktop View: Standard Table */}
        <table className="hidden md:table w-full min-w-max divide-y divide-border">
          <thead className="bg-surface-muted text-start">
            <tr>
              {columns.map((col, i) => (
                <th
                  key={i}
                  className={`px-6 py-3 text-xs font-medium text-content-muted uppercase tracking-wider text-start ${col.sortable ? 'cursor-pointer hover:bg-surface' : ''}`}
                  onClick={() => {
                    if (col.sortable && typeof col.accessor === 'string') {
                      handleSort(col.accessor as string);
                    }
                  }}
                >
                  <div className="flex items-center gap-1">
                    <span>{col.header}</span>
                    {col.sortable && typeof col.accessor === 'string' && sortConfig?.key === col.accessor && (
                      sortConfig.direction === 'asc' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-surface divide-y divide-border">
            {isLoading ? (
              <tr>
                <td colSpan={columns.length} className="px-6 py-4 text-center text-sm text-content-muted">
                  {t('common.loading')}
                </td>
              </tr>
            ) : filteredAndSortedData.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-6 py-4 text-center text-sm text-content-muted">
                  {t('common.no_matching_records')}
                </td>
              </tr>
            ) : (
              filteredAndSortedData.map((row, rowIndex) => (
                <tr
                  key={rowIndex}
                  onClick={() => onRowClick?.(row)}
                  className={onRowClick ? "cursor-pointer hover:bg-surface-muted" : ""}
                >
                  {columns.map((col, colIndex) => (
                    <td key={colIndex} className="px-6 py-4 whitespace-nowrap text-sm text-content text-start">
                      {typeof col.accessor === 'function' ? col.accessor(row) : (row[col.accessor] as any)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
