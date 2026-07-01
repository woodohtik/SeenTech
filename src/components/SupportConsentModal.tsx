import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase/client';
import { useAuth } from '../contexts/AuthContext';
import { motion, AnimatePresence } from 'motion/react';
import { ShieldAlert, Check, X, Shield } from 'lucide-react';
import { SupportAccessRequest } from '../types/supabase';

interface Props {
  tenantId: string;
}

export default function SupportConsentModal({ tenantId }: Props) {
  const [requests, setRequests] = useState<SupportAccessRequest[]>([]);
  const { dbUser } = useAuth();
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
      
    // Polling fallback
    const interval = setInterval(fetchPendingRequests, 10000);

    return () => {
      subscription.unsubscribe();
      clearInterval(interval);
    };
  }, [tenantId, isAuthorizedToApprove]);

  const fetchPendingRequests = async () => {
    const { data, error } = await supabase
        .from('support_access_requests')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('status', 'pending');

    if (!error && data) {
      setRequests(data);
    }
  };

  const handleRespond = async (requestId: string, status: 'approved' | 'rejected') => {
    // Optimistic UI
    setRequests(prev => prev.filter(r => r.id !== requestId));
    
    await supabase
        .from('support_access_requests')
        .update({ 
          status,
          responded_at: new Date().toISOString()
        })
        .eq('id', requestId);
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
              className="bg-surface rounded-[2rem] border border-border shadow-2xl overflow-hidden"
            >
              <div className="p-6 text-center border-b border-border bg-surface-muted flex flex-col items-center">
                 <div className="w-16 h-16 bg-brand/10 text-brand flex items-center justify-center rounded-full mb-4 relative overflow-hidden">
                   <ShieldAlert size={32} />
                   <div className="absolute inset-0 bg-brand/20 animate-ping rounded-full"></div>
                 </div>
                 <h3 className="text-xl font-black text-content">طلب إذن دخول للصيانة</h3>
              </div>
              <div className="p-6">
                <p className="text-content-muted leading-relaxed text-center mb-6 font-bold">
                  موظف الدعم الفني <span className="text-content font-black bg-surface-muted px-2 py-1 rounded mx-1">{request.saas_user_name}</span> يطلب إذن الدخول إلى نظامك لإجراء أعمال الصيانة وحل المشكلات.
                </p>
                <div className="flex gap-4">
                  <button
                    onClick={() => handleRespond(request.id, 'approved')}
                    className="flex-1 bg-success text-white py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-success/90 transition-all shadow-lg shadow-success/20"
                  >
                    <Check size={20} />
                    موافقة مؤقتة
                  </button>
                  <button
                    onClick={() => handleRespond(request.id, 'rejected')}
                    className="flex-1 bg-surface-muted border border-border text-content py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-border transition-all"
                  >
                    <X size={20} />
                    رفض
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
