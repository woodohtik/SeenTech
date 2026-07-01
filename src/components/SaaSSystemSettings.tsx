import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase/client';
import { auth } from '../lib/firebase';
import { 
  Settings, 
  Globe, 
  Database, 
  Save, 
  AlertCircle, 
  Zap, 
  Ban, 
  Shield,
  ShieldCheck,
  Server,
  Activity,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { Tenant } from '../types';
import { AdminIconInput } from './ui/AdminIconInput';
import { AdminIconSelect } from './ui/AdminIconSelect';
import { useTranslation } from 'react-i18next';
import GlobalRoleManager from './GlobalRoleManager';

export default function SaaSSystemSettings() {
  const { t } = useTranslation();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string>('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [brandingSettings, setBrandingSettings] = useState({
    websiteUrl: '',
    companyName: 'Seen'
  });
  const [platformSettings, setPlatformSettings] = useState({
    trialDays: 14,
    allowRegistrations: true
  });
  const [isSavingBranding, setIsSavingBranding] = useState(false);
  const [isSavingPlatform, setIsSavingPlatform] = useState(false);
  const [userRole, setUserRole] = useState<string>('');
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    type: 'test' | 'wipe';
    tenantId: string;
    tenantName: string;
    inputValue: string;
  }>({
    isOpen: false,
    type: 'test',
    tenantId: '',
    tenantName: '',
    inputValue: ''
  });

  useEffect(() => {
    const fetchData = async () => {
      const { data: tenantsData } = await supabase.from('tenants').select('*');
      if (tenantsData) {
        setTenants(tenantsData.map(d => ({
          ...d,
          ownerEmail: d.owner_email,
          createdAt: d.created_at,
          inventoryStrategy: d.inventory_strategy,
          customerId: d.customer_id,
          vatNumber: d.vat_number,
          commercialRegister: d.commercial_register,
          logoUrl: d.logo_url,
          defaultLayout: d.default_layout,
          isTest: d.is_test
        }) as Tenant));
      }

      const { data: brandingData } = await supabase
        .from('saas_settings')
        .select('*')
        .eq('key', 'branding')
        .maybeSingle();
      
      if (brandingData && brandingData.value) {
        setBrandingSettings({
          websiteUrl: brandingData.value.websiteUrl || '',
          companyName: brandingData.value.companyName || 'Seen'
        });
      }

      const { data: platformData } = await supabase
        .from('saas_settings')
        .select('*')
        .eq('key', 'platform')
        .maybeSingle();
      
      if (platformData && platformData.value) {
        setPlatformSettings({
          trialDays: platformData.value.trialDays || 14,
          allowRegistrations: platformData.value.allowRegistrations !== false
        });
      }

      const { data: saasUserData } = await supabase
        .from('saas_users')
        .select('*')
        .eq('uid', auth.currentUser?.uid)
        .maybeSingle();
      
      if (saasUserData) {
        setUserRole(saasUserData.role);
      }
    };
    fetchData();
  }, []);

  const logAuditAction = async (action: string, details: string, targetTenantId?: string) => {
    try {
      await supabase.from('saas_security_logs').insert({
        action,
        performed_by_uid: auth.currentUser?.uid,
        performed_by_email: auth.currentUser?.email,
        target_tenant_id: targetTenantId,
        details,
        type: action.includes('wipe') ? 'deletion' : 'update',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error logging audit action:', error);
    }
  };

  const handleSaveBranding = async () => {
    setIsSavingBranding(true);
    try {
      const { error } = await supabase
        .from('saas_settings')
        .upsert({
          key: 'branding',
          value: brandingSettings,
          updated_at: new Date().toISOString(),
          updated_by: auth.currentUser?.email
        }, { onConflict: 'key' });
      
      if (error) throw error;
      
      alert('تم تحديث إعدادات العلامة التجارية بنجاح');
      await logAuditAction('update_branding', `Updated branding to ${brandingSettings.companyName}`);
    } catch (error) {
      console.error('Error saving branding settings:', error);
      alert('حدث خطأ أثناء حفظ الإعدادات');
    } finally {
      setIsSavingBranding(false);
    }
  };

  const handleSavePlatform = async () => {
    setIsSavingPlatform(true);
    try {
      const { error } = await supabase
        .from('saas_settings')
        .upsert({
          key: 'platform',
          value: platformSettings,
          updated_at: new Date().toISOString(),
          updated_by: auth.currentUser?.email
        }, { onConflict: 'key' });
      
      if (error) throw error;
      
      alert('تم تحديث إعدادات المنصة بنجاح');
      await logAuditAction('update_platform', `Updated platform settings. Trial: ${platformSettings.trialDays}`);
    } catch (error) {
      console.error('Error saving platform settings:', error);
      alert('حدث خطأ أثناء حفظ الإعدادات');
    } finally {
      setIsSavingPlatform(false);
    }
  };

  const confirmWipeData = async () => {
    const { tenantId, tenantName, inputValue } = confirmModal;
    if (inputValue !== tenantName) {
      alert('الاسم غير مطابق. تم إلغاء العملية.');
      return;
    }

    setIsDeleting(true);
    setConfirmModal(prev => ({ ...prev, isOpen: false }));
    try {
      const tables = [
        'customers', 
        'orders', 
        'inventory_items', 
        'notifications', 
        'staff', 
        'suppliers', 
        'inventory_reconciliations',
        'shifts',
        'branch_inventory',
        'tax_invoices',
        'tailor_requests'
      ];
      
      let totalDeleted = 0;

      for (const table of tables) {
        const { error, count } = await supabase
          .from(table)
          .delete({ count: 'exact' })
          .eq('tenant_id', tenantId);
        
        if (error) console.error(`Error deleting from ${table}:`, error);
        if (count) totalDeleted += count;
      }

      await logAuditAction('wipe_tenant_data', `Full data wipe performed for tenant ${tenantId} (${tenantName}). Total records deleted: ${totalDeleted}`, tenantId);
      alert(`تم مسح كافة بيانات المشترك بنجاح (${totalDeleted} سجل)`);
    } catch (error) {
      console.error('Error wiping tenant data:', error);
      alert('حدث خطأ أثناء مسح بيانات المشترك');
    } finally {
      setIsDeleting(false);
    }
  };

  const confirmDeleteTestData = async () => {
    const { tenantId, tenantName } = confirmModal;
    setIsDeleting(true);
    setConfirmModal(prev => ({ ...prev, isOpen: false }));
    try {
      const tables = ['customers', 'orders', 'inventory_items', 'notifications'];
      let totalDeleted = 0;

      for (const table of tables) {
        const { error, count } = await supabase
          .from(table)
          .delete({ count: 'exact' })
          .eq('tenant_id', tenantId)
          .eq('is_test', true);
        
        if (error) console.error(`Error deleting test data from ${table}:`, error);
        if (count) totalDeleted += count;
      }

      await logAuditAction('delete_test_data', `Deleted test records for tenant ${tenantId}`, tenantId);
      alert(`تم حذف سجلات الاختبار بنجاح (${totalDeleted} سجل)`);
    } catch (error) {
      console.error('Error deleting test data:', error);
      alert('حدث خطأ أثناء حذف بيانات الاختبار');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-8 font-sans" dir="rtl">
      <div>
        <h2 className="text-3xl font-black text-content">{t('common.system_settings')}</h2>
        <p className="text-content-muted font-bold mt-1">{t('common.system_settings_subtitle')}</p>
      </div>

      {/* Role Information Banner */}
      <div className="bg-brand/5 p-6 rounded-[2rem] border border-brand/10 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-brand text-white rounded-2xl flex items-center justify-center">
            <Shield size={24} />
          </div>
          <div>
            <h4 className="text-brand font-black">{t('common.user_permissions')}</h4>
            <p className="text-brand/80 text-sm font-medium">
              {t('common.logged_in_as')}: <span className="font-black uppercase">{userRole || 'Super Admin'}</span>
            </p>
          </div>
        </div>
        {userRole === 'support_tech' && (
          <span className="px-4 py-2 bg-warning/10 text-warning rounded-xl text-xs font-black">
            {t('common.support_mode')}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* System Health */}
        <div className="bg-surface p-8 rounded-[2.5rem] border border-border shadow-sm">
          <h3 className="text-xl font-black text-content mb-8 flex items-center gap-2">
            <ShieldCheck className="text-brand" size={24} />
            {t('common.system_health')}
          </h3>
          <div className="space-y-6">
            {[
              { label: t('common.database'), status: t('common.connected'), health: '99.9%', icon: Database, color: 'text-success', bg: 'bg-success/10' },
              { label: t('common.auth_services'), status: t('common.stable'), health: '100%', icon: ShieldCheck, color: 'text-brand', bg: 'bg-brand/10' },
              { label: t('common.cloud_storage'), status: t('common.warning'), health: '85%', icon: Server, color: 'text-warning', bg: 'bg-warning/10' }
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className={cn("p-3 rounded-2xl", item.bg, item.color)}>
                    <item.icon size={20} />
                  </div>
                  <div>
                    <div className="text-sm font-black text-content">{item.label}</div>
                    <div className="text-xs text-content-muted font-bold">{item.status}</div>
                  </div>
                </div>
                <span className={cn("text-sm font-black", item.color)}>{item.health}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-2 space-y-8">
          <div className="bg-surface p-8 rounded-[2.5rem] border border-border shadow-sm">
            <h3 className="text-xl font-black text-content mb-8 flex items-center gap-2">
              <Globe className="text-brand" size={24} />
              {t('common.branding_settings')}
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-4">
                <label className="block text-sm font-black text-content-muted">{t('common.company_name')}</label>
                <AdminIconInput 
                  type="text"
                  value={brandingSettings.companyName}
                  onChange={(e) => setBrandingSettings(prev => ({ ...prev, companyName: e.target.value }))}
                  placeholder="Seen"
                  className="bg-surface-muted"
                />
              </div>

              <div className="space-y-4">
                <label className="block text-sm font-black text-content-muted">{t('common.website_url')}</label>
                <AdminIconInput 
                  type="url"
                  value={brandingSettings.websiteUrl}
                  onChange={(e) => setBrandingSettings(prev => ({ ...prev, websiteUrl: e.target.value }))}
                  placeholder="https://example.com"
                  startIcon={Globe}
                  className="bg-surface-muted"
                />
              </div>
            </div>

            <div className="mt-8 flex justify-end">
              <button
                disabled={isSavingBranding || userRole === 'support_tech'}
                onClick={handleSaveBranding}
                className="flex items-center gap-2 px-8 py-4 bg-brand text-white rounded-2xl font-black hover:bg-brand/90 disabled:opacity-50 transition-all shadow-lg shadow-brand/10"
              >
                {isSavingBranding ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Save size={20} />
                )}
                <span>{t('common.save')}</span>
              </button>
            </div>
          </div>

          <div className="bg-surface p-8 rounded-[2.5rem] border border-border shadow-sm">
            <h3 className="text-xl font-black text-content mb-8 flex items-center gap-2">
              <Settings className="text-brand" size={24} />
              إعدادات المنصة الأساسية
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-4">
                <label className="block text-sm font-black text-content-muted">مدة التجربة المجانية (أيام)</label>
                <AdminIconInput 
                  type="number"
                  min="0"
                  max="90"
                  value={platformSettings.trialDays}
                  onChange={(e) => setPlatformSettings(prev => ({ ...prev, trialDays: Number(e.target.value) }))}
                  startIcon={Settings}
                  className="bg-surface-muted"
                />
              </div>

              <div className="space-y-4 flex flex-col justify-end">
                 <label className="flex items-center justify-between p-4 bg-surface-muted rounded-2xl cursor-pointer hover:ring-2 hover:ring-brand/50 transition-all h-[56px]">
                  <span className="text-sm font-black text-content">السماح بتسجيل مشتركين جدد (Self-Serve)</span>
                  <input 
                    type="checkbox"
                    checked={platformSettings.allowRegistrations}
                    onChange={(e) => setPlatformSettings(prev => ({ ...prev, allowRegistrations: e.target.checked }))}
                    className="w-5 h-5 accent-brand"
                  />
                </label>
              </div>
            </div>

            <div className="mt-8 flex justify-end">
              <button
                disabled={isSavingPlatform || userRole === 'support_tech'}
                onClick={handleSavePlatform}
                className="flex items-center gap-2 px-8 py-4 bg-brand text-white rounded-2xl font-black hover:bg-brand/90 disabled:opacity-50 transition-all shadow-lg shadow-brand/10"
              >
                {isSavingPlatform ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Save size={20} />
                )}
                <span>حفظ التعديلات</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Global Role Manager */}
      <div className="bg-surface p-8 rounded-[2.5rem] border border-border shadow-sm">
        <GlobalRoleManager />
      </div>

      {/* Advanced Data Management */}
      <div className="bg-surface p-8 rounded-[2.5rem] border border-border shadow-sm">
        <h3 className="text-xl font-black text-content mb-8 flex items-center gap-2">
          <Database className="text-danger" size={24} />
          {t('common.advanced_data_management')}
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-4">
            <label className="block text-sm font-black text-content-muted">{t('common.select_tenant_management')}</label>
            <AdminIconSelect
              startIcon={Database}
              value={selectedTenantId}
              onChange={(e) => setSelectedTenantId(e.target.value)}
            >
              <option value="" disabled hidden>{t('common.select_tenant')}</option>
              {tenants.map(t => (
                <option key={t.id} value={t.id}>{t.name} ({t.ownerEmail})</option>
              ))}
            </AdminIconSelect>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <button
              disabled={!selectedTenantId || isDeleting || userRole === 'support_tech' || userRole === 'billing_admin'}
              onClick={() => {
                const tenant = tenants.find(t => t.id === selectedTenantId);
                if (tenant) {
                  setConfirmModal({
                    isOpen: true,
                    type: 'test',
                    tenantId: selectedTenantId,
                    tenantName: tenant.name,
                    inputValue: ''
                  });
                }
              }}
              className="flex-1 flex items-center justify-center gap-2 px-6 py-4 bg-warning/10 text-warning rounded-2xl font-black hover:bg-warning/20 disabled:opacity-50 transition-all text-sm"
            >
              <Zap size={20} />
              <span>{t('common.delete_test_data')}</span>
            </button>
            <button
              disabled={!selectedTenantId || isDeleting || userRole === 'support_tech' || userRole === 'billing_admin'}
              onClick={() => {
                const tenant = tenants.find(t => t.id === selectedTenantId);
                if (tenant) {
                  setConfirmModal({
                    isOpen: true,
                    type: 'wipe',
                    tenantId: selectedTenantId,
                    tenantName: tenant.name,
                    inputValue: ''
                  });
                }
              }}
              className="flex-1 flex items-center justify-center gap-2 px-6 py-4 bg-danger/10 text-danger rounded-2xl font-black hover:bg-danger/20 disabled:opacity-50 transition-all text-sm"
            >
              <Ban size={20} />
              <span>{t('common.wipe_data')}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {confirmModal.isOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-surface rounded-[2.5rem] w-full max-w-lg overflow-hidden shadow-2xl"
            >
              <div className="p-8 border-b border-border flex items-center justify-between bg-danger/5">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-danger/10 text-danger rounded-2xl flex items-center justify-center">
                    <AlertCircle size={24} />
                  </div>
                  <div>
                    <h3 className="text-xl font-black text-content">{t('common.confirm_deletion')}</h3>
                    <p className="text-sm text-content-muted font-bold">{t('common.action_irreversible')}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                  className="p-2 hover:bg-surface rounded-xl transition-colors"
                >
                  <X size={20} className="text-content-muted" />
                </button>
              </div>

              <div className="p-8 space-y-6">
                <div className="p-4 bg-danger/5 rounded-2xl border border-danger/10">
                  <p className="text-danger text-sm font-bold leading-relaxed">
                    {confirmModal.type === 'wipe' 
                      ? `${t('common.wipe_warning')} (${confirmModal.tenantName}).`
                      : `${t('common.delete_test_warning')} (${confirmModal.tenantName}).`
                    }
                  </p>
                </div>

                {confirmModal.type === 'wipe' && (
                  <div className="space-y-3">
                    <label className="block text-sm font-black text-content-muted">
                      {t('common.write_name_to_confirm')}: <span className="text-danger">({confirmModal.tenantName})</span>
                    </label>
                    <AdminIconInput 
                      type="text"
                      value={confirmModal.inputValue}
                      onChange={(e) => setConfirmModal(prev => ({ ...prev, inputValue: e.target.value }))}
                      placeholder={t('common.type_name_here')}
                      error={confirmModal.inputValue.length > 0 && confirmModal.inputValue !== confirmModal.tenantName}
                      className="bg-surface-muted"
                    />
                  </div>
                )}

                <div className="flex gap-4 pt-4">
                  <button 
                    onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                    className="flex-1 px-6 py-4 bg-surface-muted text-content-muted rounded-2xl font-black hover:bg-border/20 transition-all font-mono uppercase text-xs"
                  >
                    {t('common.cancel')}
                  </button>
                  <button 
                    onClick={confirmModal.type === 'wipe' ? confirmWipeData : confirmDeleteTestData}
                    disabled={confirmModal.type === 'wipe' && confirmModal.inputValue !== confirmModal.tenantName}
                    className="flex-1 px-6 py-4 bg-danger text-white rounded-2xl font-black hover:bg-danger/90 disabled:opacity-50 shadow-lg shadow-danger/10 transition-all font-mono uppercase text-xs"
                  >
                    {t('common.confirm_final_deletion')}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
