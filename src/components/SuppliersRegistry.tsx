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
    <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden font-sans text-right" dir="rtl">
      
      {/* Title bar */}
      <div className="p-5 border-b border-rose-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 bg-slate-50/50">
        <div>
          <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
            <span className="w-1.5 h-6 bg-red-600 rounded-full inline-block" />
            <span>بيانات المديونيات وأرصدة الموردين</span>
          </h2>
          <p className="text-[11px] text-slate-400 font-bold mt-1">تتبع إجمالي المشتريات والمبالغ المسددة وأرصدة الذمم والديون القائمة</p>
        </div>
      </div>

      {/* Main Datatable */}
      <div className="overflow-x-auto">
        <table className="w-full text-right border-collapse whitespace-nowrap text-xs md:text-sm">
          <thead>
            <tr className="bg-slate-100 text-[11px] font-black text-slate-400 uppercase tracking-wider border-b border-slate-200/50">
              <th className="p-4 text-right">اسم المورد والمسؤول</th>
              <th className="p-4 text-center">إجمالي المشتريات (دائن)</th>
              <th className="p-4 text-center">إجمالي المبالغ المدفوعة (مدين)</th>
              <th className="p-4 text-center">الرصيد المتبقي المستحق (الذمة)</th>
              <th className="p-4 text-center">حالة الحساب</th>
              <th className="p-4 text-center">إجراءات الحساب والجرد</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {suppliers.map((supplier) => {
              const supaId = supplier.id;
              const { totalPurchases = 0, totalPaid = 0 } = aggregates[supaId] || {
                totalPurchases: supplier.balance > 0 ? supplier.balance : 0,
                totalPaid: 0,
              };
              
              const currentDue = supplier.balance;

              return (
                <tr key={supplier.id} className="hover:bg-slate-50/30 transition-colors">
                  
                  {/* Name and Phone and Contact */}
                  <td className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-slate-50 hover:bg-slate-100 rounded-xl border border-slate-200/60 flex items-center justify-center text-slate-600 font-black relative shrink-0 transition-all">
                        <Building size={16} />
                      </div>
                      <div className="min-w-0">
                        <span className="font-extrabold text-slate-900 block truncate hover:text-red-600 transition-colors text-sm">
                          {supplier.name}
                        </span>
                        <span className="text-[10px] text-slate-400 font-bold flex items-center gap-1.5 mt-0.5">
                          <span>المسؤول: {supplier.contactPerson || '—'}</span>
                          {supplier.phone && (
                            <>
                              <span className="text-slate-300">|</span>
                              <span className="font-mono">{supplier.phone}</span>
                            </>
                          )}
                        </span>
                      </div>
                    </div>
                  </td>

                  {/* Total Credit - Purchases */}
                  <td className="p-4 text-center font-mono font-extrabold text-slate-800">
                    <PriceDisplay amount={totalPurchases} />
                  </td>

                  {/* Total Debit - Paid money */}
                  <td className="p-4 text-center font-mono font-extrabold text-slate-500">
                    <PriceDisplay amount={totalPaid} />
                  </td>

                  {/* Live Outstanding dues */}
                  <td className="p-4 text-center font-mono font-black text-sm">
                    <span className={cn(
                      "px-2.5 py-1 rounded-lg",
                      currentDue > 0 ? "text-red-600 bg-red-50/50" : "text-emerald-600 bg-emerald-50/30"
                    )}>
                      <PriceDisplay amount={currentDue} />
                    </span>
                  </td>

                  {/* Status labels */}
                  <td className="p-4 text-center">
                    {currentDue <= 0 ? (
                      <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full text-[10px] font-black border border-emerald-100 uppercase">
                        <CheckCircle size={12} />
                        <span>مخلص بالكامل</span>
                      </span>
                    ) : currentDue > 10000 ? (
                      <span className="inline-flex items-center gap-1 bg-rose-50 text-rose-700 px-2.5 py-1 rounded-full text-[10px] font-black border border-rose-100 uppercase">
                        <span>ذمة معلقة مرتفعة</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 px-2.5 py-1 rounded-full text-[10px] font-black border border-amber-100 uppercase">
                        <span>قرض قيد السداد</span>
                      </span>
                    )}
                  </td>

                  {/* Complete actions suite */}
                  <td className="p-4 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      {/* Statement of accounts / Ledger */}
                      <button
                        onClick={() => onSelectLedger(supplier)}
                        title="كشف حساب تفصيلي"
                        className="p-2 bg-slate-50 hover:bg-slate-100 text-slate-800 border border-slate-200/80 hover:border-slate-300 rounded-xl text-[11px] font-black flex items-center gap-1.5 transition-all cursor-pointer"
                      >
                        <BookOpen size={13} className="text-red-600" />
                        <span>كشف الحساب (Ledger)</span>
                      </button>

                      {/* Cash out voucher */}
                      <button
                        onClick={() => onOpenPayout(supplier)}
                        title="إصدار سند صرف مالي"
                        className="p-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-[11px] font-black flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
                      >
                        <DollarSign size={13} />
                        <span>سند صرف</span>
                      </button>

                      {/* Edit */}
                      <button
                        onClick={() => onEdit(supplier)}
                        className="p-2 text-slate-400 hover:text-slate-800 bg-white hover:bg-slate-50 border border-slate-100 rounded-xl transition-all cursor-pointer"
                      >
                        <Edit2 size={13} />
                      </button>

                      {/* Delete */}
                      <button
                        onClick={() => onDelete(supplier.id)}
                        className="p-2 text-slate-400 hover:text-red-600 bg-white hover:bg-rose-50 border border-slate-100 rounded-xl transition-all cursor-pointer"
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
                <td colSpan={6} className="p-12 text-center text-slate-400 font-bold">
                  لا يوجد موردون مسجلون لتعدين سجلات المحاسبة حالياً.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

    </div>
  );
}
