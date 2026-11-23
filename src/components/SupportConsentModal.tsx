import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase/client';
import { useAuth } from '../contexts/AuthContext';
import { motion, AnimatePresence } from 'motion/react';
import { ShieldAlert, Check, X, Shield } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SupportAccessRequest } from '../types/supabase';
import { useToast } from '../contexts/ToastContext';

interface Props {
  tenantId: string;
}

export default function SupportConsentModal({ tenantId }: Props) {
  const { t } = useTranslation();
  const { handleError } = useToast();
  const [requests, setRequests] = useState<SupportAccessRequest[]>([]);
  const { dbUser } = useAuth();
  // fetchPendingRequests polls every 3s -- without this, a sustained outage
  // would toast the same failure every 3 seconds forever. One toast per
  // mount is enough to inform the admin without spamming them.
  const hasWarnedFetchFailureRef = useRef(false);
  const userRole = dbUser?.role;
  
  // This is for tenant owners/admins only
  const isAuthorizedToApprove = userRole === 'owner' || userRole === 'admin';

  useEffect(() => {
    if (!tenantId || !isAuthorizedToApprove) return;

    fetchPendingRequests();

    // In a real app we would use realtime subscription here, but we will poll to be safe + simple if RLS allows
    const subscription = supabase
      .channel('support_access_requests')
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'support_access_requests',
        filter: `tenant_id=eq.${tenantId}`
      }, payload => {
         if (payload.new.status === 'pending') {
           setRequests(prev => [...prev, payload.new as SupportAccessRequest]);
         }
      })
      .on('postgres_changes', { 
        event: 'UPDATE', 
        schema: 'public', 
        table: 'support_access_requests',
        filter: `tenant_id=eq.${tenantId}`
      }, payload => {
         if (payload.new.status !== 'pending') {
           setRequests(prev => prev.filter(req => req.id !== payload.new.id));
         }
      })
      .subscribe();
      
    // Fallback for a dropped Realtime connection: every 60 seconds while
    // the tab is visible. It used to poll every 3 seconds from every open
    // tab, hidden or not (seen-performance-first-open-login-task.md
    // Phase 5); new requests arrive through the channel above within a
    // moment.
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') fetchPendingRequests();
    }, 60_000);

    return () => {
      subscription.unsubscribe();
      window.clearInterval(interval);
    };
  }, [tenantId, isAuthorizedToApprove]);

  const fetchPendingRequests = async () => {
    // P6 (SECURITY-11): the shop's owner reads its own requests (RLS).
    const { data, error } = await supabase
      .from('support_access_requests')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString());
    if (error) {
      if (!hasWarnedFetchFailureRef.current) {
        hasWarnedFetchFailureRef.current = true;
        handleError(error, t('support_consent.fetch_requests_failed', 'تعذّر تحميل طلبات صلاحية الدعم'));
      }
      return;
    }
    setRequests(data || []);
  };

  const handleRespond = async (requestId: string, status: 'approved' | 'rejected') => {
    setRequests(prev => prev.filter(r => r.id !== requestId));
    const { error } = await supabase.rpc('respond_support_access_request', {
      p_request_id: requestId,
      p_approve: status === 'approved',
    });
    if (error) {
      handleError(error, t('support_consent.respond_failed', 'تعذّر تسجيل ردّك على طلب صلاحية الدعم — حاول مرة أخرى'));
      fetchPendingRequests();
    }
  };

  if (requests.length === 0) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
        <div className="space-y-4 w-full max-w-md">
          {requests.map((request) => (
            <motion.div
              key={request.id}
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-surface rounded-3xl border border-border shadow-2xl overflow-hidden"
            >
              <div className="p-6 text-center border-b border-border bg-surface-muted flex flex-col items-center">
                 <div className="w-16 h-16 bg-brand/10 text-brand flex items-center justify-center rounded-full mb-4 relative overflow-hidden">
                   <ShieldAlert size={32} />
                   <div className="absolute inset-0 bg-brand/20 animate-ping rounded-full"></div>
                 </div>
                 <h3 className="text-xl font-black text-content">{t('saas.support_access_request_title')}</h3>
              </div>
              <div className="p-6">
                <p className="text-content-muted leading-relaxed text-center mb-6 font-bold">
                  {t('saas.support_access_request_desc', { name: request.saas_user_name })}
                </p>
                <div className="flex gap-4">
                  <button
                    onClick={() => handleRespond(request.id, 'approved')}
                    className="flex-1 bg-success text-white py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-success/90 transition-all shadow-lg shadow-success/20"
                  >
                    <Check size={20} />
                    {t('saas.support_access_approve_temporarily')}
                  </button>
                  <button
                    onClick={() => handleRespond(request.id, 'rejected')}
                    className="flex-1 bg-surface-muted border border-border text-content py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-border transition-all"
                  >
                    <X size={20} />
                    {t('saas.reject')}
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </AnimatePresence>
  );
}
