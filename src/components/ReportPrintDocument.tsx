import React from 'react';
import { FileText } from 'lucide-react';
import { PriceDisplay } from './PriceDisplay';
import Branding from './Branding';
import { useTranslation } from 'react-i18next';
import { useDirection, localeOf } from '../lib/direction';

export interface ReportKpiItem {
  label: string;
  value: number | string;
  isCurrency?: boolean;
}

export interface ReportTableSection {
  title: string;
  columns: string[];
  rows: (string | number)[][];
  /** Column indices (0-based) to render through PriceDisplay instead of as plain text. */
  currencyColumns?: number[];
}

interface ReportPrintDocumentProps {
  id?: string;
  reportTitle: string;
  dateRangeLabel?: string;
  kpis?: ReportKpiItem[];
  tables?: ReportTableSection[];
}

/**
 * Purpose-built print/export layout -- deliberately independent of the live
 * interactive dashboard (cards, charts, hover states) it mirrors. Only ever
 * rendered for print (hidden on screen via `print:block`), styled like the
 * Z-Report document: a single bordered document with a title header,
 * labeled KPI rows, and plain bordered tables -- not a UI screenshot.
 */
export default function ReportPrintDocument({ id, reportTitle, dateRangeLabel, kpis, tables }: ReportPrintDocumentProps) {
  const { t, i18n } = useTranslation();
  const { dir } = useDirection();

  return (
    <div id={id} className="hidden bg-white" dir={dir}>
      <div className="max-w-2xl mx-auto bg-white p-6 text-black">
        {/* Header */}
        <div className="text-center mb-8 border-b-2 border-black pb-6">
          <div className="mx-auto mb-3 w-14 h-14 rounded-full border-2 border-black flex items-center justify-center">
            <FileText size={26} />
          </div>
          <h2 className="text-xl font-black">{reportTitle}</h2>
          {dateRangeLabel && <p className="text-xs font-bold mt-1">{dateRangeLabel}</p>}
          <p className="text-[10px] font-bold mt-2 uppercase tracking-widest">
            {t('reports.title')} — {new Date().toLocaleString(localeOf(i18n.language))}
          </p>
        </div>

        {/* KPI Summary */}
        {kpis && kpis.length > 0 && (
          <div className="mb-8">
            <div className="border border-black rounded-lg p-4 space-y-2">
              {kpis.map((kpi, i) => (
                <div key={i} className="flex justify-between items-center text-sm font-bold border-b border-gray-300 last:border-0 pb-2 last:pb-0">
                  <span>{kpi.label}</span>
                  <span className="font-black">
                    {kpi.isCurrency ? <PriceDisplay amount={Number(kpi.value) || 0} /> : kpi.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Data Tables */}
        {tables?.map((table, ti) => (
          <div key={ti} className="mb-8">
            <h3 className="font-black text-sm mb-2">{table.title}</h3>
            {table.rows.length > 0 ? (
              <table className="w-full text-xs border-collapse" style={{ border: '1px solid #000' }}>
                <thead>
                  <tr>
                    {table.columns.map((col, ci) => (
                      <th key={ci} className="p-2 text-right font-black bg-gray-100" style={{ border: '1px solid #000' }}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row, ri) => (
                    <tr key={ri}>
                      {row.map((cell, ci) => (
                        <td key={ci} className="p-2" style={{ border: '1px solid #000' }}>
                          {table.currencyColumns?.includes(ci) ? <PriceDisplay amount={Number(cell) || 0} /> : cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-xs text-gray-500">{t('reports.no_customer_data', 'لا توجد بيانات')}</p>
            )}
          </div>
        ))}

        <div className="pt-6 border-t border-gray-300 text-center">
          <Branding collapsed={false} className="opacity-90" />
        </div>
      </div>
    </div>
  );
}
