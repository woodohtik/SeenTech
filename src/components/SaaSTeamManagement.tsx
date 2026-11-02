import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
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
  Clock,
  MoreVertical,
  KeyRound,
  Trash2
} from 'lucide-react';
import { IconInput } from './ui/IconInput';
import { SmartSelect } from './ui/SmartSelect';
import { SaasUser, SaasUserRole } from '../types/supabase';
import { cn } from '../lib/utils';
import { useTranslation } from 'react-i18next';
import { getFriendlyErrorMessage } from '../lib/firebase';
import { useConfirm } from '../contexts/ConfirmContext';

import { isRtlLang } from '../lib/direction';

export default function SaaSTeamManagement() {
  const { t, i18n } = useTranslation();
  const isRtl = isRtlLang(i18n.language);

  const { dbUser } = useAuth();
  const { confirm } = useConfirm();
  const userRole = dbUser?.role;
  const [team, setTeam] = useState<SaasUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [toast, setToast] = useState<{message: string, type: 'success'|'error'} | null>(null);

  // Row "more actions" menu -- portaled to document.body (see render below)
  // so it isn't clipped by the table card's overflow-hidden/overflow-x-auto
  // wrappers, which a plain absolutely-positioned dropdown nested inside
  // them was.
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [menuAnchorRect, setMenuAnchorRect] = useState<DOMRect | null>(null);

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingUser, setEditingUser] = useState<SaasUser | null>(null);

  // Reset-password modal state
  const [resetPasswordUser, setResetPasswordUser] = useState<SaasUser | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');
  const [isResettingPassword, setIsResettingPassword] = useState(false);

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
    support_tech: 'bg-info/10 text-info',
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

    if (userRole !== 'super_admin') {
      setToast({ message: t('saas.unauthorized_action'), type: 'error' });
      return;
    }
    if (editingUser && editingUser.uid === dbUser?.id) {
      setToast({ message: t('saas.cannot_edit_own_role'), type: 'error' });
      return;
    }

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
        if (editingUser.role !== formData.role) {
          await supabase.from('audit_logs').insert({
            action: 'تغيير صلاحية موظف SaaS',
            performed_by: dbUser?.id || null,
            performed_by_email: dbUser?.email || null,
            target_tenant_id: null,
            details: `تم تغيير صلاحية ${editingUser.name || editingUser.email} من ${editingUser.role} إلى ${formData.role}`,
            occurred_at: new Date().toISOString(),
            type: 'security'
          });
        }
        setToast({ message: t('saas.update_success', 'تم تحديث بيانات الموظف بنجاح'), type: 'success' });
      } else {
        // Add new
        if (!formData.password || formData.password.length < 6) {
          setToast({ message: t('saas.password_too_short', 'كلمة المرور يجب أن تكون 6 أحرف على الأقل'), type: 'error' });
          setIsSubmitting(false);
          return;
        }

        // Create the Supabase Auth account server-side (requires the
        // service-role key, which never reaches the browser).
        const { data: { session } } = await supabase.auth.getSession();
        const createRes = await fetch('/api/staff/create-account', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token || ''}`
          },
          body: JSON.stringify({ email: formData.email.toLowerCase(), password: formData.password, name: formData.name })
        });
        const createResult = await createRes.json();
        if (!createRes.ok) throw new Error(createResult.error || 'Failed to create team member account');

        const uid = createResult.uid;

        // Ensure user exists in the global users table first due to foreign key constraints
        const { error: userError } = await supabase.from('users').upsert({
          id: uid,
          email: formData.email.toLowerCase(),
          display_name: formData.name
        }, { onConflict: 'id' });

        if (userError) throw userError;

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

        // Store temporary password status in saas_settings
        try {
          const { data: tempPassSetting } = await supabase
            .from('saas_settings')
            .select('*')
            .eq('key', 'temp_passwords')
            .maybeSingle();

          const currentTempPasswords = tempPassSetting?.value && typeof tempPassSetting.value === 'object'
            ? tempPassSetting.value
            : {};

          const updatedTempPasswords = {
            ...currentTempPasswords,
            [uid]: true
          };

          await supabase
            .from('saas_settings')
            .upsert({
              key: 'temp_passwords',
              value: updatedTempPasswords,
              updated_at: new Date().toISOString()
            });
        } catch (tempErr) {
          console.error('Error updating temp_passwords in saas_settings:', tempErr);
        }

        setToast({ message: t('saas.add_success', 'تمت إضافة الموظف بنجاح مع تعيين كلمة مرور مؤقتة'), type: 'success' });
      }

      setIsModalOpen(false);
      fetchTeam();
    } catch (error: any) {
      console.error(error);
      setToast({ message: error ? getFriendlyErrorMessage(error) : t('saas.error_saving', 'حدث خطأ أثناء حفظ البيانات'), type: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const openResetPasswordModal = (member: SaasUser) => {
    setResetPasswordUser(member);
    setResetPasswordValue('');
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetPasswordUser) return;
    if (resetPasswordValue.length < 6) {
      setToast({ message: t('saas.password_too_short', 'كلمة المرور يجب أن تكون 6 أحرف على الأقل'), type: 'error' });
      return;
    }

    setIsResettingPassword(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/saas/reset-member-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token || ''}`
        },
        body: JSON.stringify({ uid: resetPasswordUser.uid, password: resetPasswordValue })
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to reset password');

      setToast({ message: t('saas.password_reset_success', 'تمت إعادة تعيين كلمة المرور بنجاح'), type: 'success' });
      setResetPasswordUser(null);
    } catch (error: any) {
      console.error(error);
      setToast({ message: error ? getFriendlyErrorMessage(error) : t('saas.error_saving', 'حدث خطأ أثناء حفظ البيانات'), type: 'error' });
    } finally {
      setIsResettingPassword(false);
    }
  };

  const handleDeleteMember = async (member: SaasUser) => {
    setActiveMenuId(null);
    if (member.role === 'super_admin') return;

    const ok = await confirm({
      title: t('saas.delete_member_confirm_title', 'حذف الموظف'),
      description: t('saas.delete_member_confirm_desc', {
        name: member.name,
        defaultValue: `سيتم حذف "${member.name}" نهائياً من فريق إدارة المنصة. هل تريد المتابعة؟`,
      }),
      confirmLabel: t('common.delete', 'حذف'),
      danger: true,
    });
    if (!ok) return;

    try {
      const { error } = await supabase.from('saas_users').delete().eq('uid', member.uid);
      if (error) throw error;
      setTeam((prev) => prev.filter((m) => m.uid !== member.uid));
      setToast({ message: t('saas.delete_member_success', 'تم حذف الموظف بنجاح'), type: 'success' });
    } catch (error: any) {
      console.error(error);
      setToast({ message: error ? getFriendlyErrorMessage(error) : t('saas.error_saving', 'حدث خطأ أثناء حفظ البيانات'), type: 'error' });
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
            <IconInput
              startIcon={Search}
              placeholder={t('saas.search_members_placeholder', 'ابحث بالاسم أو البريد...')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
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
      <div className="bg-surface rounded-2xl p-6 shadow-sm border border-border overflow-hidden">
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
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (activeMenuId === member.uid) {
                            setActiveMenuId(null);
                            return;
                          }
                          setMenuAnchorRect(e.currentTarget.getBoundingClientRect());
                          setActiveMenuId(member.uid);
                        }}
                        className={cn(
                          "p-2 text-content-muted hover:text-brand hover:bg-brand/10 rounded-xl transition-all cursor-pointer",
                          activeMenuId === member.uid ? "bg-brand/10 text-brand" : ""
                        )}
                        title={t('common.actions', 'إجراءات')}
                      >
                        <MoreVertical size={18} />
                      </button>

                      {typeof document !== 'undefined' && createPortal(
                        <AnimatePresence>
                          {activeMenuId === member.uid && menuAnchorRect && (
                            <>
                              <div
                                className="fixed inset-0 z-[60] cursor-default"
                                onClick={() => setActiveMenuId(null)}
                              />
                              <motion.div
                                initial={{ opacity: 0, scale: 0.95, y: -10 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.95, y: -10 }}
                                style={{
                                  position: 'fixed',
                                  top: menuAnchorRect.bottom + 6,
                                  ...(isRtl
                                    ? { left: menuAnchorRect.left }
                                    : { right: window.innerWidth - menuAnchorRect.right }),
                                }}
                                className={cn(
                                  "z-[70] bg-surface/95 backdrop-blur-md border border-border shadow-2xl rounded-2xl p-2 min-w-[180px] flex flex-col gap-0.5",
                                  isRtl ? "origin-top-left" : "origin-top-right"
                                )}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveMenuId(null);
                                    handleOpenModal(member);
                                  }}
                                  className="w-full flex items-center gap-2.5 px-2.5 py-2 text-start rounded-xl text-xs font-bold text-content-muted hover:text-brand hover:bg-brand/5 transition-all cursor-pointer"
                                >
                                  <Edit size={14} />
                                  {t('common.edit', 'تعديل')}
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveMenuId(null);
                                    openResetPasswordModal(member);
                                  }}
                                  className="w-full flex items-center gap-2.5 px-2.5 py-2 text-start rounded-xl text-xs font-bold text-content-muted hover:text-brand hover:bg-brand/5 transition-all cursor-pointer"
                                >
                                  <KeyRound size={14} />
                                  {t('saas.reset_password_btn', 'إعادة تعيين كلمة المرور')}
                                </button>

                                {member.role !== 'super_admin' && (
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteMember(member)}
                                    className="w-full flex items-center gap-2.5 px-2.5 py-2 text-start rounded-xl text-xs font-bold text-danger hover:bg-danger/5 transition-all cursor-pointer"
                                  >
                                    <Trash2 size={14} />
                                    {t('common.delete', 'حذف')}
                                  </button>
                                )}
                              </motion.div>
                            </>
                          )}
                        </AnimatePresence>,
                        document.body
                      )}
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
              className="bg-surface w-full max-w-md rounded-3xl shadow-2xl relative z-10 border border-border p-8"
            >
              <h2 className="text-2xl font-black text-content mb-6">
                {editingUser ? t('saas.edit_member', 'تعديل بيانات الموظف') : t('saas.add_member_new', 'إضافة موظف جديد')}
              </h2>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-content-muted">{t('common.full_name', 'الاسم الكامل')}</label>
                  <IconInput
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
                  <IconInput
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
                    <IconInput
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
                  <SmartSelect
                    startIcon={Shield}
                    value={formData.role}
                    onChange={(v) => setFormData({ ...formData, role: v as SaasUserRole })}
                    options={[
                      { value: 'super_admin', label: t('saas.role_super_admin', 'مدير عام') },
                      { value: 'support_tech', label: t('saas.role_support_tech', 'دعم فني') },
                      { value: 'sales', label: t('saas.role_sales', 'مبيعات') },
                      { value: 'billing_admin', label: t('saas.role_billing_admin', 'محاسبة') },
                    ]}
                  />
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
                    className="flex-1 py-3 bg-surface-muted text-content font-bold rounded-2xl hover:bg-border transition-colors disabled:opacity-50 cursor-pointer"
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

      {/* Reset Password Modal */}
      <AnimatePresence>
        {resetPasswordUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => !isResettingPassword && setResetPasswordUser(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-surface w-full max-w-md rounded-3xl shadow-2xl relative z-10 border border-border p-8"
            >
              <h2 className="text-2xl font-black text-content mb-2">
                {t('saas.reset_password_title', 'إعادة تعيين كلمة المرور')}
              </h2>
              <p className="text-content-muted text-sm mb-6">{resetPasswordUser.name} · {resetPasswordUser.email}</p>

              <form onSubmit={handleResetPassword} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-content-muted">{t('saas.new_password_label', 'كلمة المرور الجديدة')}</label>
                  <IconInput
                    type="password"
                    startIcon={Shield}
                    value={resetPasswordValue}
                    onChange={(e) => setResetPasswordValue(e.target.value)}
                    placeholder="******"
                    required
                    minLength={6}
                    className="bg-surface-muted"
                  />
                </div>

                <div className="flex gap-3 pt-6 mt-6">
                  <button
                    type="button"
                    onClick={() => setResetPasswordUser(null)}
                    disabled={isResettingPassword}
                    className="flex-1 py-3 bg-surface-muted text-content font-bold rounded-2xl hover:bg-border transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {t('common.cancel', 'إلغاء')}
                  </button>
                  <button
                    type="submit"
                    disabled={isResettingPassword}
                    className="flex-1 py-3 bg-brand text-white font-bold rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-brand/20 hover:bg-brand/90 transition-all disabled:opacity-50 cursor-pointer"
                  >
                    {isResettingPassword ? (
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    ) : (
                      t('saas.reset_password_btn', 'إعادة تعيين كلمة المرور')
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
