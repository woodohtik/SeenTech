import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { 
  Building, 
  Search, 
  ExternalLink, 
  BookOpen, 
  DollarSign, 
  Edit2, 
  Trash2,
  Phone,
  ShieldCheck,
  CheckCircle,
  FileSpreadsheet,
  Plus
} from 'lucide-react';
import { getSupplierTransactions } from '../services/supplierAccountsService';
import { SupplierTransaction } from '../types/supplierLedger';
import { Supplier } from '../types';
import { PriceDisplay } from './PriceDisplay';
import { cn } from '../lib/utils';
import { useTranslation } from 'react-i18next';

interface SuppliersRegistryProps {
  suppliers: Supplier[];
  tenantId: string;
  searchTerm: string;
  onSelectLedger: (supplier: Supplier) => void;
  onOpenPayout: (supplier: Supplier) => void;
  onEdit: (supplier: Supplier) => void;
  onDelete: (id: string) => void;
}

export default function SuppliersRegistry({
  suppliers,
  tenantId,
  searchTerm,
  onSelectLedger,
  onOpenPayout,
  onEdit,
  onDelete,
}: SuppliersRegistryProps) {
  const { t } = useTranslation();
  // Store computed aggregates for each supplier to populate Total Purchases and Total Paid columns
  const [aggregates, setAggregates] = useState<Record<string, { totalPurchases: number; totalPaid: number }>>({});

  useEffect(() => {
    const computeAggregatesForSuppliers = async () => {
      const result: Record<string, { totalPurchases: number; totalPaid: number }> = {};
      
      for (const supplier of suppliers) {
        try {
          const txs = await getSupplierTransactions(
            supplier.id,
            tenantId,
            supplier.name,
            supplier.balance
          );
          
          const totalPurchases = txs.reduce((sum, tx) => sum + Number(tx.credit || 0), 0);
          const totalPaid = txs.reduce((sum, tx) => sum + Number(tx.debit || 0), 0);
          
          result[supplier.id] = { totalPurchases, totalPaid };
        } catch (err) {
          console.error(`Error computing aggregates for supplier ${supplier.id}:`, err);
        }
      }
      setAggregates(result);
    };

    if (suppliers.length > 0) {
      computeAggregatesForSuppliers();
    }
  }, [suppliers, tenantId]);

  return (
    <div className="bg-surface border border-border rounded-3xl shadow-sm overflow-hidden font-sans text-right" dir="rtl">
      
      {/* Title bar */}
      <div className="p-5 border-b border-danger/20 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 bg-surface-muted/50">
        <div>
          <h2 className="text-sm font-black text-content flex items-center gap-2">
            <span className="w-1.5 h-6 bg-danger rounded-full inline-block" />
            <span>{t('procurement.registry_title', 'بيانات المديونيات وأرصدة الموردين')}</span>
          </h2>
          <p className="text-[11px] text-content-muted font-bold mt-1">{t('procurement.registry_subtitle', 'تتبع إجمالي المشتريات والمبالغ المسددة وأرصدة الذمم والديون القائمة')}</p>
        </div>
      </div>

      {/* Main Datatable & Mobile Cards */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-right border-collapse whitespace-nowrap text-xs md:text-sm">
          <thead>
            <tr className="bg-surface-muted text-[11px] font-black text-content-muted uppercase tracking-wider border-b border-border/50">
              <th className="p-4 text-right">{t('procurement.supplier_name_contact', 'اسم المورد والمسؤول')}</th>
              <th className="p-4 text-center">{t('procurement.total_purchases', 'إجمالي المشتريات (دائن)')}</th>
              <th className="p-4 text-center">{t('procurement.total_paid', 'إجمالي المبالغ المدفوعة (مدين)')}</th>
              <th className="p-4 text-center">{t('procurement.outstanding_balance', 'الرصيد المتبقي المستحق (الذمة)')}</th>
              <th className="p-4 text-center">{t('procurement.account_status', 'حالة الحساب')}</th>
              <th className="p-4 text-center">{t('procurement.actions_and_inventory', 'إجراءات الحساب والجرد')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {suppliers.map((supplier) => {
              const supaId = supplier.id;
              const { totalPurchases = 0, totalPaid = 0 } = aggregates[supaId] || {
                totalPurchases: supplier.balance > 0 ? supplier.balance : 0,
                totalPaid: 0,
              };
              
              const currentDue = supplier.balance;

              return (
                <tr key={supplier.id} className="hover:bg-surface-muted/30 transition-colors">
                  
                  {/* Name and Phone and Contact */}
                  <td className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-surface-muted hover:bg-surface-muted rounded-xl border border-border/60 flex items-center justify-center text-content-muted font-black relative shrink-0 transition-all">
                        <Building size={16} />
                      </div>
                      <div className="min-w-0">
                        <span className="font-extrabold text-content block truncate hover:text-danger transition-colors text-sm">
                          {supplier.name}
                        </span>
                        <span className="text-[10px] text-content-muted font-bold flex items-center gap-1.5 mt-0.5">
                          <span>{t('procurement.contact_person', 'الشخص المسؤول')}: {supplier.contactPerson || '—'}</span>
                          {supplier.phone && (
                            <>
                              <span className="text-content-muted">|</span>
                              <span className="font-mono">{supplier.phone}</span>
                            </>
                          )}
                        </span>
                      </div>
                    </div>
                  </td>

                  {/* Total Credit - Purchases */}
                  <td className="p-4 text-center font-mono font-extrabold text-content">
                    <PriceDisplay amount={totalPurchases} />
                  </td>

                  {/* Total Debit - Paid money */}
                  <td className="p-4 text-center font-mono font-extrabold text-content-muted">
                    <PriceDisplay amount={totalPaid} />
                  </td>

                  {/* Live Outstanding dues */}
                  <td className="p-4 text-center font-mono font-black text-sm">
                    <span className={cn(
                      "px-2.5 py-1 rounded-lg",
                      currentDue > 0 ? "text-danger bg-danger/10/50" : "text-success bg-success/10/30"
                    )}>
                      <PriceDisplay amount={currentDue} />
                    </span>
                  </td>

                  {/* Status labels */}
                  <td className="p-4 text-center">
                    {currentDue <= 0 ? (
                      <span className="inline-flex items-center gap-1 bg-success/10 text-success px-2.5 py-1 rounded-full text-[10px] font-black border border-success/20 uppercase">
                        <CheckCircle size={12} />
                        <span>{t('procurement.status_paid_full', 'مخلص بالكامل')}</span>
                      </span>
                    ) : currentDue > 10000 ? (
                      <span className="inline-flex items-center gap-1 bg-danger/10 text-danger px-2.5 py-1 rounded-full text-[10px] font-black border border-danger/20 uppercase">
                        <span>{t('procurement.status_high_due', 'ذمة معلقة مرتفعة')}</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 bg-warning/10 text-warning px-2.5 py-1 rounded-full text-[10px] font-black border border-warning/20 uppercase">
                        <span>{t('procurement.status_partially_paid', 'قرض قيد السداد')}</span>
                      </span>
                    )}
                  </td>

                  {/* Complete actions suite */}
                  <td className="p-4 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      {/* Statement of accounts / Ledger */}
                      <button
                        onClick={() => onSelectLedger(supplier)}
                        title={t('procurement.statement_of_account', 'كشف الحساب (Ledger)')}
                        className="p-2 bg-surface-muted hover:bg-border text-content border border-border/80 hover:border-border rounded-xl text-[11px] font-black flex items-center gap-1.5 transition-all cursor-pointer"
                      >
                        <BookOpen size={13} className="text-danger" />
                        <span>{t('procurement.statement_of_account', 'كشف الحساب (Ledger)')}</span>
                      </button>

                      {/* Cash out voucher */}
                      <button
                        onClick={() => onOpenPayout(supplier)}
                        title={t('procurement.payout_voucher', 'سند صرف')}
                        className="p-2 bg-content hover:bg-content/90 text-white rounded-xl text-[11px] font-black flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
                      >
                        <DollarSign size={13} />
                        <span>{t('procurement.payout_voucher', 'سند صرف')}</span>
                      </button>

                      {/* Edit */}
                      <button
                        onClick={() => onEdit(supplier)}
                        className="p-2 text-content-muted hover:text-content bg-surface hover:bg-surface-muted border border-border rounded-xl transition-all cursor-pointer"
                      >
                        <Edit2 size={13} />
                      </button>

                      {/* Delete */}
                      <button
                        onClick={() => onDelete(supplier.id)}
                        className="p-2 text-content-muted hover:text-danger bg-surface hover:bg-danger/10 border border-border rounded-xl transition-all cursor-pointer"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>

                </tr>
              );
            })}

            {suppliers.length === 0 && (
              <tr>
                <td colSpan={6} className="p-12 text-center text-content-muted font-bold">
                  {t('procurement.no_suppliers_registered', 'لا يوجد موردين مسجلين حالياً لقيد الحساب')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile Card Layout */}
      <div className="block md:hidden p-4 space-y-4">
        {suppliers.map((supplier) => {
          const supaId = supplier.id;
          const { totalPurchases = 0, totalPaid = 0 } = aggregates[supaId] || {
            totalPurchases: supplier.balance > 0 ? supplier.balance : 0,
            totalPaid: 0,
          };
          const currentDue = supplier.balance;

          return (
            <div 
              key={supplier.id} 
              className="bg-surface-muted/50 rounded-2xl p-4 border border-border/60 space-y-3 flex flex-col"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-10 h-10 bg-surface rounded-xl border border-border flex items-center justify-center text-content-muted shrink-0">
                    <Building size={16} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-extrabold text-content text-sm truncate">{supplier.name}</h3>
                    <p className="text-[10px] text-content-muted font-bold mt-0.5 truncate">
                      {supplier.contactPerson && `${t('procurement.contact_person', 'الشخص المسؤول')}: ${supplier.contactPerson}`}
                      {supplier.phone && ` | ${supplier.phone}`}
                    </p>
                  </div>
                </div>
                <div className="shrink-0">
                  {currentDue <= 0 ? (
                    <span className="inline-flex items-center gap-1 bg-success/10 text-success px-2 py-0.5 rounded-full text-[9px] font-black border border-success/20">
                      <span>{t('procurement.status_paid_full', 'مخلص بالكامل')}</span>
                    </span>
                  ) : currentDue > 10000 ? (
                    <span className="inline-flex items-center gap-1 bg-danger/10 text-danger px-2 py-0.5 rounded-full text-[9px] font-black border border-danger/20">
                      <span>{t('procurement.status_high_due', 'ذمة معلقة مرتفعة')}</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 bg-warning/10 text-warning px-2 py-0.5 rounded-full text-[9px] font-black border border-warning/20">
                      <span>{t('procurement.status_partially_paid', 'قرض قيد السداد')}</span>
                    </span>
                  )}
                </div>
              </div>

              {/* Balances grid */}
              <div className="grid grid-cols-3 gap-2 bg-surface p-2.5 rounded-xl border border-border/40 text-center">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[9px] text-content-muted font-bold">{t('procurement.purchases_label', 'المشتريات')}</span>
                  <span className="font-mono font-extrabold text-xs text-content">
                    <PriceDisplay amount={totalPurchases} />
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 border-r border-border">
                  <span className="text-[9px] text-content-muted font-bold">{t('procurement.paid_label', 'المدفوع')}</span>
                  <span className="font-mono font-extrabold text-xs text-content-muted">
                    <PriceDisplay amount={totalPaid} />
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 border-r border-border">
                  <span className="text-[9px] text-content-muted font-bold">{t('procurement.due_balance_label', 'الرصيد المستحق')}</span>
                  <span className={cn(
                    "font-mono font-black text-xs",
                    currentDue > 0 ? "text-danger" : "text-success"
                  )}>
                    <PriceDisplay amount={currentDue} />
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  onClick={() => onSelectLedger(supplier)}
                  className="flex items-center justify-center gap-1.5 bg-surface-muted hover:bg-surface-muted text-content border border-border rounded-xl py-2 px-3 text-[10px] font-black transition-all cursor-pointer min-h-[44px]"
                >
                  <BookOpen size={13} className="text-danger shrink-0" />
                  <span>{t('procurement.statement_of_account_short', 'كشف حساب')}</span>
                </button>
                <button
                  onClick={() => onOpenPayout(supplier)}
                  className="flex items-center justify-center gap-1.5 bg-content hover:bg-content/90 text-white rounded-xl py-2 px-3 text-[10px] font-black transition-all cursor-pointer shadow-sm min-h-[44px]"
                >
                  <DollarSign size={13} className="shrink-0" />
                  <span>{t('procurement.payout_voucher', 'سند صرف')}</span>
                </button>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-border pt-2">
                <button
                  onClick={() => onEdit(supplier)}
                  className="flex-1 max-w-[60px] flex items-center justify-center p-2 text-content-muted hover:text-content bg-surface border border-border rounded-xl transition-all cursor-pointer min-h-[38px]"
                  title={t('procurement.edit_supplier', 'تعديل')}
                >
                  <Edit2 size={13} />
                </button>
                <button
                  onClick={() => onDelete(supplier.id)}
                  className="flex-1 max-w-[60px] flex items-center justify-center p-2 text-content-muted hover:text-danger bg-surface border border-border rounded-xl transition-all cursor-pointer min-h-[38px]"
                  title={t('procurement.delete_supplier', 'حذف')}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          );
        })}

        {suppliers.length === 0 && (
          <div className="p-8 text-center text-content-muted font-bold text-xs bg-surface-muted/30 rounded-2xl border border-dashed border-border">
            {t('procurement.no_suppliers_registered', 'لا يوجد موردين مسجلين حالياً لقيد الحساب')}
          </div>
        )}
      </div>

    </div>
  );
}
