import React, { useState, useMemo } from 'react';
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
  searchPlaceholder = 'بحث...', 
  onRowClick,
  isLoading 
}: DataTableProps<T>) {
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
    <div className="w-full bg-white shadow-sm rounded-lg border border-gray-200">
      <div className="p-4 border-b border-gray-200">
        <div className="relative">
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
            <Search className="h-5 w-5 text-gray-400" />
          </div>
          <input
            type="text"
            className="block w-full sm:text-sm border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 pr-10"
            placeholder={searchPlaceholder}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="overflow-x-auto w-full">
        {/* Mobile View: Vertical Stacked Card List */}
        <div className="md:hidden flex flex-col divide-y divide-gray-100">
          {isLoading ? (
            <div className="p-6 text-center text-sm text-gray-500">جاري التحميل...</div>
          ) : filteredAndSortedData.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-500">لا توجد سجلات مطابقة</div>
          ) : (
            filteredAndSortedData.map((row, rowIndex) => (
              <div 
                key={rowIndex} 
                onClick={() => onRowClick?.(row)} 
                className={`p-4 flex flex-col gap-2 transition-colors ${onRowClick ? 'cursor-pointer active:bg-gray-50' : ''}`}
              >
                {columns.map((col, colIndex) => (
                  <div key={colIndex} className="flex justify-between items-center text-sm">
                    <span className="font-bold text-gray-500">{col.header}:</span>
                    <span className="text-gray-900 text-left max-w-[60%] truncate">
                      {typeof col.accessor === 'function' ? col.accessor(row) : (row[col.accessor as keyof T] as any)}
                    </span>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>

        {/* Tablet and Desktop View: Standard Table */}
        <table className="hidden md:table w-full min-w-max divide-y divide-gray-200">
          <thead className="bg-gray-50 text-right">
            <tr>
              {columns.map((col, i) => (
                <th 
                  key={i} 
                  className={`px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider ${col.sortable ? 'cursor-pointer hover:bg-gray-100' : ''}`}
                  onClick={() => {
                    if (col.sortable && typeof col.accessor === 'string') {
                      handleSort(col.accessor as string);
                    }
                  }}
                >
                  <div className="flex items-center space-x-1 space-x-reverse">
                    <span>{col.header}</span>
                    {col.sortable && typeof col.accessor === 'string' && sortConfig?.key === col.accessor && (
                      sortConfig.direction === 'asc' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {isLoading ? (
              <tr>
                <td colSpan={columns.length} className="px-6 py-4 text-center text-sm text-gray-500">
                  جاري التحميل...
                </td>
              </tr>
            ) : filteredAndSortedData.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-6 py-4 text-center text-sm text-gray-500">
                  لا توجد سجلات مطابقة
                </td>
              </tr>
            ) : (
              filteredAndSortedData.map((row, rowIndex) => (
                <tr 
                  key={rowIndex} 
                  onClick={() => onRowClick?.(row)}
                  className={onRowClick ? "cursor-pointer hover:bg-gray-50" : ""}
                >
                  {columns.map((col, colIndex) => (
                    <td key={colIndex} className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
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
