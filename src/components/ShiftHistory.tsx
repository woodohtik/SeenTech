import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase/client';
import { handleError, OperationType } from '../lib/firebase';
import { Shift } from '../types';
import { cn } from '../lib/utils';
import { PriceDisplay } from './PriceDisplay';
import { FileText, Calendar, Search, Download, Printer } from 'lucide-react';
import Branding from './Branding';

interface ShiftHistoryProps {
  tenantId: string;
  staffId: string;
  isManager: boolean;
}

export default function ShiftHistory({ tenantId, staffId, isManager }: ShiftHistoryProps) {
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
    <div className="p-6 space-y-6 font-sans" style={{ fontFamily: 'IBM Plex Sans, sans-serif' }}>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black text-content">سجل الورديات</h2>
          <p className="text-content-muted mt-1">مراجعة الورديات السابقة وتقارير Z</p>
        </div>
        <div className="flex gap-3 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-content-muted" size={18} />
            <input 
              type="text" 
              placeholder="بحث باسم الموظف..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pr-10 pl-4 py-2 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-brand outline-none text-sm font-bold"
            />
          </div>
          <div className="relative">
            <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 text-content-muted" size={18} />
            <input 
              type="date" 
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="pr-10 pl-4 py-2 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-brand outline-none text-sm font-bold"
            />
          </div>
        </div>
      </div>

      <div className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto whitespace-nowrap scrollbar-hide">
          <table className="w-full text-right min-w-max">
            <thead className="bg-surface-muted border-b border-border">
              <tr>
                <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-wider">الموظف</th>
                <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-wider">وقت البداية</th>
                <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-wider">وقت النهاية</th>
                <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-wider">الحالة</th>
                <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-wider">المتوقع</th>
                <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-wider">الفعلي</th>
                <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-wider">الفارق</th>
                <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-wider">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredShifts.map((shift) => (
                <tr key={shift.id} className="hover:bg-surface-muted/50 transition-colors">
                  <td className="px-6 py-4 font-bold text-content">{shift.staffName}</td>
                  <td className="px-6 py-4 text-sm text-content-muted">{new Date(shift.startTime).toLocaleString('ar-SA')}</td>
                  <td className="px-6 py-4 text-sm text-content-muted">{shift.endTime ? new Date(shift.endTime).toLocaleString('ar-SA') : '-'}</td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "px-3 py-1 rounded-full text-xs font-bold",
                      shift.status === 'open' ? "bg-success/10 text-success" : "bg-content-muted/10 text-content-muted"
                    )}>
                      {shift.status === 'open' ? 'مفتوحة' : 'مغلقة'}
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
                        title="طباعة تقرير Z"
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
                    لا توجد ورديات مطابقة للبحث
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Printable Z-Report */}
      {selectedShift && (
        <div className="hidden print:block fixed inset-0 bg-white z-[200] p-8 text-black" dir="rtl" style={{ fontFamily: 'IBM Plex Sans, sans-serif' }}>
          <div className="max-w-md mx-auto">
            <div className="text-center mb-6 border-b border-dashed border-gray-400 pb-4">
              <h1 className="text-2xl font-black mb-2">تقرير الوردية (Z-Report)</h1>
              <p className="text-sm">الموظف: {selectedShift.staffName}</p>
              <p className="text-sm">البداية: {new Date(selectedShift.startTime).toLocaleString('ar-SA')}</p>
              <p className="text-sm">النهاية: {selectedShift.endTime ? new Date(selectedShift.endTime).toLocaleString('ar-SA') : '-'}</p>
            </div>

            <div className="space-y-4 mb-6">
              <div className="flex justify-between font-bold">
                <span>رصيد الافتتاح:</span>
                <span><PriceDisplay amount={selectedShift.openingBalance} /></span>
              </div>
              
              <div className="border-t border-gray-200 pt-2">
                <h3 className="font-black mb-2">المبيعات حسب طريقة الدفع</h3>
                <div className="flex justify-between text-sm">
                  <span>نقدي:</span>
                  <span><PriceDisplay amount={Number(selectedShift.totals?.cash || 0)} /></span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>شبكة/بطاقة:</span>
                  <span><PriceDisplay amount={Number(selectedShift.totals?.card || 0)} /></span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>تحويل بنكي:</span>
                  <span><PriceDisplay amount={Number(selectedShift.totals?.bank_transfer || 0)} /></span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>آجل/أخرى:</span>
                  <span><PriceDisplay amount={Number(selectedShift.totals?.credit || 0)} /></span>
                </div>
                <div className="flex justify-between font-bold mt-2 pt-2 border-t border-gray-200">
                  <span>إجمالي المبيعات:</span>
                  <span><PriceDisplay amount={Number(selectedShift.totals?.totalSales || 0)} /></span>
                </div>
              </div>

              <div className="border-t border-border pt-2">
                <div className="flex justify-between text-sm text-danger">
                  <span>إجمالي المرتجعات:</span>
                  <span>-<PriceDisplay amount={Number(selectedShift.totals?.totalReturns || 0)} /></span>
                </div>
                <div className="flex justify-between text-sm text-danger">
                  <span>المرتجعات النقدية:</span>
                  <span>-<PriceDisplay amount={Number(selectedShift.totals?.cashReturns || (selectedShift.totals as any)?.returns || 0)} /></span>
                </div>
                <div className="flex justify-between text-sm text-danger">
                  <span>المصروفات (سحب نقدي):</span>
                  <span>-<PriceDisplay amount={Number(selectedShift.totals?.expenses || 0)} /></span>
                </div>
                <div className="flex justify-between text-sm text-success">
                  <span>الإيداعات النقدية:</span>
                  <span>+<PriceDisplay amount={Number(selectedShift.totals?.totalDeposits || 0)} /></span>
                </div>
              </div>

              <div className="border-t border-gray-200 pt-2">
                <div className="flex justify-between text-sm">
                  <span>الضرائب المحصلة:</span>
                  <span><PriceDisplay amount={Number(selectedShift.totals?.taxes || 0)} /></span>
                </div>
              </div>

              <div className="border-t border-gray-800 pt-4 mt-4">
                <div className="flex justify-between font-black text-lg">
                  <span>المبلغ المتوقع في الدرج:</span>
                  <span><PriceDisplay amount={selectedShift.expectedCash || 0} /></span>
                </div>
                <div className="flex justify-between font-black text-lg mt-2">
                  <span>المبلغ الفعلي (المدخل):</span>
                  <span><PriceDisplay amount={selectedShift.actualCash || 0} /></span>
                </div>
                <div className={cn(
                  "flex justify-between font-black mt-2 pt-2 border-t border-dashed border-border",
                  selectedShift.discrepancy === 0 ? "text-success" : "text-danger"
                )}>
                  <span>الفارق:</span>
                  <span><PriceDisplay amount={selectedShift.discrepancy || 0} /></span>
                </div>
                {selectedShift.discrepancyReason && (
                  <div className="mt-2 text-sm text-content-muted">
                    <span className="font-bold">السبب: </span>
                    {selectedShift.discrepancyReason}
                  </div>
                )}
              </div>
            </div>

            {selectedShift.payouts && selectedShift.payouts.length > 0 && (
              <div className="border-t border-gray-800 pt-4 mb-6">
                <h3 className="font-black mb-2">تفاصيل المصروفات</h3>
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
