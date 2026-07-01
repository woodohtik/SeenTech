import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase/client';
import { SupportSession } from '../types/supabase';
import { Shield, Clock, Search, X } from 'lucide-react';

interface Props {
  tenantId: string;
}

export default function TenantSupportHistory({ tenantId }: Props) {
  const [sessions, setSessions] = useState<SupportSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (tenantId) fetchSessions();
  }, [tenantId]);

  const fetchSessions = async () => {
    setLoading(true);
    // Explicit sessions only for the tenant to see. Mute stealth logic explicitly here.
    const { data, error } = await supabase
      .from('support_sessions')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('access_type', 'explicit')
      .order('started_at', { ascending: false });

    if (!error && data) {
      setSessions(data);
    } else {
      // Mock Data if table doesn't exist
      setSessions([
        {
          id: 'mock',
          tenant_id: tenantId,
          saas_user_id: 'mock-user',
          saas_user_name: 'دعم سين',
          access_type: 'explicit',
          started_at: new Date().toISOString(),
          ended_at: null,
          duration_minutes: null
        }
      ] as any);
    }
    setLoading(false);
  };

  const getDuration = (start: string, end: string | null, minutesRecord: number | null) => {
    if (minutesRecord !== null) return `${minutesRecord} دقيقة`;
    if (!end) return 'نشط الآن (Active)';
    const ms = new Date(end).getTime() - new Date(start).getTime();
    return `${Math.ceil(ms / 60000)} دقيقة`;
  };

  return (
    <div className="bg-surface rounded-2xl border border-border p-6 mt-6 shadow-sm">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 rounded-xl bg-brand/10 text-brand flex items-center justify-center">
          <Shield size={24} />
        </div>
        <div>
          <h2 className="text-xl font-black text-content">سجل زيارات الدعم الفني</h2>
          <p className="text-sm font-bold text-content-muted mt-1">تاريخ دخول موظفي النظام لحسابك بغرض الصيانة والدعم</p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center p-8"><div className="animate-spin rounded-full border-b-2 border-brand w-8 h-8"></div></div>
      ) : sessions.length === 0 ? (
        <div className="text-center p-8 bg-surface-muted rounded-xl border border-border">
          <Shield className="mx-auto mb-3 opacity-20" size={48} />
          <p className="font-bold text-content-muted">لم يتم تسجيل أي زيارات دخول للصيانة</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map(session => {
            const isActive = !session.ended_at;
            return (
              <div key={session.id} className={`flex items-center justify-between p-4 rounded-xl border ${isActive ? 'bg-brand/5 border-brand/20 shadow-sm' : 'bg-surface border-border'}`}>
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${isActive ? 'bg-brand text-white shadow-lg shadow-brand/20 animate-pulse' : 'bg-surface-muted text-content-muted'}`}>
                    {session.saas_user_name.charAt(0)}
                  </div>
                  <div>
                    <h3 className="font-black text-content flex items-center gap-2">
                      {session.saas_user_name}
                      {isActive && <span className="bg-success text-white text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider animate-pulse">نشط الآن</span>}
                    </h3>
                    <p className="text-xs text-content-muted font-bold flex items-center gap-1 mt-1">
                      <Clock size={12} />
                      {new Date(session.started_at).toLocaleDateString('ar-SA')} - {new Date(session.started_at).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
                <div className="text-left font-mono text-sm font-bold bg-surface-muted px-3 py-1.5 rounded-lg border border-border text-content">
                  {getDuration(session.started_at, session.ended_at, session.duration_minutes)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
