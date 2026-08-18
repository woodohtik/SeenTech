import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase/client';
import { handleError, OperationType } from '../lib/firebase';
import { Shift } from '../types';
import { cn } from '../lib/utils';
import { PriceDisplay } from './PriceDisplay';
import { FileText, Search, Download, Printer } from 'lucide-react';
import Branding from './Branding';
import { useTranslation } from 'react-i18next';
import DateTimeDisplay from './DateTimeDisplay';
import { DatePicker } from './ui/DatePicker';

import { isRtlLang } from '../lib/direction';

interface ShiftHistoryProps {
  tenantId: string;
  staffId: string;
  isManager: boolean;
}

export default function ShiftHistory({ tenantId, staffId, isManager }: ShiftHistoryProps) {
  const { t, i18n } = useTranslation();
  const isRtl = isRtlLang(i18n.language);

  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [selectedShift, setSelectedShift] = useState<Shift | null>(null);

  useEffect(() => {
    const fetchShifts = async () => {
      try {
        let query = supabase
          .from('shifts')
          .select('*')
          .eq('tenant_id', tenantId)
          .order('start_time', { ascending: false });

        if (!isManager) {
          query = query.eq('staff_id', staffId);
        }

        const { data, error } = await query;
        
        if (error) throw error;
        
        const mappedShifts = data.map(d => ({
          ...d,
          tenantId: d.tenant_id,
          staffId: d.staff_id,
          staffName: d.staff_name,
          openingBalance: d.opening_balance,
          closingBalance: d.closing_balance,
          actualCash: d.actual_cash,
          expectedCash: d.expected_cash,
          discrepancy: d.discrepancy,
          discrepancyReason: d.discrepancy_reason,
          startTime: d.start_time,
          endTime: d.end_time
        }) as Shift);

        setShifts(mappedShifts);
      } catch (error) {
        handleError(error as any, OperationType.GET, 'shifts');
      } finally {
        setLoading(false);
      }
    };

    fetchShifts();
  }, [tenantId, staffId, isManager]);

  const filteredShifts = shifts.filter(s => {
    const matchesSearch = s.staffName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesDate = !dateFilter || s.startTime.startsWith(dateFilter);
    return matchesSearch && matchesDate;
  });

  const handlePrintZReport = async (shift: Shift) => {
    try {
      const { data: entries, error } = await supabase
        .from('shift_entries')
        .select('*')
        .eq('shift_id', shift.id);

      let payouts: any[] = [];
      let deposits: any[] = [];

      if (!error && entries) {
        payouts = entries
          .filter(e => e.entry_type === 'payout')
          .map(e => ({ id: e.id, amount: Number(e.amount), reason: e.reason, time: e.occurred_at }));

        deposits = entries
          .filter(e => e.entry_type === 'deposit')
          .map(e => ({ id: e.id, amount: Number(e.amount), reason: e.reason, time: e.occurred_at }));
      }

      setSelectedShift({
        ...shift,
        payouts,
        deposits
      });
      setTimeout(() => {
        window.print();
      }, 100);
    } catch (err) {
      console.error(err);
      setSelectedShift(shift);
      setTimeout(() => {
        window.print();
      }, 100);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand"></div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 font-sans bg-surface" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black text-content">{t('shift_history.title')}</h2>
          <p className="text-content-muted mt-1">{t('shift_history.desc')}</p>
        </div>
        <div className="flex gap-3 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <Search className={cn("absolute top-1/2 -translate-y-1/2 text-content-muted", isRtl ? "right-3" : "left-3")} size={18} />
            <input 
              type="text" 
              placeholder={t('shift_history.search_employee')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className={cn("w-full py-2 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-brand outline-none text-sm font-bold", isRtl ? "pr-10 pl-4" : "pl-10 pr-4")}
            />
          </div>
          <div className="min-w-[150px]">
            <DatePicker value={dateFilter} onChange={setDateFilter} />
          </div>
        </div>
      </div>

      <div className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto whitespace-nowrap scrollbar-hide">
          <table className={cn("w-full min-w-max", isRtl ? "text-right" : "text-left")}>
            <thead className="bg-surface-muted border-b border-border">
              <tr>
                <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-wider">{t('shift_history.employee')}</th>
                <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-wider">{t('shift_history.start_time')}</th>
                <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-wider">{t('shift_history.end_time')}</th>
                <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-wider">{t('shift_history.status')}</th>
                <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-wider">{t('shift_history.expected')}</th>
                <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-wider">{t('shift_history.actual')}</th>
                <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-wider">{t('shift_history.discrepancy')}</th>
                <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-wider">{t('shift_history.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredShifts.map((shift) => (
                <tr key={shift.id} className="hover:bg-surface-muted/50 transition-colors">
                  <td className="px-6 py-4 font-bold text-content">{shift.staffName}</td>
                  <td className="px-6 py-4 text-sm text-content-muted">
                    <DateTimeDisplay date={shift.startTime} showTime={true} />
                  </td>
                  <td className="px-6 py-4 text-sm text-content-muted">
                    {shift.endTime ? <DateTimeDisplay date={shift.endTime} showTime={true} /> : '-'}
                  </td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "px-3 py-1 rounded-full text-xs font-bold",
                      shift.status === 'open' ? "bg-success/10 text-success" : "bg-content-muted/10 text-content-muted"
                    )}>
                      {shift.status === 'open' ? t('shift_history.open') : t('shift_history.closed')}
                    </span>
                  </td>
                  <td className="px-6 py-4 font-bold text-content"><PriceDisplay amount={shift.expectedCash || 0} /></td>
                  <td className="px-6 py-4 font-bold text-content"><PriceDisplay amount={shift.actualCash || 0} /></td>
                  <td className="px-6 py-4">
                    {shift.discrepancy !== undefined ? (
                      <span className={cn(
                        "font-bold",
                        shift.discrepancy === 0 ? "text-success" : "text-danger"
                      )}>
                        {shift.discrepancy > 0 ? '+' : ''}<PriceDisplay amount={shift.discrepancy} />
                      </span>
                    ) : '-'}
                  </td>
                  <td className="px-6 py-4">
                    {shift.status === 'closed' && (
                      <button 
                         onClick={() => handlePrintZReport(shift)}
                        className="p-2 text-brand hover:bg-brand/10 rounded-lg transition-colors"
                        title={t('shift_history.print_z_report')}
                      >
                        <Printer size={18} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {filteredShifts.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-content-muted font-bold">
                    {t('shift_history.no_shifts')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Printable Z-Report */}
      {selectedShift && (
        <div className="hidden print:block fixed inset-0 bg-white z-[200] p-8 text-black" dir={isRtl ? 'rtl' : 'ltr'}>
          <div className="max-w-md mx-auto">
            <div className="text-center mb-6 border-b border-dashed border-gray-400 pb-4">
              <h1 className="text-2xl font-black mb-2">{t('shift_closing.title')}</h1>
              <p className="text-sm">{t('shift_history.employee')}: {selectedShift.staffName}</p>
              <div className="text-sm flex items-center justify-center gap-2 my-1">
                <span>{t('shift_history.start_time')}:</span>
                <DateTimeDisplay date={selectedShift.startTime} showTime={true} size="xs" />
              </div>
              <div className="text-sm flex items-center justify-center gap-2 my-1">
                <span>{t('shift_history.end_time')}:</span>
                {selectedShift.endTime ? <DateTimeDisplay date={selectedShift.endTime} showTime={true} size="xs" /> : '-'}
              </div>
            </div>

            <div className="space-y-4 mb-6">
              <div className="flex justify-between font-bold">
                <span>{t('shift_closing.opening_balance')}</span>
                <span><PriceDisplay amount={selectedShift.openingBalance} /></span>
              </div>
              
              <div className="border-t border-gray-200 pt-2">
                <h3 className="font-black mb-2">{t('shift_history.sales_by_payment')}</h3>
                <div className="flex justify-between text-sm">
                  <span>{t('pos.cash')}</span>
                  <span><PriceDisplay amount={Number(selectedShift.totals?.cash || 0)} /></span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>{t('pos.card')}</span>
                  <span><PriceDisplay amount={Number(selectedShift.totals?.card || 0)} /></span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>{t('pos.bank_transfer')}</span>
                  <span><PriceDisplay amount={Number(selectedShift.totals?.bank_transfer || 0)} /></span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>{t('pos.other')}</span>
                  <span><PriceDisplay amount={Number(selectedShift.totals?.credit || 0)} /></span>
                </div>
                <div className="flex justify-between font-bold mt-2 pt-2 border-t border-gray-200">
                  <span>{t('shift_history.total_sales')}</span>
                  <span><PriceDisplay amount={Number(selectedShift.totals?.totalSales || 0)} /></span>
                </div>
              </div>

              <div className="border-t border-border pt-2">
                <div className="flex justify-between text-sm text-danger">
                  <span>{t('shift_history.total_returns')}</span>
                  <span>-<PriceDisplay amount={Number(selectedShift.totals?.totalReturns || 0)} /></span>
                </div>
                <div className="flex justify-between text-sm text-danger">
                  <span>{t('shift_closing.cash_returns')}</span>
                  <span>-<PriceDisplay amount={Number(selectedShift.totals?.cashReturns || (selectedShift.totals as any)?.returns || 0)} /></span>
                </div>
                <div className="flex justify-between text-sm text-danger">
                  <span>{t('shift_closing.cash_withdrawals')}</span>
                  <span>-<PriceDisplay amount={Number(selectedShift.totals?.expenses || 0)} /></span>
                </div>
                <div className="flex justify-between text-sm text-success">
                  <span>{t('shift_closing.cash_deposits')}</span>
                  <span>+<PriceDisplay amount={Number(selectedShift.totals?.totalDeposits || 0)} /></span>
                </div>
              </div>

              <div className="border-t border-gray-200 pt-2">
                <div className="flex justify-between text-sm">
                  <span>{t('shift_history.collected_taxes')}</span>
                  <span><PriceDisplay amount={Number(selectedShift.totals?.taxes || 0)} /></span>
                </div>
              </div>

              <div className="border-t border-gray-800 pt-4 mt-4">
                <div className="flex justify-between font-black text-lg">
                  <span>{t('shift_history.expected_cash_drawer')}</span>
                  <span><PriceDisplay amount={selectedShift.expectedCash || 0} /></span>
                </div>
                <div className="flex justify-between font-black text-lg mt-2">
                  <span>{t('shift_history.actual_cash_drawer')}</span>
                  <span><PriceDisplay amount={selectedShift.actualCash || 0} /></span>
                </div>
                <div className={cn(
                  "flex justify-between font-black mt-2 pt-2 border-t border-dashed border-border",
                  selectedShift.discrepancy === 0 ? "text-success" : "text-danger"
                )}>
                  <span>{t('shift_history.discrepancy_label')}</span>
                  <span><PriceDisplay amount={selectedShift.discrepancy || 0} /></span>
                </div>
                {selectedShift.discrepancyReason && (
                  <div className="mt-2 text-sm text-content-muted">
                    <span className="font-bold">{t('shift_history.reason_label')}</span>
                    {selectedShift.discrepancyReason}
                  </div>
                )}
              </div>
            </div>

            {selectedShift.payouts && selectedShift.payouts.length > 0 && (
              <div className="border-t border-gray-800 pt-4 mb-6">
                <h3 className="font-black mb-2">{t('shift_history.expenses_details')}</h3>
                {selectedShift.payouts.map(p => (
                  <div key={p.id} className="flex justify-between text-sm mb-1">
                    <span>{p.reason}</span>
                    <span><PriceDisplay amount={p.amount} /></span>
                  </div>
                ))}
              </div>
            )}

            <div className="text-center mt-8 pt-4 border-t border-gray-400">
              <Branding className="scale-75 origin-center" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
