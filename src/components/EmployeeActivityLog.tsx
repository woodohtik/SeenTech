import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase/client';
import { handleError, OperationType } from '../lib/firebase';
import { EmployeeActivityLog } from '../types';
import { Search } from 'lucide-react';
import DateTimeDisplay from './DateTimeDisplay';
import { DatePicker } from './ui/DatePicker';

export default function EmployeeActivityLogTab({ tenantId }: { tenantId: string }) {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<EmployeeActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  
  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const { data, error } = await supabase
          .from('employee_activity_logs')
          .select('*')
          .eq('tenant_id', tenantId)
          .order('occurred_at', { ascending: false })
          .limit(100);
        
        if (error) throw error;

        const mappedLogs = data.map(d => ({
          ...d,
          staffId: d.staff_id,
          staffName: d.staff_name,
          tenantId: d.tenant_id,
          branchName: d.branch_name,
          timestamp: d.occurred_at
        }) as EmployeeActivityLog);

        setLogs(mappedLogs);
      } catch (error) {
        handleError(error as any, OperationType.LIST, 'employee_activity_logs');
      } finally {
        setLoading(false);
      }
    };
    fetchLogs();
  }, [tenantId]);

  const filteredLogs = logs.filter(log => {
    const searchMatch = log.staffName.toLowerCase().includes(searchTerm.toLowerCase()) || 
                       log.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
                       log.details.toLowerCase().includes(searchTerm.toLowerCase());
    
    const dateMatch = dateFilter ? log.timestamp.startsWith(dateFilter) : true;
    return searchMatch && dateMatch;
  });

  const getActionColor = (action: string) => {
    if (action.includes('delete') || action.includes('cancel')) return 'text-danger bg-danger/10 border-danger/20';
    if (action.includes('edit') || action.includes('adjust')) return 'text-warning bg-warning/10 border-warning/20';
    if (action.includes('create') || action.includes('open')) return 'text-success bg-success/10 border-success/20';
    return 'text-brand bg-brand/10 border-brand/20';
  };
  
  const getActionLabel = (action: string) => {
    const map: Record<string, string> = {
      login: t('settings_page.staff.activity.login', 'تسجيل دخول'),
      open_shift: t('settings_page.staff.activity.open_shift', 'فتح وردية'),
      close_shift: t('settings_page.staff.activity.close_shift', 'إغلاق وردية'),
      create_invoice: t('settings_page.staff.activity.create_invoice', 'إنشاء فاتورة'),
      delete_invoice: t('settings_page.staff.activity.delete_invoice', 'حذف فاتورة'),
      edit_measurements: t('settings_page.staff.activity.edit_measurements', 'تعديل مقاسات'),
      delete_order: t('settings_page.staff.activity.delete_order', 'حذف طلب'),
      add_supplier: t('settings_page.staff.activity.add_supplier', 'إضافة مورد'),
      adjust_inventory: t('settings_page.staff.activity.adjust_inventory', 'تسوية مخزون'),
      print_invoice: t('settings_page.staff.activity.print_invoice', 'طباعة فاتورة'),
      manual_price_edit: t('settings_page.staff.activity.manual_price_edit', 'إضافة خصم')
    };
    return map[action] || action;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 font-sans">
      
      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
        <div className="flex items-center gap-2.5 bg-surface-muted/50 hover:bg-surface-muted/80 border border-border focus-within:border-brand/40 focus-within:bg-surface rounded-2xl px-4 h-12 transition-all w-full shadow-inner shadow-black/5">
          <Search className="text-content-muted shrink-0" size={18} />
          <input 
            type="text"
            placeholder={t('settings_page.staff.activity.search_placeholder', 'بحث بالإسم أو العملية...')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-transparent font-bold outline-none text-content border-none p-0 focus:ring-0 text-sm"
          />
        </div>
        <div className="w-full">
          <DatePicker value={dateFilter} onChange={setDateFilter} />
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-surface rounded-2xl border border-border overflow-x-auto whitespace-nowrap scrollbar-hide">
        <table className="w-full text-right text-sm min-w-max">
          <thead className="bg-surface-muted border-b border-border text-content-muted uppercase tracking-widest text-[10px] font-black">
            <tr>
              <th className="p-4">{t('settings_page.staff.activity.time', 'الوقت')}</th>
              <th className="p-4">{t('settings_page.staff.activity.employee', 'الموظف')}</th>
              <th className="p-4">{t('settings_page.staff.activity.branch', 'الفرع')}</th>
              <th className="p-4">{t('settings_page.staff.activity.action', 'العملية')}</th>
              <th className="p-4">{t('settings_page.staff.activity.details', 'التفاصيل')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border text-content-muted">
            {filteredLogs.map(log => {
              const isDeleted = log.action.includes('delete');
              return (
                <tr key={log.id} className="hover:bg-surface-muted/50 transition-colors">
                  <td className="p-4">
                    <DateTimeDisplay date={log.timestamp} showTime={true} size="xs" />
                  </td>
                  <td className="p-4 font-bold text-content">{log.staffName}</td>
                  <td className="p-4 font-bold">{log.branchName || '-'}</td>
                  <td className="p-4">
                    <span className={`px-2 py-1 rounded-lg border font-bold text-xs ${getActionColor(log.action)}`}>
                      {getActionLabel(log.action)}
                    </span>
                  </td>
                  <td className={`p-4 max-w-xs ${isDeleted ? 'text-danger font-bold' : ''}`}>
                    {log.details}
                  </td>
                </tr>
              )
            })}
            {filteredLogs.length === 0 && (
              <tr>
                <td colSpan={5} className="p-8 text-center text-content-muted font-bold">
                  {t('settings_page.staff.activity.no_logs', 'لا توجد سجلات نشاط للبحث المحدد')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      
      <div className="text-center pt-8 border-t border-border">
        <p className="text-[10px] font-black text-content-muted uppercase tracking-widest flex items-center justify-center gap-1" dir="ltr">
          Powered By <a href="#" className="text-brand hover:underline" target="_blank" rel="noreferrer">Seen</a>
        </p>
      </div>

    </div>
  );
}
