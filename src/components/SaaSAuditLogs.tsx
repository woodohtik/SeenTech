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
  Download
} from 'lucide-react';
import { AdminIconInput } from './ui/AdminIconInput';
import { AdminIconSelect } from './ui/AdminIconSelect';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';
import { useTranslation } from 'react-i18next';

import { isRtlLang } from '../lib/direction';

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
  const { t, i18n } = useTranslation();
  const isRtl = isRtlLang(i18n.language);

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
          performedBy: log.performed_by_uid,
          performedByEmail: log.performed_by_email,
          details: log.details,
          type: log.action.includes('security') ? 'security_alert' : 
                log.action.includes('delete') ? 'deletion' :
                log.action.includes('login') ? 'login' : 'update',
          timestamp: log.created_at || log.occurred_at
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
          performedBy: newLog.performed_by_uid,
          performedByEmail: newLog.performed_by_email,
          details: newLog.details,
          type: newLog.action.includes('security') ? 'security_alert' : 
                newLog.action.includes('delete') ? 'deletion' :
                newLog.action.includes('login') ? 'login' : 'update',
          timestamp: newLog.created_at || newLog.occurred_at
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
    <div className="space-y-8 font-sans" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-3xl font-black text-gray-900">{t('saas.audit_logs_title')}</h2>
          <p className="text-gray-500 font-bold mt-1">{t('saas.audit_logs_subtitle')}</p>
        </div>
        <button className="flex items-center gap-2 px-6 py-3 bg-white border border-gray-200 text-gray-700 rounded-2xl font-bold hover:bg-gray-50 transition-all shadow-sm cursor-pointer">
          <Download size={18} />
          <span>{t('saas.export_logs')}</span>
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white p-6 rounded-[2.5rem] border border-gray-100 shadow-sm flex flex-col md:flex-row gap-4">
        <div className="flex-1">
          <AdminIconInput 
            type="text"
            placeholder={t('saas.search_logs_placeholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            startIcon={Search}
          />
        </div>
        <div className="flex gap-2 w-full md:w-56">
          <AdminIconSelect 
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            startIcon={Filter}
            className="w-full"
          >
            <option value="all">{t('saas.filter_type_all')}</option>
            <option value="login">{t('saas.filter_type_login')}</option>
            <option value="deletion">{t('saas.filter_type_deletion')}</option>
            <option value="update">{t('saas.filter_type_update')}</option>
            <option value="security_alert">{t('saas.filter_type_security_alert')}</option>
          </AdminIconSelect>
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-x-auto whitespace-nowrap scrollbar-hide">
        <table className="w-full text-right rtl:text-right ltr:text-left min-w-max">
          <thead>
            <tr className="bg-gray-50 text-gray-500 text-xs font-black uppercase tracking-wider">
              <th className="px-8 py-5 text-right rtl:text-right ltr:text-left">{t('saas.action_performed')}</th>
              <th className="px-8 py-5 text-right rtl:text-right ltr:text-left">{t('saas.performed_by')}</th>
              <th className="px-8 py-5 text-right rtl:text-right ltr:text-left">{t('saas.details')}</th>
              <th className="px-8 py-5 text-right rtl:text-right ltr:text-left">{t('saas.timestamp')}</th>
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
                  <p className="text-gray-400 font-bold">{t('saas.no_logs_found')}</p>
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
                      <div className="text-right rtl:text-right ltr:text-left">
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
                      <span>
                        {new Date(log.timestamp).toLocaleString(
                          i18n.language === 'en' ? 'en-US' : i18n.language === 'ur' ? 'ur-PK-u-nu-latn' : 'ar-SA-u-nu-latn'
                        )}
                      </span>
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
