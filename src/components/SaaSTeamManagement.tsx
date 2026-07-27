import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase/client';
import { useAuth } from '../contexts/AuthContext';
import { motion, AnimatePresence } from 'motion/react';
import {
  Users,
  Plus,
  Search,
  Edit,
  Shield,
  Mail,
  User,
  CheckCircle,
  XCircle,
  Clock
} from 'lucide-react';
import { AdminIconInput } from './ui/AdminIconInput';
import { AdminIconSelect } from './ui/AdminIconSelect';
import { initializeApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { finalConfig } from '../lib/firebase';
import { SaasUser, SaasUserRole } from '../types/supabase';
import { cn } from '../lib/utils';
import { useTranslation } from 'react-i18next';

export default function SaaSTeamManagement() {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar' || i18n.language === 'ur';

  const { dbUser } = useAuth();
  const userRole = dbUser?.role;
  const [team, setTeam] = useState<SaasUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [toast, setToast] = useState<{message: string, type: 'success'|'error'} | null>(null);
  
  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingUser, setEditingUser] = useState<SaasUser | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '', // only used when adding new
    role: 'support_tech' as SaasUserRole,
    is_active: true
  });

  useEffect(() => {
    fetchTeam();
  }, []);

  const fetchTeam = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('saas_users')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (data) {
      setTeam(data as SaasUser[]);
    }
    setLoading(false);
  };

  const roleLabels: Record<SaasUserRole, string> = {
    super_admin: t('saas.role_super_admin', 'مدير عام'),
    support_tech: t('saas.role_support_tech', 'دعم فني'),
    sales: t('saas.role_sales', 'مبيعات'),
    billing_admin: t('saas.role_billing_admin', 'محاسبة')
  };

  const roleColors: Record<SaasUserRole, string> = {
    super_admin: 'bg-brand/10 text-brand',
    support_tech: 'bg-indigo-500/10 text-indigo-500',
    sales: 'bg-success/10 text-success',
    billing_admin: 'bg-warning/10 text-warning'
  };

  const handleOpenModal = (user?: SaasUser) => {
    if (user) {
      setEditingUser(user);
      setFormData({
        name: user.name,
        email: user.email,
        password: '',
        role: user.role,
        is_active: user.is_active
      });
    } else {
      setEditingUser(null);
      setFormData({
        name: '',
        email: '',
        password: '',
        role: 'support_tech',
        is_active: true
      });
    }
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      if (editingUser) {
        // Edit existing
        const { error } = await supabase
          .from('saas_users')
          .update({
            name: formData.name,
            role: formData.role,
            is_active: formData.is_active,
            updated_at: new Date().toISOString()
          })
          .eq('uid', editingUser.uid);

        if (error) throw error;
        setToast({ message: t('saas.update_success', 'تم تحديث بيانات الموظف بنجاح'), type: 'success' });
      } else {
        // Add new
        if (!formData.password || formData.password.length < 6) {
          setToast({ message: t('saas.password_too_short', 'كلمة المرور يجب أن تكون 6 أحرف على الأقل'), type: 'error' });
          setIsSubmitting(false);
          return;
        }

        // Initialize secondary Firebase App
        const secondaryApp = initializeApp(finalConfig, "SecondaryApp");
        const secondaryAuth = getAuth(secondaryApp);
        
        const userCredential = await createUserWithEmailAndPassword(
          secondaryAuth,
          formData.email,
          formData.password
        );
        
        await secondaryAuth.signOut();

        const uid = userCredential.user.uid;

        const { error } = await supabase
          .from('saas_users')
          .insert([{
            uid,
            email: formData.email.toLowerCase(),
            name: formData.name,
            role: formData.role,
            is_active: formData.is_active,
            mfa_enabled: false
          }]);

        if (error) throw error;
        setToast({ message: t('saas.add_success', 'تمت إضافة الموظف بنجاح'), type: 'success' });
      }

      setIsModalOpen(false);
      fetchTeam();
    } catch (error: any) {
      console.error(error);
      setToast({ message: error.message || t('saas.error_saving', 'حدث خطأ أثناء حفظ البيانات'), type: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const filteredTeam = team.filter(member => 
    member.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    member.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Header section with Stats */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black text-content">{t('saas.team_management_title', 'إدارة أعضاء الفريق')}</h1>
          <p className="text-content-muted mt-1">{t('saas.team_management_subtitle', 'إضافة موظفي فريق العمل وتحديد صلاحياتهم')}</p>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="flex-1 md:w-64">
            <AdminIconInput
              startIcon={Search}
              placeholder={t('saas.search_members_placeholder', 'ابحث بالاسم أو البريد...')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-surface border-none shadow-sm rounded-2xl"
            />
          </div>
          <button
            onClick={() => handleOpenModal()}
            className="bg-brand text-white px-6 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-brand/90 transition-all shadow-lg shadow-brand/20 whitespace-nowrap cursor-pointer"
          >
            <Plus size={20} />
            <span>{t('saas.add_member_btn', 'إضافة موظف')}</span>
          </button>
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-surface rounded-[2.5rem] p-6 shadow-sm border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-start rtl:text-right ltr:text-left">
            <thead>
              <tr className="border-b border-border">
                <th className="px-6 py-4 text-start rtl:text-right ltr:text-left text-xs font-black text-content-muted uppercase tracking-wider">{t('common.employee', 'الموظف')}</th>
                <th className="px-6 py-4 text-start rtl:text-right ltr:text-left text-xs font-black text-content-muted uppercase tracking-wider">{t('common.role', 'الدور الوظيفي')}</th>
                <th className="px-6 py-4 text-start rtl:text-right ltr:text-left text-xs font-black text-content-muted uppercase tracking-wider">{t('common.date_added', 'تاريخ الإضافة')}</th>
                <th className="px-6 py-4 text-start rtl:text-right ltr:text-left text-xs font-black text-content-muted uppercase tracking-wider">{t('common.status', 'الحالة')}</th>
                <th className="px-6 py-4 text-end rtl:text-left ltr:text-right text-xs font-black text-content-muted uppercase tracking-wider">{t('common.actions', 'إجراءات')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-content-muted">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand mx-auto mb-4"></div>
                    {t('saas.loading_data', 'جاري تحميل البيانات...')}
                  </td>
                </tr>
              ) : filteredTeam.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-content-muted font-bold">
                    {t('saas.no_members', 'لا يوجد موظفين مسجلين')}
                  </td>
                </tr>
              ) : (
                filteredTeam.map((member) => (
                  <tr key={member.uid} className="hover:bg-surface-muted/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-brand/10 text-brand flex items-center justify-center font-bold shrink-0">
                          {member.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-bold text-content">{member.name}</p>
                          <p className="text-xs text-content-muted block" dir="ltr">{member.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={cn("px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap", roleColors[member.role])}>
                        {roleLabels[member.role] || member.role}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-content-muted font-medium">
                      <div className="flex items-center gap-1.5">
                        <Clock size={14} />
                        <span>
                          {new Date(member.created_at).toLocaleDateString(
                            i18n.language === 'en' ? 'en-US' : i18n.language === 'ur' ? 'ur-PK-u-nu-latn' : 'ar-SA-u-nu-latn'
                          )}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {member.is_active ? (
                        <div className="flex items-center gap-1.5 text-success font-bold text-xs">
                          <CheckCircle size={14} />
                          <span>{t('common.status_active', 'نشط')}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-danger font-bold text-xs">
                          <XCircle size={14} />
                          <span>{t('common.status_inactive', 'موقوف')}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-end rtl:text-left ltr:text-right">
                      <button
                        onClick={() => handleOpenModal(member)}
                        className="p-2 text-content-muted hover:text-brand hover:bg-brand/10 rounded-xl transition-all cursor-pointer"
                      >
                        <Edit size={18} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => !isSubmitting && setIsModalOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-surface w-full max-w-md rounded-[2.5rem] shadow-2xl relative z-10 border border-border p-8"
            >
              <h2 className="text-2xl font-black text-content mb-6">
                {editingUser ? t('saas.edit_member', 'تعديل بيانات الموظف') : t('saas.add_member_new', 'إضافة موظف جديد')}
              </h2>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-content-muted">{t('common.full_name', 'الاسم الكامل')}</label>
                  <AdminIconInput
                    startIcon={User}
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="John Doe"
                    required
                    className="bg-surface-muted"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-content-muted">{t('common.email', 'البريد الإلكتروني')}</label>
                  <AdminIconInput
                    type="email"
                    startIcon={Mail}
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="email@seen.company"
                    required
                    disabled={!!editingUser}
                    className={cn("bg-surface-muted", editingUser && "opacity-50 cursor-not-allowed")}
                  />
                </div>

                {!editingUser && (
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-content-muted">{t('common.password_temp', 'كلمة المرور المؤقتة')}</label>
                    <AdminIconInput
                      type="password"
                      startIcon={Shield}
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      placeholder="******"
                      required
                      className="bg-surface-muted"
                      minLength={6}
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-xs font-bold text-content-muted">{t('common.role', 'الدور الوظيفي')}</label>
                  <AdminIconSelect
                    startIcon={Shield}
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value as SaasUserRole })}
                    className="bg-surface-muted"
                  >
                    <option value="super_admin">{t('saas.role_super_admin', 'مدير عام (Super Admin)')}</option>
                    <option value="support_tech">{t('saas.role_support_tech', 'دعم فني (Support)')}</option>
                    <option value="sales">{t('saas.role_sales', 'مبيعات (Sales)')}</option>
                    <option value="billing_admin">{t('saas.role_billing_admin', 'محاسبة (Billing)')}</option>
                  </AdminIconSelect>
                </div>

                <div className="pt-4 border-t border-border flex items-center justify-between">
                  <label className="text-sm font-bold text-content flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.is_active}
                      onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                      className="w-5 h-5 rounded-md border-border text-brand focus:ring-brand accent-brand"
                    />
                    {t('common.account_active', 'حساب نشط')}
                  </label>
                </div>

                <div className="flex gap-3 pt-6 mt-6">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    disabled={isSubmitting}
                    className="flex-1 py-3 bg-surface-muted text-content font-bold rounded-2xl hover:bg-gray-200 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {t('common.cancel', 'إلغاء')}
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 py-3 bg-brand text-white font-bold rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-brand/20 hover:bg-brand/90 transition-all disabled:opacity-50 cursor-pointer"
                  >
                    {isSubmitting ? (
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    ) : (
                       editingUser ? t('common.save_changes', 'حفظ التعديلات') : t('saas.add_member_btn', 'إضافة موظف')
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Global Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 font-bold text-sm min-w-[300px] justify-center text-white ${toast.type === 'success' ? 'bg-success' : 'bg-danger'}`}
          >
            {toast.type === 'success' ? <CheckCircle size={20} /> : <XCircle size={20} />}
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
