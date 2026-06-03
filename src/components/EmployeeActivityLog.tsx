import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase/client';
import { handleError, OperationType } from '../lib/firebase';
import { EmployeeActivityLog } from '../types';
import { Shield, Search, Calendar, User, Clock, CheckCircle2, Box, Store } from 'lucide-react';

export default function EmployeeActivityLogTab({ tenantId }: { tenantId: string }) {
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
          .order('timestamp', { ascending: false })
          .limit(100);
        
        if (error) throw error;

        const mappedLogs = data.map(d => ({
          ...d,
          staffId: d.staff_id,
          staffName: d.staff_name,
          tenantId: d.tenant_id,
          branchName: d.branch_name,
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
      login: 'تسجيل دخول',
      open_shift: 'فتح وردية',
      close_shift: 'إغلاق وردية',
      create_invoice: 'إنشاء فاتورة',
      delete_invoice: 'حذف فاتورة',
      edit_measurements: 'تعديل مقاسات',
      delete_order: 'حذف طلب',
      add_supplier: 'إضافة مورد',
      adjust_inventory: 'تسوية مخزون',
      print_invoice: 'طباعة فاتورة',
      manual_price_edit: 'إضافة خصم'
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
    <div className="space-y-6 font-sans" style={{ fontFamily: 'IBM Plex Sans, sans-serif' }}>
      
      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="relative">
          <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
          <input 
            type="text"
            placeholder="بحث بالإسم أو العملية..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-surface border border-border rounded-xl py-3 pr-12 pl-4 text-content outline-none focus:border-brand transition-colors"
          />
        </div>
        <div className="relative">
          <Calendar className="absolute right-4 top-1/2 -translate-y-1/2 text-content-muted" size={20} />
          <input 
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="w-full bg-surface border border-border rounded-xl py-3 pr-12 pl-4 text-content outline-none focus:border-brand transition-colors"
          />
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-surface rounded-2xl border border-border overflow-x-auto whitespace-nowrap scrollbar-hide">
        <table className="w-full text-right text-sm min-w-max">
          <thead className="bg-surface-muted border-b border-border text-content-muted uppercase tracking-widest text-[10px] font-black">
            <tr>
              <th className="p-4">الوقت</th>
              <th className="p-4">الموظف</th>
              <th className="p-4">الفرع</th>
              <th className="p-4">العملية</th>
              <th className="p-4">التفاصيل</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border text-content-muted">
            {filteredLogs.map(log => {
              const isDeleted = log.action.includes('delete');
              return (
                <tr key={log.id} className="hover:bg-surface-muted/50 transition-colors">
                  <td className="p-4" dir="ltr">
                    <span className="font-mono font-bold text-content">{new Date(log.timestamp).toLocaleTimeString('ar-SA')}</span>
                    <br />
                    <span className="text-[10px]">{new Date(log.timestamp).toLocaleDateString('ar-SA')}</span>
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
                <td colSpan={5} className="p-8 text-center text-content-muted font-bold">لا توجد سجلات نشاط للبحث المحدد</td>
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
