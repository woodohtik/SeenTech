import React, { useState, useEffect } from 'react';
import { 
  CreditCard, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  FileText, 
  Eye, 
  Download, 
  Sparkles, 
  RefreshCw, 
  Search, 
  Filter, 
  Building2, 
  Mail, 
  ShieldCheck, 
  X,
  AlertCircle
} from 'lucide-react';
import { PriceDisplay } from './PriceDisplay';
import { 
  fetchSubscriptionRequests, 
  approveSubscriptionRequest, 
  rejectSubscriptionRequest, 
  SubscriptionRequest 
} from '../services/subscriptionRequestService';
import { useDirection } from '../lib/direction';

export default function SubscriptionRequestsAdminManager() {
  const { t, locale } = useDirection();
  const [requests, setRequests] = useState<SubscriptionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Modal for viewing proof of payment image
  const [selectedProofUrl, setSelectedProofUrl] = useState<string | null>(null);
  
  // Action state
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectingReq, setRejectingReq] = useState<SubscriptionRequest | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const loadRequests = async () => {
    setLoading(true);
    try {
      const data = await fetchSubscriptionRequests();
      setRequests(data);
    } catch (e) {
      console.error('Failed to load subscription requests:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRequests();
    const handleUpdate = () => loadRequests();
    window.addEventListener('subscription_request_updated', handleUpdate);
    return () => window.removeEventListener('subscription_request_updated', handleUpdate);
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const handleApprove = async (req: SubscriptionRequest) => {
    if (!confirm(t('subscription.requests.approve_confirm', { plan: req.plan_name, tenant: req.tenant_name || req.tenant_id }))) {
      return;
    }
    setProcessingId(req.id);
    try {
      await approveSubscriptionRequest(req.id, req.tenant_id, req.plan_id);
      showToast(t('subscription.requests.approve_success', { plan: req.plan_name }));
      await loadRequests();
    } catch (err: any) {
      alert(t('subscription.requests.approve_error', { error: err.message || err }));
    } finally {
      setProcessingId(null);
    }
  };

  const handleConfirmReject = async () => {
    if (!rejectingReq) return;
    setProcessingId(rejectingReq.id);
    try {
      await rejectSubscriptionRequest(rejectingReq.id, rejectionReason.trim() || t('subscription.requests.default_rejection_reason'));
      showToast(t('subscription.requests.reject_success'));
      setRejectingReq(null);
      setRejectionReason('');
      await loadRequests();
    } catch (err: any) {
      alert(t('subscription.requests.reject_error', { error: err.message || err }));
    } finally {
      setProcessingId(null);
    }
  };

  const filteredRequests = requests.filter(req => {
    const matchesStatus = filterStatus === 'all' || req.status === filterStatus;
    const query = searchQuery.toLowerCase().trim();
    const matchesSearch = !query || 
      (req.tenant_name && req.tenant_name.toLowerCase().includes(query)) ||
      (req.tenant_email && req.tenant_email.toLowerCase().includes(query)) ||
      (req.reference_no && req.reference_no.toLowerCase().includes(query)) ||
      (req.plan_name && req.plan_name.toLowerCase().includes(query));
    return matchesStatus && matchesSearch;
  });

  const pendingCount = requests.filter(r => r.status === 'pending').length;
  const approvedCount = requests.filter(r => r.status === 'approved').length;
  const rejectedCount = requests.filter(r => r.status === 'rejected').length;

  return (
    <div className="space-y-6 w-full">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white px-6 py-3 rounded-2xl shadow-2xl text-xs sm:text-sm font-black flex items-center gap-3 border border-brand/30 animate-bounce">
          <Sparkles size={18} className="text-amber-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header Metrics Panel */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-surface p-6 rounded-3xl border border-border shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-black text-content-muted uppercase tracking-wider mb-1">{t('subscription.requests.pending_count_label')}</p>
            <p className="text-3xl font-black text-amber-500">{pendingCount}</p>
          </div>
          <div className="p-4 bg-amber-500/10 text-amber-600 rounded-2xl">
            <Clock size={28} />
          </div>
        </div>

        <div className="bg-surface p-6 rounded-3xl border border-border shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-black text-content-muted uppercase tracking-wider mb-1">{t('subscription.requests.approved_count_label')}</p>
            <p className="text-3xl font-black text-emerald-600">{approvedCount}</p>
          </div>
          <div className="p-4 bg-emerald-500/10 text-emerald-600 rounded-2xl">
            <CheckCircle2 size={28} />
          </div>
        </div>

        <div className="bg-surface p-6 rounded-3xl border border-border shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-black text-content-muted uppercase tracking-wider mb-1">{t('subscription.requests.rejected_count_label')}</p>
            <p className="text-3xl font-black text-rose-500">{rejectedCount}</p>
          </div>
          <div className="p-4 bg-rose-500/10 text-rose-600 rounded-2xl">
            <XCircle size={28} />
          </div>
        </div>
      </div>

      {/* Control Bar: Search & Status Filters */}
      <div className="bg-surface p-4 sm:p-6 rounded-3xl border border-border shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto pb-2 md:pb-0 scrollbar-none">
          <button
            onClick={() => setFilterStatus('pending')}
            className={`px-5 py-2.5 rounded-2xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer shrink-0 ${
              filterStatus === 'pending'
                ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/20'
                : 'bg-surface-muted text-content-muted hover:text-content'
            }`}
          >
            <Clock size={16} />
            <span>{t('inventory.status_pending')}</span>
            {pendingCount > 0 && (
              <span className="bg-white/20 text-white px-2 py-0.5 rounded-full text-[10px] font-black">
                {pendingCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setFilterStatus('all')}
            className={`px-5 py-2.5 rounded-2xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer shrink-0 ${
              filterStatus === 'all'
                ? 'bg-brand text-white shadow-lg shadow-brand/20'
                : 'bg-surface-muted text-content-muted hover:text-content'
            }`}
          >
            <span>{t('dashboard.all_orders')} ({requests.length})</span>
          </button>

          <button
            onClick={() => setFilterStatus('approved')}
            className={`px-5 py-2.5 rounded-2xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer shrink-0 ${
              filterStatus === 'approved'
                ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20'
                : 'bg-surface-muted text-content-muted hover:text-content'
            }`}
          >
            <CheckCircle2 size={16} />
            <span>{t('subscription.requests.filter_approved')} ({approvedCount})</span>
          </button>

          <button
            onClick={() => setFilterStatus('rejected')}
            className={`px-5 py-2.5 rounded-2xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer shrink-0 ${
              filterStatus === 'rejected'
                ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/20'
                : 'bg-surface-muted text-content-muted hover:text-content'
            }`}
          >
            <XCircle size={16} />
            <span>{t('subscription.requests.filter_rejected')} ({rejectedCount})</span>
          </button>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <Search size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-content-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('subscription.requests.search_placeholder')}
              className="w-full pr-10 pl-4 py-2.5 bg-surface-muted border border-border rounded-2xl text-xs font-bold text-content focus:border-brand focus:outline-none"
            />
          </div>

          <button
            onClick={loadRequests}
            className="p-2.5 bg-surface-muted hover:bg-border rounded-2xl text-content-muted hover:text-content transition-all cursor-pointer"
            title={t('subscription.requests.refresh_list')}
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Requests List */}
      <div className="bg-surface rounded-3xl border border-border shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-content-muted flex flex-col items-center gap-3">
            <RefreshCw size={28} className="animate-spin text-brand" />
            <p className="text-xs font-bold">{t('subscription.requests.loading')}</p>
          </div>
        ) : filteredRequests.length === 0 ? (
          <div className="p-12 text-center text-content-muted space-y-3">
            <div className="w-16 h-16 bg-surface-muted rounded-full flex items-center justify-center mx-auto text-content-muted">
              <FileText size={28} />
            </div>
            <p className="text-base font-black text-content">{t('subscription.requests.empty_title')}</p>
            <p className="text-xs font-bold max-w-sm mx-auto">
              {t('subscription.requests.empty_desc')}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filteredRequests.map((req) => (
              <div key={req.id} className="p-6 hover:bg-surface-muted/40 transition-all flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
                {/* Left side info */}
                <div className="space-y-3 flex-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-lg font-black text-content flex items-center gap-2">
                      <Building2 size={18} className="text-brand" />
                      {req.tenant_name || t('saas.default_subscriber_name')}
                    </span>

                    {/* Status Badge */}
                    {req.status === 'pending' && (
                      <span className="px-3 py-1 bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20 rounded-full text-xs font-black flex items-center gap-1.5 animate-pulse">
                        <Clock size={12} />
                        {t('referral.withdrawal.pending')}
                      </span>
                    )}
                    {req.status === 'approved' && (
                      <span className="px-3 py-1 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 rounded-full text-xs font-black flex items-center gap-1.5">
                        <CheckCircle2 size={12} />
                        {t('subscription.requests.status_approved_active')}
                      </span>
                    )}
                    {req.status === 'rejected' && (
                      <span className="px-3 py-1 bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/20 rounded-full text-xs font-black flex items-center gap-1.5">
                        <XCircle size={12} />
                        {t('referral.withdrawal.approved')}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs font-bold text-content-muted">
                    <div className="flex items-center gap-1.5">
                      <Mail size={14} className="text-content-muted" />
                      <span>{t('subscription.requests.email')}: <span className="text-content">{req.tenant_email || t('common.not_available')}</span></span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <CreditCard size={14} className="text-content-muted" />
                      <span>{t('common.method')}: <span className="text-brand font-black">{req.payment_method === 'bank_transfer' ? t('billing.modal_method_bank') : req.payment_method === 'card' ? t('billing.payment_method_card') : t('subscription.requests.method_cash_direct')}</span></span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <Clock size={14} className="text-content-muted" />
                      <span>{t('common.date')}: <span className="text-content">{new Date(req.created_at).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-4 text-xs font-bold bg-surface-muted/60 p-3 rounded-2xl border border-border/60">
                    <div>
                      <span>{t('subscription.requests.requested_plan')}: </span>
                      <span className="text-content font-black">{req.plan_name}</span>
                    </div>
                    <span>•</span>
                    <div>
                      <span>{t('common.amount')}: </span>
                      <span className="text-emerald-600 font-black dir-ltr inline-block">
                        <PriceDisplay amount={req.amount} />
                      </span>
                    </div>
                    {req.reference_no && (
                      <>
                        <span>•</span>
                        <div>
                          <span>{t('subscription.requests.reference_no')}: </span>
                          <span className="text-brand font-mono">{req.reference_no}</span>
                        </div>
                      </>
                    )}
                    {req.notes && (
                      <>
                        <span>•</span>
                        <div className="text-content-muted truncate max-w-xs">
                          <span>{t('subscription.requests.note')}: </span>
                          <span>"{req.notes}"</span>
                        </div>
                      </>
                    )}
                  </div>

                  {req.rejection_reason && (
                    <p className="text-xs font-bold text-rose-600 bg-rose-500/5 p-2.5 rounded-xl border border-rose-500/20">
                      {t('subscription.requests.rejection_reason_value', { reason: req.rejection_reason })}
                    </p>
                  )}
                </div>

                {/* Right side actions & proof button */}
                <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 w-full lg:w-auto shrink-0 justify-end">
                  {/* Proof of Payment Button */}
                  {req.proof_url ? (
                    <button
                      type="button"
                      onClick={() => setSelectedProofUrl(req.proof_url!)}
                      className="px-4 py-2.5 bg-brand/10 hover:bg-brand/20 text-brand border border-brand/20 rounded-2xl text-xs font-black flex items-center gap-2 transition-all cursor-pointer"
                    >
                      <Eye size={16} />
                      <span>{t('subscription.requests.view_proof')}</span>
                    </button>
                  ) : (
                    <span className="px-3 py-2 bg-surface-muted text-content-muted rounded-xl text-xs font-bold border border-border">
                      {t('subscription.requests.no_attachment')}
                    </span>
                  )}

                  {/* Approve / Reject Actions if pending */}
                  {req.status === 'pending' && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={processingId === req.id}
                        onClick={() => handleApprove(req)}
                        className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-xs font-black shadow-lg shadow-emerald-600/20 flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 disabled:opacity-50"
                      >
                        {processingId === req.id ? (
                          <RefreshCw size={14} className="animate-spin" />
                        ) : (
                          <CheckCircle2 size={16} />
                        )}
                        <span>{t('subscription.requests.approve_activate')}</span>
                      </button>

                      <button
                        type="button"
                        disabled={processingId === req.id}
                        onClick={() => setRejectingReq(req)}
                        className="px-4 py-2.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 rounded-2xl text-xs font-black flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 border border-rose-500/20"
                      >
                        <XCircle size={16} />
                        <span>{t('saas.reject')}</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Proof Viewer Modal */}
      {selectedProofUrl && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-surface rounded-3xl p-6 max-w-3xl w-full border border-border shadow-2xl space-y-4 animate-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h4 className="text-base font-black text-content flex items-center gap-2">
                <FileText size={20} className="text-brand" />
                <span>{t('subscription.requests.proof_modal_title')}</span>
              </h4>
              <button
                onClick={() => setSelectedProofUrl(null)}
                className="p-2 hover:bg-surface-muted rounded-full text-content-muted hover:text-content transition-colors cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            <div className="bg-slate-950 rounded-2xl p-2 flex items-center justify-center min-h-[300px] max-h-[70vh] overflow-auto">
              {selectedProofUrl.startsWith('data:image') || selectedProofUrl.startsWith('http') ? (
                <img
                  src={selectedProofUrl}
                  alt="Proof of Payment"
                  className="max-w-full max-h-[65vh] object-contain rounded-xl"
                />
              ) : (
                <div className="text-white text-center p-8 space-y-3">
                  <FileText size={48} className="mx-auto text-brand" />
                  <p className="text-sm font-bold">{t('subscription.requests.proof_is_document')}</p>
                  <a
                    href={selectedProofUrl}
                    download="proof_of_payment"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand text-white rounded-xl text-xs font-black shadow-lg"
                  >
                    <Download size={16} />
                    <span>{t('subscription.requests.download_document')}</span>
                  </a>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-2">
              <a
                href={selectedProofUrl}
                target="_blank"
                rel="noreferrer"
                download="proof_of_payment.png"
                className="px-4 py-2 bg-surface-muted hover:bg-border text-content text-xs font-bold rounded-xl flex items-center gap-2 cursor-pointer"
              >
                <Download size={14} />
                <span>{t('subscription.requests.open_new_tab_download')}</span>
              </a>

              <button
                onClick={() => setSelectedProofUrl(null)}
                className="px-6 py-2 bg-brand text-white text-xs font-black rounded-xl cursor-pointer"
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rejection Reason Modal */}
      {rejectingReq && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-surface rounded-3xl p-6 max-w-md w-full border border-border shadow-2xl space-y-5 animate-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h4 className="text-base font-black text-rose-600 flex items-center gap-2">
                <AlertCircle size={20} />
                <span>{t('subscription.requests.reject_title')}</span>
              </h4>
              <button
                onClick={() => setRejectingReq(null)}
                className="text-content-muted hover:text-content font-bold p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <p className="text-xs font-bold text-content-muted">
              {t('subscription.requests.reject_confirm_text', { name: rejectingReq.tenant_name })}
            </p>

            <textarea
              rows={3}
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder={t('subscription.requests.reject_reason_placeholder')}
              className="w-full p-3.5 bg-surface-muted border border-border rounded-2xl text-xs font-bold text-content focus:border-rose-500 focus:outline-none resize-none"
            />

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setRejectingReq(null)}
                className="flex-1 py-3 bg-surface-muted hover:bg-border text-content font-bold rounded-xl text-xs cursor-pointer"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleConfirmReject}
                className="flex-1 py-3 bg-rose-600 hover:bg-rose-700 text-white font-black rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg shadow-rose-600/20 cursor-pointer"
              >
                <span>{t('subscription.requests.confirm_reject')}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
