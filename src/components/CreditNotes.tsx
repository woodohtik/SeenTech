import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase/client';
import { auth, handleFirestoreError, OperationType, getFriendlyErrorMessage } from '../lib/firebase';
import { Tenant, TaxInvoice, CreditNote } from '../types';
import { decodeInvoiceExtendedNotes } from '../utils/b2bHelper';
import { logEmployeeAction } from '../services/employeeAuditService';
import { generateOrderNumber } from '../lib/utils';
import { PriceDisplay } from './PriceDisplay';
import { FileText, ArrowDownLeft, Search, Eye, X, CheckCircle2, ShieldAlert } from 'lucide-react';
import { useStaff } from '../contexts/StaffContext';
import { useToast } from '../contexts/ToastContext';
import { useTranslation } from 'react-i18next';

export default function CreditNotes({ tenantId }: { tenantId: string }) {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar' || i18n.language === 'ur';

  const [invoices, setInvoices] = useState<TaxInvoice[]>([]);
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchInvoice, setSearchInvoice] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<TaxInvoice | null>(null);
  const [reason, setReason] = useState('');
  const [refundAmount, setRefundAmount] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { currentStaff } = useStaff();
  const { error: toastError, success: toastSuccess, handleError } = useToast();

  useEffect(() => {
    const fetchData = async () => {
      try {
        const { data: invoicesData, error: invError } = await supabase
          .from('tax_invoices')
          .select('*')
          .eq('tenant_id', tenantId);
        
        if (invError) throw invError;
        
        setInvoices((invoicesData || []).map(data => {
          const extNotes = decodeInvoiceExtendedNotes(data.notes);
          return {
            id: data.id,
            invoiceNumber: data.invoice_number,
            orderId: data.order_id,
            tenantId: data.tenant_id,
            customerId: data.customer_id,
            customerName: data.customer_name,
            items: extNotes.items || data.items || [],
            subTotal: data.subtotal,
            taxRate: data.tax_rate,
            taxAmount: data.tax_amount,
            totalAmount: data.total_amount,
            isB2B: extNotes.is_b2b !== undefined ? extNotes.is_b2b : (data.is_b2b || data.invoice_type === 'standard_b2b' || !!data.vat_number),
            b2bCompanyName: extNotes.b2b_company_name || data.customer_name,
            b2bTRN: data.vat_number,
            qrCodeBase64: data.zatca_qr_code || data.qr_payload,
            issuedAt: data.issued_at,
            createdBy: extNotes.created_by || data.created_by || 'System',
            status: data.status === 'issued' ? 'valid' : 'cancelled'
          } as TaxInvoice;
        }));
        
        const invoiceMap = new Map((invoicesData || []).map(inv => [inv.id, inv.invoice_number]));
        
        const { data: notesData, error: notesError } = await supabase
          .from('sales_returns')
          .select('*')
          .eq('tenant_id', tenantId);

        if (notesError) throw notesError;

        const formattedNotes = (notesData || []).map(d => {
          const invNumber = invoiceMap.get(d.invoice_id) || 'N/A';
          return {
            id: d.id,
            creditNoteNumber: d.return_number,
            originalInvoiceId: d.invoice_id,
            invoiceNumber: invNumber,
            tenantId: d.tenant_id,
            reason: d.reason || '',
            refundedAmount: Number(d.refunded_amount),
            refundedTax: d.refunded_amount ? (Number(d.refunded_amount) - (Number(d.refunded_amount) / (1 + (15 / 100)))) : 0,
            issuedAt: d.returned_at || d.created_at || new Date().toISOString(),
            createdBy: 'System'
          } as CreditNote;
        });

        formattedNotes.sort((a, b) => new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime());
        setCreditNotes(formattedNotes);
        
      } catch (error) {
        handleFirestoreError(error as any, OperationType.LIST, 'credit_notes');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [tenantId]);

  const handleIssueCreditNote = async () => {
    if (!selectedInvoice) return;
    if (!reason.trim()) {
      alert(t('credit_notes.reason_required', 'يجب إدخال سبب المرتجع'));
      return;
    }
    if (refundAmount <= 0 || refundAmount > selectedInvoice.totalAmount) {
      alert(t('credit_notes.invalid_amount', 'المبلغ المسترجع غير صحيح'));
      return;
    }

    setIsSubmitting(true);
    try {
      const refundTax = refundAmount - (refundAmount / (1 + (selectedInvoice.taxRate / 100)));
      
      const cnNumber = generateOrderNumber(); // reuse order number logic
      const { data: noteData, error: noteError } = await supabase
        .from('sales_returns')
        .insert({
          id: crypto.randomUUID(),
          tenant_id: tenantId,
          invoice_id: selectedInvoice.id,
          order_id: selectedInvoice.orderId || null,
          return_number: `CN-${cnNumber}`,
          status: 'completed' as const,
          reason,
          total_amount: refundAmount,
          refunded_amount: refundAmount,
          refund_method: 'cash' as const,
          processed_by: currentStaff?.id || null,
          returned_at: new Date().toISOString(),
          created_at: new Date().toISOString()
        })
        .select()
        .single();
      
      if (noteError) throw noteError;

      await logEmployeeAction(
        tenantId,
        currentStaff?.id || 'system',
        currentStaff?.name || 'System',
        'create_credit_note',
        `إصدار إشعار دائن رقم CN-${cnNumber} للفاتورة ${selectedInvoice.invoiceNumber}`
      );

      toastSuccess(t('credit_notes.success_issued', 'تم إصدار الإشعار الدائن بنجاح'));
      
      // Update local state 
      if (noteData) {
        setCreditNotes(prev => [{ 
          id: noteData.id,
          creditNoteNumber: noteData.return_number,
          originalInvoiceId: noteData.invoice_id,
          invoiceNumber: selectedInvoice.invoiceNumber,
          tenantId: noteData.tenant_id,
          reason: noteData.reason || '',
          refundedAmount: Number(noteData.refunded_amount),
          refundedTax: refundTax,
          issuedAt: noteData.returned_at || noteData.created_at,
          createdBy: currentStaff?.name || 'System'
        } as CreditNote, ...prev]);
      }
      
      setSelectedInvoice(null);
      setReason('');
      setRefundAmount(0);
      setSearchInvoice('');
    } catch (error) {
      handleError(error, t('credit_notes.error_issued', 'خطأ أثناء إصدار الإشعار'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredInvoices = invoices.filter(inv => 
    inv.invoiceNumber.toLowerCase().includes(searchInvoice.toLowerCase())
  );

  return (
    <div className="p-6 font-sans bg-surface" dir={isRtl ? 'rtl' : 'ltr'} style={{ fontFamily: 'IBM Plex Sans, sans-serif' }}>
      <div className="mb-6 flex justify-between items-center bg-surface p-6 rounded-2xl shadow-sm border border-border">
        <div>
          <h2 className="text-xl font-black text-content flex items-center gap-2">
            <ArrowDownLeft className="text-brand" />
            {t('credit_notes.title', 'الإشعارات الدائنة والصادرة')}
          </h2>
          <p className="text-sm font-bold text-content-muted mt-1">{t('credit_notes.records_desc', 'إصدار وإدارة الإشعارات الدائنة للمرتجعات (Credit Notes)')}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-1 bg-surface p-6 rounded-2xl border border-border shadow-sm flex flex-col">
          <h3 className="text-lg font-black text-content mb-4 flex items-center gap-2">
            <ShieldAlert className="text-warning" />
            {t('credit_notes.issue_new', 'إصدار إشعار جديد')}
          </h3>
          
          {!selectedInvoice ? (
            <div className="flex-1 space-y-4">
              <div className="relative">
                <Search size={18} className="absolute right-3 top-3 text-content-muted" />
                <input 
                  type="text" 
                  placeholder={t('credit_notes.search_invoice_placeholder', 'ابحث برقم الفاتورة الأصلية...')} 
                  value={searchInvoice}
                  onChange={(e) => setSearchInvoice(e.target.value)}
                  className="w-full bg-surface-muted border border-border rounded-xl py-3 pr-10 pl-4 focus:ring-2 focus:ring-brand font-mono text-content"
                />
              </div>
              
              {searchInvoice && (
                <div className="border border-border rounded-xl max-h-64 overflow-y-auto divide-y divide-border">
                  {filteredInvoices.slice(0, 5).map(inv => (
                    <button
                      key={inv.id}
                      onClick={() => {
                        setSelectedInvoice(inv);
                        setRefundAmount(inv.totalAmount);
                      }}
                      className="w-full text-right p-3 hover:bg-brand/5 transition-colors flex justify-between items-center cursor-pointer"
                    >
                      <div>
                        <p className="font-mono font-bold text-sm text-content">{inv.invoiceNumber}</p>
                        <p className="text-xs text-content-muted">{inv.customerName}</p>
                      </div>
                      <span className="font-black text-brand text-sm"><PriceDisplay amount={inv.totalAmount} /></span>
                    </button>
                  ))}
                  {filteredInvoices.length === 0 && (
                    <div className="p-4 text-center text-content-muted text-sm">{t('credit_notes.invoice_not_found', 'لا توجد فاتورة بهذا الرقم')}</div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 space-y-4 border border-brand/20 bg-brand/5 p-5 rounded-2xl relative">
              <button 
                onClick={() => setSelectedInvoice(null)} 
                className="absolute top-4 left-4 p-1 hover:bg-brand/10 text-brand rounded-full transition-colors cursor-pointer text-left"
                title={t('credit_notes.cancel_selection', 'إلغاء التحديد')}
              >
                <X size={16} />
              </button>
              
              <div>
                <p className="text-xs font-bold text-brand uppercase tracking-widest mb-1">{t('credit_notes.selected_invoice', 'الفاتورة المحددة')}</p>
                <p className="font-mono font-black text-xl">{selectedInvoice.invoiceNumber}</p>
              </div>
              
              <div>
                <p className="text-xs font-bold text-content-muted mb-1">{t('tax_invoices.customer', 'العميل')}</p>
                <p className="font-bold text-content">{selectedInvoice.customerName}</p>
              </div>
              
              <div className="pt-4 border-t border-brand/10">
                <label className="text-sm font-bold text-content block mb-2">{t('credit_notes.refund_amount', 'المبلغ المسترجع')}</label>
                <input 
                  type="number"
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(Number(e.target.value))}
                  max={selectedInvoice.totalAmount}
                  min={0}
                  className="w-full bg-surface border border-border rounded-xl p-3 focus:ring-2 focus:ring-brand font-bold text-lg text-content"
                />
                <p className="text-xs text-content-muted mt-1">{t('credit_notes.max_limit', 'الحد الأقصى')}: <PriceDisplay amount={selectedInvoice.totalAmount} /></p>
              </div>
              
              <div>
                <label className="text-sm font-bold text-content block mb-2">{t('credit_notes.refund_reason', 'سبب الإرجاع')}</label>
                <textarea 
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full bg-surface border border-border rounded-xl p-3 focus:ring-2 focus:ring-brand text-content"
                  rows={2}
                  placeholder={t('credit_notes.reason_placeholder', 'حدث خطأ في المقاس، رغبة العميل...')}
                />
              </div>

              <button
                onClick={handleIssueCreditNote}
                disabled={isSubmitting || !reason || refundAmount <= 0}
                className="w-full py-3 bg-danger text-white rounded-xl font-bold hover:bg-danger/90 transition-all disabled:opacity-50 mt-4 flex justify-center gap-2 items-center cursor-pointer"
              >
                {isSubmitting ? t('credit_notes.submitting', 'جاري الإصدار...') : (
                  <>
                    <CheckCircle2 size={20} />
                    {t('credit_notes.issue_btn', 'إصدار إشعار دائن')}
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        <div className="lg:col-span-2 bg-surface rounded-2xl border border-border overflow-hidden shadow-sm">
          <div className="p-5 border-b border-border bg-surface-muted">
            <h3 className="font-black text-content">{t('credit_notes.records_title', 'سجل الإشعارات الدائنة')}</h3>
          </div>
          {loading ? (
             <div className="flex items-center justify-center h-64">
               <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand"></div>
             </div>
          ) : (
            <div className="overflow-x-auto whitespace-nowrap scrollbar-hide">
              <table className="w-full text-right min-w-max">
                <thead className="bg-surface border-b border-border text-content-muted text-xs uppercase font-black tracking-wider">
                  <tr>
                    <th className="p-4">{t('credit_notes.credit_note_no', 'رقم الإشعار')}</th>
                    <th className="p-4">{t('credit_notes.original_invoice_no', 'رقم الفاتورة الأصلية')}</th>
                    <th className="p-4">{t('credit_notes.date', 'التاريخ')}</th>
                    <th className="p-4">{t('credit_notes.reason', 'السبب')}</th>
                    <th className="p-4">{t('credit_notes.refunded_amt', 'المبلغ المسترجع')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-muted text-sm font-medium">
                  {creditNotes.map((note) => (
                    <tr key={note.id} className="hover:bg-danger/5 transition-colors">
                      <td className="p-4">
                        <span className="font-mono font-bold text-danger bg-danger/10 px-2 py-1 rounded-lg">
                          {note.creditNoteNumber}
                        </span>
                      </td>
                      <td className="p-4 font-mono text-content-muted">{note.invoiceNumber}</td>
                      <td className="p-4 text-content-muted font-bold" dir="ltr">{new Date(note.issuedAt).toLocaleString(i18n.language === 'ar' ? 'ar-SA' : (i18n.language === 'ur' ? 'ur-PK' : 'en-US'))}</td>
                      <td className="p-4 text-content truncate max-w-[200px]" title={note.reason}>{note.reason}</td>
                      <td className="p-4 font-black text-content"><PriceDisplay amount={note.refundedAmount} /></td>
                    </tr>
                  ))}
                  {creditNotes.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-content-muted font-bold">{t('credit_notes.no_credit_notes', 'لا يوجد إشعارات دائنة مصدرة')}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
