import React, { useState, useEffect } from 'react';
import { 
  Warehouse, 
  Store, 
  Plus, 
  MapPin, 
  Phone, 
  CheckCircle2, 
  AlertCircle,
  MoreVertical,
  X,
  Building2,
  ShieldCheck,
  ArrowRightLeft
} from 'lucide-react';
import { supabase } from '../../lib/supabase/client';
import { handleFirestoreError, OperationType } from '../../lib/firebase';
import { Branch } from '../../types';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../lib/utils';
import { SmartSelect } from '../ui/SmartSelect';
import Branding from '../Branding';
import StockTransferWorkflow from './StockTransferWorkflow';

interface WarehouseManagementProps {
  tenantId: string;
}

const WarehouseManagement: React.FC<WarehouseManagementProps> = ({ tenantId }) => {
  const { t } = useTranslation();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);

  useEffect(() => {
    if (!tenantId) return;

    const fetchBranches = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('branches')
        .select('*')
        .eq('tenant_id', tenantId);
      
      if (error) {
        handleFirestoreError(error, OperationType.LIST, 'branches');
      } else {
        const mapped = (data || []).map(b => ({
          ...b,
          isMain: b.is_main
        }) as unknown as Branch);
        setBranches(mapped);
      }
      setLoading(false);
    };

    fetchBranches();

    const channel = supabase
      .channel('branches-admin-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'branches', filter: `tenant_id=eq.${tenantId}` }, () => {
        fetchBranches();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenantId]);

  const handleSave = async (data: any) => {
    try {
      const branchData = {
        name: data.name,
        location: data.location,
        phone: data.phone,
        type: data.type,
        is_main: data.isMain,
        updated_at: new Date().toISOString()
      };

      if (editingBranch) {
        await supabase
          .from('branches')
          .update(branchData)
          .eq('id', editingBranch.id);
      } else {
        await supabase
          .from('branches')
          .insert({
            ...branchData,
            tenant_id: tenantId,
            created_at: new Date().toISOString()
          });
      }
      setShowAddModal(false);
      setEditingBranch(null);
    } catch (error) {
      handleFirestoreError(error as any, editingBranch ? OperationType.UPDATE : OperationType.CREATE, 'branches');
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-content flex items-center gap-3">
            <Building2 className="text-brand" size={32} />
            إدارة الفروع والمواقع
          </h1>
          <p className="text-content-muted font-medium mt-1">إدارة مواقع الفروع</p>
        </div>
        
        <button 
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 bg-brand text-white px-6 py-2.5 rounded-2xl font-bold hover:bg-brand/90 transition-all shadow-lg shadow-brand/20"
        >
          <Plus size={20} />
          {t('branches.add_location')}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {branches.map((branch) => (
          <motion.div 
            key={branch.id}
            layout
            className="bg-surface rounded-[2.5rem] border border-border shadow-sm hover:shadow-xl transition-all group overflow-hidden"
          >
            <div className="p-8 space-y-6">
              <div className="flex items-start justify-between">
                <div className={cn(
                  "p-4 rounded-2xl shadow-lg",
                  branch.type === 'warehouse' ? "bg-brand text-white shadow-brand/20" : "bg-warning text-white shadow-warning/20"
                )}>
                  {branch.type === 'warehouse' ? <Warehouse size={24} /> : <Store size={24} />}
                </div>
                <div className="flex items-center gap-2">
                  {branch.isMain && (
                    <span className="flex items-center gap-1 bg-success/5 text-success px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border border-success/10">
                      <ShieldCheck size={12} />
                      {t('branches.master')}
                    </span>
                  )}
                  <button 
                    onClick={() => {
                      setEditingBranch(branch);
                      setShowAddModal(true);
                    }}
                    className="p-2 hover:bg-surface-muted rounded-full transition-colors"
                  >
                    <MoreVertical size={20} className="text-content-muted" />
                  </button>
                </div>
              </div>

              <div>
                <h3 className="text-xl font-black text-content">{branch.name}</h3>
                <p className="text-xs font-bold text-content-muted uppercase tracking-widest mt-1">
                  {t(`inventory.type_${branch.type}`)}
                </p>
              </div>

              <div className="space-y-3 pt-4 border-t border-border">
                <div className="flex items-center gap-3 text-content-muted">
                  <MapPin size={18} className="text-brand" />
                  <span className="text-sm font-medium">{branch.location}</span>
                </div>
                <div className="flex items-center gap-3 text-content-muted">
                  <Phone size={18} className="text-brand" />
                  <span className="text-sm font-medium">{branch.phone}</span>
                </div>
              </div>
            </div>
            
            <div className="px-8 py-4 bg-surface-muted/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-success rounded-full animate-pulse" />
                <span className="text-[10px] font-black text-content-muted uppercase tracking-widest">{t('common.active')}</span>
              </div>
              <button className="text-xs font-black text-brand hover:text-brand/80 uppercase tracking-widest">
                {t('branches.view_stock')}
              </button>
            </div>
          </motion.div>
        ))}
      </div>

      <AnimatePresence>
        {showAddModal && (
          <BranchModal 
            onClose={() => {
              setShowAddModal(false);
              setEditingBranch(null);
            }}
            onSave={handleSave}
            initialData={editingBranch}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

const BranchModal = ({ onClose, onSave, initialData }: any) => {
  const { t } = useTranslation();
  const [formData, setFormData] = useState(initialData ? {
    name: initialData.name || '',
    location: initialData.location || '',
    phone: initialData.phone || '',
    type: initialData.type || 'store',
    isMain: !!initialData.is_main
  } : {
    name: '',
    location: '',
    phone: '',
    type: 'store',
    isMain: false
  });

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0 }} 
        animate={{ opacity: 1 }} 
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/60 backdrop-blur-md" 
        onClick={onClose} 
      />
      <motion.div 
        initial={{ scale: 0.9, opacity: 0, y: 20 }} 
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        className="bg-surface w-full max-w-lg rounded-[2.5rem] shadow-2xl relative z-10 overflow-hidden border border-border"
      >
        <div className="p-8 border-b border-border flex justify-between items-center bg-surface-muted/50">
          <div className="flex items-center gap-4">
            <div className="p-4 bg-brand text-white rounded-2xl shadow-lg shadow-brand/20">
              <Building2 size={24} />
            </div>
            <div>
              <h2 className="text-2xl font-black text-content">
                {initialData ? t('branches.edit_location') : t('branches.add_location')}
              </h2>
              <p className="text-xs text-content-muted font-bold uppercase tracking-widest">{t('branches.location_details')}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-surface rounded-full transition-colors shadow-sm">
            <X size={24} className="text-content-muted" />
          </button>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); onSave(formData); }} className="p-8 space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-black text-content-muted uppercase tracking-widest ml-1">{t('branches.name')}</label>
            <input 
              required
              value={formData.name}
              onChange={e => setFormData({...formData, name: e.target.value})}
              className="w-full px-5 py-3 bg-surface-muted border-none rounded-2xl focus:ring-2 focus:ring-brand font-bold text-content"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-black text-content-muted uppercase tracking-widest ml-1">{t('branches.type')}</label>
              <SmartSelect
                value={formData.type}
                onChange={val => setFormData({...formData, type: val as any})}
                options={[
                  { value: 'store', label: t('inventory.type_store') },
                  { value: 'warehouse', label: t('inventory.type_warehouse') }
                ]}
                className="w-full px-5 py-3 h-auto min-h-[50px] bg-surface-muted border-none rounded-2xl focus:ring-2 focus:ring-brand font-bold text-content"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-black text-content-muted uppercase tracking-widest ml-1">{t('branches.phone')}</label>
              <input 
                required
                value={formData.phone}
                onChange={e => setFormData({...formData, phone: e.target.value})}
                className="w-full px-5 py-3 bg-surface-muted border-none rounded-2xl focus:ring-2 focus:ring-brand font-bold text-content"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-black text-content-muted uppercase tracking-widest ml-1">{t('branches.location')}</label>
            <input 
              required
              value={formData.location}
              onChange={e => setFormData({...formData, location: e.target.value})}
              className="w-full px-5 py-3 bg-surface-muted border-none rounded-2xl focus:ring-2 focus:ring-brand font-bold text-content"
            />
          </div>

          <div className="flex items-center gap-3 p-4 bg-surface-muted rounded-2xl">
            <input 
              type="checkbox"
              id="isMain"
              checked={formData.isMain}
              onChange={e => setFormData({...formData, isMain: e.target.checked})}
              className="w-5 h-5 text-brand rounded-lg focus:ring-brand border-none"
            />
            <label htmlFor="isMain" className="text-sm font-bold text-content-muted cursor-pointer">
              {t('branches.set_as_master')}
            </label>
          </div>

          <button 
            type="submit"
            className="w-full bg-brand text-white py-4 rounded-2xl font-black text-lg shadow-xl shadow-brand/20 hover:bg-brand/90 transition-all mt-4"
          >
            {t('common.save')}
          </button>
        </form>
      </motion.div>
    </div>
  );
};

export default WarehouseManagement;
