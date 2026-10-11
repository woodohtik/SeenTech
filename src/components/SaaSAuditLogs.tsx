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
import { IconInput } from './ui/IconInput';
import { SmartSelect } from './ui/SmartSelect';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';
import { useTranslation } from 'react-i18next';
import { useToast } from '../contexts/ToastContext';

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

// audit_logs لديه عمود type صريح (enum: deletion/security/system) -- أدق من
// تخمين النوع عبر فحص نص action كما تفعل saas_security_logs (لا عمود type
// حقيقي لها، فقط action نصي حر). بادئة id مختلفة لكل مصدر لأن كلا الجدولين
// BIGSERIAL مستقل، فقد تتطابق قيم id بينهما بلا هذه البادئة.
function mapAuditLogRow(d: any): AuditLog {
  return {
    id: `audit-${d.id}`,
    action: d.action,
    performedBy: d.performed_by,
    performedByEmail: d.performed_by_email,
    targetTenantId: d.target_tenant_id,
    details: d.details,
    type: d.type === 'security' ? 'security_alert' : d.type === 'deletion' ? 'deletion' : 'update',
    timestamp: d.occurred_at,
  };
}

function mapSecurityLogRow(d: any): AuditLog {
  return {
    id: `sec-${d.id}`,
    action: d.action,
    performedBy: d.user_id,
    performedByEmail: d.user_email,
    details: d.details,
    type: d.action?.includes('security') ? 'security_alert' :
          d.action?.includes('delete') ? 'deletion' :
          d.action?.includes('login') ? 'login' : 'update',
    timestamp: d.occurred_at,
  };
}

export default function SaaSAuditLogs() {
  const { t, i18n } = useTranslation();
  const isRtl = isRtlLang(i18n.language);
  const { handleError } = useToast();

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('all');

  useEffect(() => {
    // الأفعال الحساسة فعلياً (تعليق/تفعيل تاجر، تبديل المساعد الذكي، أدوار
    // عامة، صلاحيات موظف SaaS) تُكتَب في audit_logs، بينما الدخول/الخروج
    // وتغيير كلمة المرور تُكتَب في saas_security_logs منفصل -- قبل هذا
    // التعديل كانت هذه الشاشة تعرض الثاني فقط، فلا تظهر فيها أهم الأفعال
    // إطلاقاً رغم كتابتها بنجاح. دمج المصدرين هنا بدل اختيار أحدهما.
    const fetchLogs = async () => {
      setLoading(true);
      const [
        { data: auditData, error: auditError },
        { data: securityData, error: securityError }
      ] = await Promise.all([
        supabase.from('audit_logs').select('*').order('occurred_at', { ascending: false }).limit(100),
        supabase.from('saas_security_logs').select('*').order('occurred_at', { ascending: false }).limit(100),
      ]);

      if (auditError && securityError) {
        handleError(auditError, t('saas.audit_logs_load_failed', 'تعذّر تحميل سجلات التدقيق'));
        setLoading(false);
        return;
      }

      const merged = [
        ...(auditData || []).map(mapAuditLogRow),
        ...(securityData || []).map(mapSecurityLogRow),
      ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 100);

      setLogs(merged);
      setLoading(false);
    };

    fetchLogs();

    const channel = supabase
      .channel('saas_audit_logs_changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_logs' }, (payload) => {
        setLogs(prev => [mapAuditLogRow(payload.new as any), ...prev].slice(0, 100));
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'saas_security_logs' }, (payload) => {
        setLogs(prev => [mapSecurityLogRow(payload.new as any), ...prev].slice(0, 100));
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
      case 'security_alert': return <AlertCircle className="text-danger" size={20} />;
      case 'deletion': return <Activity className="text-warning" size={20} />;
      case 'login': return <Shield className="text-info" size={20} />;
      default: return <Activity className="text-content-muted" size={20} />;
    }
  };

  const getLogBg = (type: string) => {
    switch (type) {
      case 'security_alert': return 'bg-danger/10';
      case 'deletion': return 'bg-warning/10';
      case 'login': return 'bg-info/10';
      default: return 'bg-surface-muted';
    }
  };

  return (
    <div className="space-y-8 font-sans" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-3xl font-black text-content">{t('saas.audit_logs_title')}</h2>
          <p className="text-content-muted font-bold mt-1">{t('saas.audit_logs_subtitle')}</p>
        </div>
        <button className="flex items-center gap-2 px-6 py-3 bg-surface border border-border text-content rounded-2xl font-bold hover:bg-surface-muted transition-all shadow-sm cursor-pointer">
          <Download size={18} />
          <span>{t('saas.export_logs')}</span>
        </button>
      </div>

      {/* Filters */}
      <div className="bg-surface p-6 rounded-[2.5rem] border border-border shadow-sm flex flex-col md:flex-row gap-4">
        <div className="flex-1">
          <IconInput 
            type="text"
            placeholder={t('saas.search_logs_placeholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            startIcon={Search}
          />
        </div>
        <div className="flex gap-2 w-full md:w-56">
          <SmartSelect
            value={filterType}
            onChange={setFilterType}
            startIcon={Filter}
            className="w-full"
            options={[
              { value: 'all', label: t('saas.filter_type_all') },
              { value: 'login', label: t('saas.filter_type_login') },
              { value: 'deletion', label: t('saas.filter_type_deletion') },
              { value: 'update', label: t('saas.filter_type_update') },
              { value: 'security_alert', label: t('saas.filter_type_security_alert') },
            ]}
          />
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-surface rounded-[2.5rem] border border-border shadow-sm overflow-x-auto whitespace-nowrap scrollbar-hide">
        <table className="w-full text-right rtl:text-right ltr:text-left min-w-max">
          <thead>
            <tr className="bg-surface-muted text-content-muted text-xs font-black uppercase tracking-wider">
              <th className="px-8 py-5 text-right rtl:text-right ltr:text-left">{t('saas.action_performed')}</th>
              <th className="px-8 py-5 text-right rtl:text-right ltr:text-left">{t('saas.performed_by')}</th>
              <th className="px-8 py-5 text-right rtl:text-right ltr:text-left">{t('saas.details')}</th>
              <th className="px-8 py-5 text-right rtl:text-right ltr:text-left">{t('saas.timestamp')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr>
                <td colSpan={4} className="px-8 py-20 text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand mx-auto"></div>
                </td>
              </tr>
            ) : filteredLogs.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-8 py-20 text-center">
                  <p className="text-content-muted font-bold">{t('saas.no_logs_found')}</p>
                </td>
              </tr>
            ) : (
              filteredLogs.map((log) => (
                <tr key={log.id} className="hover:bg-surface-muted transition-colors group">
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-3">
                      <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", getLogBg(log.type))}>
                        {getLogIcon(log.type)}
                      </div>
                      <div className="text-right rtl:text-right ltr:text-left">
                        <div className="font-bold text-content">{log.action}</div>
                        <div className="text-[10px] text-content-muted font-black uppercase tracking-widest">{log.type}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-surface-muted rounded-lg flex items-center justify-center text-content-muted">
                        <User size={16} />
                      </div>
                      <div className="text-sm font-bold text-content">{log.performedByEmail}</div>
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <p className="text-sm text-content-muted font-medium max-w-md truncate" title={log.details}>
                      {log.details}
                    </p>
                  </td>
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-2 text-content-muted text-xs font-bold">
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
