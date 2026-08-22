import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase/client';
import { Role, PermissionKey, PermissionsMap } from '../types';
import { 
  Shield, 
  Plus, 
  Trash2, 
  Edit2, 
  Check, 
  X, 
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Lock,
  Info,
  Database
} from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { seedGlobalRoles, DEFAULT_ROLES, isSaaSRole, isMerchantRole } from '../services/permissionService';
import { SYSTEM_PERMISSIONS } from '../constants/permissions';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '../contexts/ConfirmContext';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';

const ALL_PERMISSIONS: { key: PermissionKey; labelKey: string; categoryKey: string }[] = SYSTEM_PERMISSIONS.map(p => ({
  key: p.id as PermissionKey,
  labelKey: p.nameKey,
  categoryKey: p.categoryKey
}));

const CATEGORIES = Array.from(new Set(ALL_PERMISSIONS.map(p => p.categoryKey)));

export default function GlobalRoleManager() {
  const { t } = useTranslation();
  const { dbUser } = useAuth();
  const { confirm } = useConfirm();
  const { success: toastSuccess } = useToast();

  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [roleToDelete, setRoleToDelete] = useState<Role | null>(null);
  const [newRole, setNewRole] = useState<Partial<Role>>({
    name: '',
    description: '',
    permissions: {} as PermissionsMap,
    tenantId: '',
    isDefault: true
  });
  const [categoryTab, setCategoryTab] = useState<'all' | 'merchant' | 'saas'>('all');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const fetchRoles = async () => {
    const { data, error } = await supabase
      .from('roles')
      .select('*')
      .is('tenant_id', null);
      
    if (error) {
      console.warn('Error fetching system roles:', error);
    }

    const combinedMap = new Map<string, Role>();

    // 1. Base default system roles
    Object.entries(DEFAULT_ROLES).forEach(([key, roleInfo]) => {
      combinedMap.set(key, {
        id: key,
        name: roleInfo.name,
        description: roleInfo.description,
        permissions: roleInfo.permissions,
        tenantId: null,
        isDefault: true,
        roleKey: key
      } as Role);
    });

    // 2. DB system roles
    if (data) {
      data.forEach(d => {
        const key = d.role_key || d.id;
        combinedMap.set(key, {
          id: d.id,
          name: d.name,
          description: d.description,
          permissions: d.permissions,
          tenantId: d.tenant_id,
          isDefault: d.is_default,
          roleKey: key
        } as Role);
      });
    }

    setRoles(Array.from(combinedMap.values()));
    setLoading(false);
  };

  useEffect(() => {
    const rolesChannel = supabase
      .channel('system_roles')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'roles'
      }, async () => {
        fetchRoles();
      })
      .subscribe();

    fetchRoles();
    return () => {
      supabase.removeChannel(rolesChannel);
    };
  }, []);

  const handleTogglePermission = (role: Partial<Role>, permissionKey: PermissionKey) => {
    const currentPermissions = { ...role.permissions } as PermissionsMap;
    currentPermissions[permissionKey] = !currentPermissions[permissionKey];
    
    if (editingRole) {
      setEditingRole({ ...editingRole, permissions: currentPermissions });
    } else {
      setNewRole({ ...newRole, permissions: currentPermissions });
    }
  };

  const handleSaveRole = async () => {
    if (dbUser?.role !== 'super_admin') {
      setToast({ message: t('saas.unauthorized_action'), type: 'error' });
      return;
    }
    const roleToSave = editingRole || newRole;
    if (!roleToSave.name || isSaving) return;

    setIsSaving(true);
    try {
      if (editingRole) {
        const { error } = await supabase
          .from('roles')
          .update({
            name: editingRole.name,
            description: editingRole.description,
            permissions: editingRole.permissions,
            updated_at: new Date().toISOString()
          })
          .eq('id', editingRole.id);
        
        if (error) throw error;
        setToast({ message: t('settings_page.staff.permissions.role_update_success'), type: 'success' });
        setEditingRole(null);
      } else {
        const cleanedName = roleToSave.name?.toLowerCase().replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_') || '';
        const role_key = `sys_${cleanedName || 'role'}_${Date.now()}`;
        const { error } = await supabase
          .from('roles')
          .insert({
            name: roleToSave.name,
            description: roleToSave.description,
            permissions: roleToSave.permissions,
            role_key,
            tenant_id: null,
            is_default: true,
            is_system: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });
        
        if (error) throw error;
        setToast({ message: t('saas.global_roles.create_success'), type: 'success' });
        setIsAdding(false);
        setNewRole({
          name: '',
          description: '',
          permissions: {} as PermissionsMap,
          tenantId: '',
          isDefault: true
        });
      }
      await fetchRoles();
    } catch (error: any) {
      console.warn('Error saving role:', error);
      setToast({ message: t('saas.global_roles.save_failed', { details: error.message || t('orders.unknown_error') }), type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const confirmDeleteRole = (role: Role) => {
    setRoleToDelete(role);
  };

  const executeDeleteRole = async () => {
    if (dbUser?.role !== 'super_admin') {
      setToast({ message: t('saas.unauthorized_action'), type: 'error' });
      return;
    }
    if (!roleToDelete || isSaving) return;

    setIsSaving(true);
    try {
      const { error } = await supabase
        .from("roles")
        .delete()
        .eq("id", roleToDelete.id);
      if (error) throw error;
      setToast({ message: t('settings_page.staff.permissions.delete_success'), type: "success" });
      await fetchRoles();
      setRoleToDelete(null);
    } catch (error: any) {
      console.warn("Error deleting role:", error);
      setToast({ message: t('saas.global_roles.delete_failed', { details: error.message || t('orders.unknown_error') }), type: "error" });
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-black text-gray-900">{t('saas.global_roles.title')}</h2>
          <p className="text-gray-500 font-medium mt-1">{t('saas.global_roles.subtitle')}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={async () => {
              if (await confirm(t('saas.global_roles.confirm_seed'))) {
                const seeded = await seedGlobalRoles();
                if (seeded) toastSuccess(t('saas.global_roles.seed_success'));
                else toastSuccess(t('saas.global_roles.seed_already_exists'));
              }
            }}
            className="flex items-center gap-2 px-6 py-3 bg-indigo-50 text-indigo-600 rounded-2xl font-black hover:bg-indigo-100 transition-all"
          >
            <Database size={20} />
            <span>{t('saas.global_roles.seed_button')}</span>
          </button>
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-2xl font-black hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
          >
            <Plus size={20} />
            <span>{t('saas.global_roles.add_system_role')}</span>
          </button>
        </div>
      </div>

      {/* Category Filter Tabs */}
      <div className="flex items-center gap-2 p-1.5 bg-gray-100 rounded-2xl w-fit">
        <button
          onClick={() => setCategoryTab('all')}
          className={cn(
            "px-5 py-2 text-xs font-black rounded-xl transition-all",
            categoryTab === 'all' ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-900"
          )}
        >
          {t('saas.global_roles.tab_all')} ({roles.length})
        </button>
        <button
          onClick={() => setCategoryTab('merchant')}
          className={cn(
            "px-5 py-2 text-xs font-black rounded-xl transition-all flex items-center gap-1.5",
            categoryTab === 'merchant' ? "bg-indigo-600 text-white shadow-sm" : "text-gray-500 hover:text-gray-900"
          )}
        >
          <span>{t('saas.global_roles.tab_merchant')}</span>
          <span className="text-[10px] opacity-80">({roles.filter(r => isMerchantRole(r.roleKey)).length})</span>
        </button>
        <button
          onClick={() => setCategoryTab('saas')}
          className={cn(
            "px-5 py-2 text-xs font-black rounded-xl transition-all flex items-center gap-1.5",
            categoryTab === 'saas' ? "bg-purple-600 text-white shadow-sm" : "text-gray-500 hover:text-gray-900"
          )}
        >
          <span>{t('saas.global_roles.tab_saas')}</span>
          <span className="text-[10px] opacity-80">({roles.filter(r => isSaaSRole(r.roleKey)).length})</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {roles
          .filter(r => {
            if (categoryTab === 'merchant') return isMerchantRole(r.roleKey);
            if (categoryTab === 'saas') return isSaaSRole(r.roleKey);
            return true;
          })
          .map((role) => {
            const isSaas = isSaaSRole(role.roleKey);

            return (
              <motion.div
                key={role.id}
                layoutId={role.id}
                className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm hover:shadow-md transition-all group"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className={cn(
                    "w-12 h-12 rounded-2xl flex items-center justify-center font-black",
                    isSaas ? "bg-purple-50 text-purple-600" : "bg-indigo-50 text-indigo-600"
                  )}>
                    <Shield size={24} />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "text-[10px] font-black px-2.5 py-1 rounded-full border",
                      isSaas ? "bg-purple-50 text-purple-600 border-purple-200" : "bg-blue-50 text-blue-600 border-blue-200"
                    )}>
                      {isSaas ? t('saas.global_roles.badge_saas_team') : t('saas.global_roles.badge_merchant_roles')}
                    </span>
                    <button
                      onClick={() => setEditingRole(role)}
                      className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"
                    >
                      <Edit2 size={18} />
                    </button>
                    <button
                      onClick={() => confirmDeleteRole(role)}
                      className="p-2 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>

            <h3 className="text-lg font-black text-gray-900">{role.name}</h3>
            <p className="text-sm text-gray-500 font-medium mt-1 line-clamp-2 h-10">
              {role.description || t('saas.global_roles.no_description')}
            </p>

            <div className="mt-6 pt-6 border-t border-gray-50">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400 font-bold">{t('saas.global_roles.granted_permissions')}</span>
                <span className="text-indigo-600 font-black">
                  {Object.values(role.permissions || {}).filter(Boolean).length} / {ALL_PERMISSIONS.length}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {CATEGORIES.slice(0, 3).map(cat => {
                  const count = ALL_PERMISSIONS.filter(p => p.categoryKey === cat && role.permissions?.[p.key]).length;
                  if (count === 0) return null;
                  return (
                    <span key={cat} className="px-2.5 py-1 bg-gray-50 text-gray-600 text-[10px] font-black rounded-lg">
                      {t(cat)}: {count}
                    </span>
                  );
                })}
                {CATEGORIES.length > 3 && (
                  <span className="px-2.5 py-1 bg-gray-50 text-gray-400 text-[10px] font-black rounded-lg">
                    ...
                  </span>
                )}
              </div>
            </div>
          </motion.div>
            );
          })}
      </div>

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {(isAdding || editingRole) && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-3xl w-full max-w-4xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col"
            >
              <div className="p-8 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-indigo-600 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-200">
                    <Shield size={24} />
                  </div>
                  <div>
                    <h3 className="text-xl font-black text-gray-900">
                      {editingRole ? t('saas.global_roles.edit_system_role') : t('saas.global_roles.add_system_role_new')}
                    </h3>
                    <p className="text-sm text-gray-500 font-bold">{t('saas.global_roles.template_defaults_hint')}</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setIsAdding(false);
                    setEditingRole(null);
                  }}
                  className="p-3 hover:bg-white rounded-2xl transition-colors shadow-sm"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
                  <div className="space-y-3">
                    <label className="block text-sm font-black text-gray-700">{t('settings_page.staff.permissions.role_name')}</label>
                    <input
                      type="text"
                      value={editingRole?.name || newRole.name}
                      onChange={(e) => editingRole 
                        ? setEditingRole({ ...editingRole, name: e.target.value })
                        : setNewRole({ ...newRole, name: e.target.value })
                      }
                      placeholder={t('saas.global_roles.role_name_placeholder')}
                      className="w-full p-4 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-indigo-500 font-bold"
                    />
                  </div>
                  <div className="space-y-3">
                    <label className="block text-sm font-black text-gray-700">{t('settings_page.staff.permissions.role_desc')}</label>
                    <input
                      type="text"
                      value={editingRole?.description || newRole.description}
                      onChange={(e) => editingRole
                        ? setEditingRole({ ...editingRole, description: e.target.value })
                        : setNewRole({ ...newRole, description: e.target.value })
                      }
                      placeholder={t('saas.global_roles.role_desc_placeholder')}
                      className="w-full p-4 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-indigo-500 font-bold"
                    />
                  </div>
                </div>

                <div className="space-y-8">
                  <div className="flex items-center justify-between">
                    <h4 className="text-lg font-black text-gray-900 flex items-center gap-2">
                      <Lock className="text-indigo-600" size={20} />
                      {t('saas.global_roles.permissions_matrix')}
                    </h4>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => {
                          const allTrue = {} as PermissionsMap;
                          ALL_PERMISSIONS.forEach(p => allTrue[p.key] = true);
                          if (editingRole) setEditingRole({ ...editingRole, permissions: allTrue });
                          else setNewRole({ ...newRole, permissions: allTrue });
                        }}
                        className="text-xs font-black text-indigo-600 hover:underline"
                      >
                        {t('inventory.select_all')}
                      </button>
                      <span className="text-gray-300">|</span>
                      <button 
                        onClick={() => {
                          const allFalse = {} as PermissionsMap;
                          ALL_PERMISSIONS.forEach(p => allFalse[p.key] = false);
                          if (editingRole) setEditingRole({ ...editingRole, permissions: allFalse });
                          else setNewRole({ ...newRole, permissions: allFalse });
                        }}
                        className="text-xs font-black text-gray-400 hover:underline"
                      >
                        {t('customers.deselect_all')}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                    {CATEGORIES.map(category => (
                      <div key={category} className="space-y-4">
                        <div className="flex items-center gap-2 pb-2 border-b border-gray-100">
                          <div className="w-1.5 h-6 bg-indigo-600 rounded-full" />
                          <h5 className="font-black text-gray-900">{t(category)}</h5>
                        </div>
                        <div className="grid grid-cols-1 gap-3">
                          {ALL_PERMISSIONS.filter(p => p.categoryKey === category).map(permission => {
                            const isChecked = editingRole 
                              ? editingRole.permissions?.[permission.key]
                              : newRole.permissions?.[permission.key];
                            
                            return (
                              <label
                                key={permission.key}
                                className={cn(
                                  "flex items-center justify-between p-4 rounded-2xl cursor-pointer transition-all border-2",
                                  isChecked 
                                    ? "bg-indigo-50 border-indigo-200" 
                                    : "bg-white border-gray-50 hover:border-gray-200"
                                )}
                              >
                                <div className="flex items-center gap-3">
                                  <div className={cn(
                                    "w-6 h-6 rounded-lg flex items-center justify-center transition-all",
                                    isChecked ? "bg-indigo-600 text-white" : "bg-gray-100 text-transparent"
                                  )}>
                                    <Check size={14} strokeWidth={4} />
                                  </div>
                                  <span className={cn(
                                    "text-sm font-bold",
                                    isChecked ? "text-indigo-900" : "text-gray-600"
                                  )}>
                                    {t(permission.labelKey)}
                                  </span>
                                </div>
                                <input
                                  type="checkbox"
                                  className="hidden"
                                  checked={!!isChecked}
                                  onChange={() => handleTogglePermission(editingRole || newRole, permission.key)}
                                />
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="p-8 border-t border-gray-100 bg-gray-50/50 flex items-center justify-between">
                <div className="flex items-center gap-2 text-amber-600">
                  <Info size={18} />
                  <span className="text-xs font-bold">{t('saas.global_roles.edit_warning')}</span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      setIsAdding(false);
                      setEditingRole(null);
                    }}
                    className="px-8 py-4 text-gray-500 font-black hover:bg-white rounded-2xl transition-all"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    onClick={handleSaveRole}
                    className="px-12 py-4 bg-indigo-600 text-white rounded-2xl font-black hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 flex items-center gap-2"
                  >
                    <Check size={20} />
                    <span>{t('saas.global_roles.save_role')}</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {roleToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !isSaving && setRoleToDelete(null)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl p-8 overflow-hidden"
            >
              <div className="w-20 h-20 bg-rose-50 rounded-full flex items-center justify-center mb-6 mx-auto">
                <Trash2 size={32} className="text-rose-600" />
              </div>
              <h3 className="text-xl font-black text-gray-900 text-center mb-2">{t('settings_page.staff.permissions.confirm_delete')}</h3>
              <p className="text-sm font-medium text-gray-500 text-center mb-8">
                {t('saas.global_roles.confirm_delete_role', { name: roleToDelete.name })}
                <br />
                <span className="text-rose-600 font-bold">{t('saas.global_roles.delete_impact_warning')}</span>
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setRoleToDelete(null)}
                  disabled={isSaving}
                  className="flex-1 px-4 py-3 rounded-2xl font-black text-sm text-gray-600 bg-gray-50 hover:bg-gray-100 transition-all disabled:opacity-50"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={executeDeleteRole}
                  disabled={isSaving}
                  className="flex-1 px-4 py-3 rounded-2xl font-black text-sm text-white bg-rose-600 hover:bg-rose-700 transition-all shadow-lg shadow-rose-200 disabled:opacity-50 flex items-center justify-center"
                >
                  {isSaving ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : t('settings_page.staff.permissions.confirm_delete_title')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Toast Alert */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className={cn(
              "fixed top-6 left-6 z-[9999] px-6 py-4 rounded-2xl shadow-xl flex items-center gap-3 border font-black text-sm",
              toast.type === 'success' 
                ? 'bg-[emerald]/10 bg-emerald-50 text-emerald-800 border-emerald-100' 
                : 'bg-[rose]/10 bg-rose-50 text-rose-800 border-rose-100'
            )}
          >
            {toast.type === 'success' ? (
              <Check className="w-5 h-5 text-emerald-600" />
            ) : (
              <AlertCircle className="w-5 h-5 text-rose-600" />
            )}
            <span>{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
