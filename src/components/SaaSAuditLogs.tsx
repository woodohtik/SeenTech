import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase/client';
import { 
  Shield, 
  Clock, 
  User, 
  Activity, 
  AlertCircle, 
  Search,
  Filter,
  Download,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { SmartSelect } from './ui/SmartSelect';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';

interface AuditLog {
  id: string;
  action: string;
  performedBy: string;
  performedByEmail: string;
  targetTenantId?: string;
  details: string;
  type: 'login' | 'deletion' | 'update' | 'security_alert';
  timestamp: string;
}

export default function SaaSAuditLogs() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('all');

  useEffect(() => {
    const fetchLogs = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('saas_security_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      
      if (data) {
        setLogs(data.map(log => ({
          id: log.id,
          action: log.action,
          performedBy: log.user_id,
          performedByEmail: log.user_email,
          details: log.details,
          type: log.action.includes('security') ? 'security_alert' : 
                log.action.includes('delete') ? 'deletion' :
                log.action.includes('login') ? 'login' : 'update',
          timestamp: log.created_at
        } as AuditLog)));
      }
      setLoading(false);
    };

    fetchLogs();

    const channel = supabase
      .channel('saas_security_logs_changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'saas_security_logs' }, (payload) => {
        const newLog = payload.new as any;
        setLogs(prev => [{
          id: newLog.id,
          action: newLog.action,
          performedBy: newLog.user_id,
          performedByEmail: newLog.user_email,
          details: newLog.details,
          type: newLog.action.includes('security') ? 'security_alert' : 
                newLog.action.includes('delete') ? 'deletion' :
                newLog.action.includes('login') ? 'login' : 'update',
          timestamp: newLog.created_at
        } as AuditLog, ...prev].slice(0, 100));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const filteredLogs = logs.filter(log => {
    const matchesSearch = 
      log.performedByEmail.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.details.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.action.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesType = filterType === 'all' || log.type === filterType;
    
    return matchesSearch && matchesType;
  });

  const getLogIcon = (type: string) => {
    switch (type) {
      case 'security_alert': return <AlertCircle className="text-rose-600" size={20} />;
      case 'deletion': return <Activity className="text-amber-600" size={20} />;
      case 'login': return <Shield className="text-indigo-600" size={20} />;
      default: return <Activity className="text-gray-600" size={20} />;
    }
  };

  const getLogBg = (type: string) => {
    switch (type) {
      case 'security_alert': return 'bg-rose-50';
      case 'deletion': return 'bg-amber-50';
      case 'login': return 'bg-indigo-50';
      default: return 'bg-gray-50';
    }
  };

  return (
    <div className="space-y-8 font-sans" dir="rtl">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-3xl font-black text-gray-900">سجل التدقيق الأمني (Audit Logs)</h2>
          <p className="text-gray-500 font-bold mt-1">تتبع كافة العمليات الحساسة التي تتم في النظام</p>
        </div>
        <button className="flex items-center gap-2 px-6 py-3 bg-white border border-gray-200 text-gray-700 rounded-2xl font-bold hover:bg-gray-50 transition-all shadow-sm">
          <Download size={18} />
          <span>تصدير السجل</span>
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white p-6 rounded-[2.5rem] border border-gray-100 shadow-sm flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input 
            type="text"
            placeholder="البحث في السجلات..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pr-12 pl-4 py-3 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-indigo-500 font-bold"
          />
        </div>
        <div className="flex gap-2 w-full md:w-48">
          <SmartSelect 
            value={filterType}
            onChange={setFilterType}
            options={[
              { value: 'all', label: 'كافة الأنواع' },
              { value: 'login', label: 'تسجيل الدخول' },
              { value: 'deletion', label: 'عمليات الحذف' },
              { value: 'update', label: 'التحديثات' },
              { value: 'security_alert', label: 'تنبيهات أمنية' },
            ]}
            className="px-6 py-3 bg-gray-50 border-none rounded-2xl font-bold min-h-[44px] shadow-none"
          />
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-x-auto whitespace-nowrap scrollbar-hide">
        <table className="w-full text-right min-w-max">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs font-black uppercase tracking-wider">
                <th className="px-8 py-5">العملية</th>
                <th className="px-8 py-5">بواسطة</th>
                <th className="px-8 py-5">التفاصيل</th>
                <th className="px-8 py-5">التوقيت</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-8 py-20 text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
                  </td>
                </tr>
              ) : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-8 py-20 text-center">
                    <p className="text-gray-400 font-bold">لا توجد سجلات مطابقة للبحث</p>
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50 transition-colors group">
                    <td className="px-8 py-6">
                      <div className="flex items-center gap-3">
                        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", getLogBg(log.type))}>
                          {getLogIcon(log.type)}
                        </div>
                        <div>
                          <div className="font-bold text-gray-900">{log.action}</div>
                          <div className="text-[10px] text-gray-400 font-black uppercase tracking-widest">{log.type}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center text-gray-500">
                          <User size={16} />
                        </div>
                        <div className="text-sm font-bold text-gray-700">{log.performedByEmail}</div>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <p className="text-sm text-gray-600 font-medium max-w-md truncate" title={log.details}>
                        {log.details}
                      </p>
                    </td>
                    <td className="px-8 py-6">
                      <div className="flex items-center gap-2 text-gray-500 text-xs font-bold">
                        <Clock size={14} />
                        {new Date(log.timestamp).toLocaleString('ar-SA')}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
    </div>
  );
}
