import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase/client';
import { Staff } from '../types';
import { Percent, DollarSign, Save, Loader2, Scissors } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';
import { cn } from '../lib/utils';

interface AdminTailorCommissionsProps {
  tenantId: string;
}

export default function AdminTailorCommissions({ tenantId }: AdminTailorCommissionsProps) {
  const { t } = useTranslation();
  const [tailors, setTailors] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const { success, handleError } = useToast();

  useEffect(() => {
    fetchTailors();
  }, [tenantId]);

  const fetchTailors = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('staff')
        // pin_hash intentionally excluded — never expose bcrypt PIN hashes
        // in a multi-row listing (see security note in Staff.tsx).
        .select('id, name, email, phone, role, status, tenant_id, commission_type, commission_value, created_at')
        .eq('tenant_id', tenantId)
        .eq('role', 'tailor')
        .order('name');
        
      if (error) throw error;
      
      const parsedTailors = (data || []).map(t => ({
        id: t.id,
        name: t.name,
        email: t.email,
        phone: t.phone || '',
        role: t.role as any,
        status: t.status as any,
        tenantId: t.tenant_id,
        commission_type: t.commission_type || 'percentage',
        commission_value: t.commission_value || 0,
        createdAt: t.created_at,
      }));
      
      setTailors(parsedTailors);
    } catch (err: any) {
      handleError(err, t('settings_page.staff.commissions.fetch_error', 'فشل جلب بيانات الخياطين'));
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async (id: string, type: 'percentage' | 'fixed_amount', value: number) => {
    try {
      setSavingId(id);
      const { error } = await supabase
        .from('staff')
        .update({
          commission_type: type,
          commission_value: value
        })
        .eq('id', id)
        .eq('tenant_id', tenantId);

      if (error) throw error;
      
      setTailors(prev => prev.map(t => 
        t.id === id ? { ...t, commission_type: type, commission_value: value } : t
      ));
      
      success(t('settings_page.staff.commissions.save_success', 'تم حفظ إعدادات العمولة بنجاح'));
    } catch (err: any) {
      handleError(err, t('settings_page.staff.commissions.save_error', 'فشل حفظ إعدادات العمولة'));
    } finally {
      setSavingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 bg-white rounded-2xl shadow-sm border border-gray-100 h-64">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="p-6 border-b border-gray-100 flex items-center gap-4">
        <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center shrink-0">
          <Scissors size={24} />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-900">{t('settings_page.staff.commissions.title', 'عمولات الخياطين')}</h2>
          <p className="text-sm text-gray-500 mt-1">
            {t('settings_page.staff.commissions.subtitle', 'إدارة نسبة أو مبلغ العمولة المستحقة لكل خياط عند إنجاز القطع.')}
          </p>
        </div>
      </div>
      
      {tailors.length === 0 ? (
        <div className="p-12 text-center text-gray-500">
          {t('settings_page.staff.commissions.no_tailors', 'لا يوجد موظفين بدور "خياط" حالياً.')}
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {tailors.map((tailor) => (
            <TailorCommissionRow 
              key={tailor.id} 
              tailor={tailor} 
              onSave={(type, value) => handleUpdate(tailor.id, type, value)}
              isSaving={savingId === tailor.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TailorCommissionRow({ 
  tailor, 
  onSave, 
  isSaving 
}: { 
  tailor: Staff; 
  onSave: (type: 'percentage' | 'fixed_amount', value: number) => void;
  isSaving: boolean;
}) {
  const { t } = useTranslation();
  const [type, setType] = useState<'percentage' | 'fixed_amount'>(tailor.commission_type || 'percentage');
  const [value, setValue] = useState<string>(tailor.commission_value?.toString() || '0');

  return (
    <div className="p-6 hover:bg-gray-50/50 transition-colors flex flex-col md:flex-row md:items-center gap-6">
      <div className="flex-1">
        <h3 className="font-bold text-gray-900 text-lg">{tailor.name}</h3>
        <p className="text-sm text-gray-500 mt-1" dir="ltr">{tailor.phone}</p>
      </div>
      
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 flex-1 max-w-2xl">
        {/* Radio Buttons for Type */}
        <div className="flex bg-gray-100 p-1 rounded-xl">
          <button
            onClick={() => setType('percentage')}
            className={cn(
              "flex-1 px-4 py-2 text-sm font-bold rounded-lg transition-all",
              type === 'percentage' 
                ? "bg-white text-gray-900 shadow-sm" 
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-200/50"
            )}
          >
            {t('settings_page.staff.commissions.percentage', 'نسبة (%)')}
          </button>
          <button
            onClick={() => setType('fixed_amount')}
            className={cn(
              "flex-1 px-4 py-2 text-sm font-bold rounded-lg transition-all",
              type === 'fixed_amount' 
                ? "bg-white text-gray-900 shadow-sm" 
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-200/50"
            )}
          >
            {t('settings_page.staff.commissions.fixed_amount', 'مبلغ ثابت')}
          </button>
        </div>

        {/* Value Input */}
        <div className="relative flex-1">
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-gray-400">
            {type === 'percentage' ? <Percent size={18} /> : <DollarSign size={18} />}
          </div>
          <input
            type="number"
            min="0"
            step="0.01"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full pl-4 pr-10 py-2.5 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-bold text-gray-900 text-left"
            dir="ltr"
          />
        </div>

        {/* Save Button */}
        <button
          onClick={() => onSave(type, parseFloat(value) || 0)}
          disabled={isSaving || (type === tailor.commission_type && parseFloat(value) === tailor.commission_value)}
          className="px-6 py-2.5 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:bg-gray-100 disabled:text-gray-400 transition-all flex items-center justify-center gap-2 min-w-[120px]"
        >
          {isSaving ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <>
              <Save size={18} />
              {t('settings_page.staff.commissions.save', 'حفظ')}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
