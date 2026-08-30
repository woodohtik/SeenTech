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
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-black text-content">{t('saas.global_roles.title')}</h2>
          <p className="text-content-muted font-medium mt-1">{t('saas.global_roles.subtitle')}</p>
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
            className="flex items-center gap-2 px-6 py-3 bg-brand/10 text-brand rounded-2xl font-black hover:bg-brand/15 transition-all"
          >
            <Database size={20} />
            <span>{t('saas.global_roles.seed_button')}</span>
          </button>
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-2 px-6 py-3 bg-brand text-white rounded-2xl font-black hover:bg-brand/90 transition-all shadow-lg shadow-brand/20"
          >
            <Plus size={20} />
            <span>{t('saas.global_roles.add_system_role')}</span>
          </button>
        </div>
      </div>

      {/* Category Filter Tabs */}
      <div className="flex items-center gap-2 p-1.5 bg-surface-muted rounded-2xl w-fit">
        <button
          onClick={() => setCategoryTab('all')}
          className={cn(
            "px-5 py-2 text-xs font-black rounded-xl transition-all",
            categoryTab === 'all' ? "bg-surface text-content shadow-sm" : "text-content-muted hover:text-content"
          )}
        >
          {t('saas.global_roles.tab_all')} ({roles.length})
        </button>
        <button
          onClick={() => setCategoryTab('merchant')}
          className={cn(
            "px-5 py-2 text-xs font-black rounded-xl transition-all flex items-center gap-1.5",
            categoryTab === 'merchant' ? "bg-brand text-white shadow-sm" : "text-content-muted hover:text-content"
          )}
        >
          <span>{t('saas.global_roles.tab_merchant')}</span>
          <span className="text-[10px] opacity-80">({roles.filter(r => isMerchantRole(r.roleKey)).length})</span>
        </button>
        <button
          onClick={() => setCategoryTab('saas')}
          className={cn(
            "px-5 py-2 text-xs font-black rounded-xl transition-all flex items-center gap-1.5",
            categoryTab === 'saas' ? "bg-purple-600 text-white shadow-sm" : "text-content-muted hover:text-content"
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
                className="bg-surface p-6 rounded-[2rem] border border-border shadow-sm hover:shadow-md transition-all group"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className={cn(
                    "w-12 h-12 rounded-2xl flex items-center justify-center font-black",
                    isSaas ? "bg-purple-50 text-purple-600" : "bg-brand/10 text-brand"
                  )}>
                    <Shield size={24} />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "text-[10px] font-black px-2.5 py-1 rounded-full border",
                      isSaas ? "bg-purple-50 text-purple-600 border-purple-200" : "bg-brand/10 text-brand border-brand/20"
                    )}>
                      {isSaas ? t('saas.global_roles.badge_saas_team') : t('saas.global_roles.badge_merchant_roles')}
                    </span>
                    <button
                      onClick={() => setEditingRole(role)}
                      className="p-2 text-content-muted hover:text-brand hover:bg-brand/10 rounded-xl transition-all"
                    >
                      <Edit2 size={18} />
                    </button>
                    <button
                      onClick={() => confirmDeleteRole(role)}
                      className="p-2 text-content-muted hover:text-danger hover:bg-danger/10 rounded-xl transition-all"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>

            <h3 className="text-lg font-black text-content">{role.name}</h3>
            <p className="text-sm text-content-muted font-medium mt-1 line-clamp-2 h-10">
              {role.description || t('saas.global_roles.no_description')}
            </p>

            <div className="mt-6 pt-6 border-t border-border">
              <div className="flex items-center justify-between text-sm">
                <span className="text-content-muted font-bold">{t('saas.global_roles.granted_permissions')}</span>
                <span className="text-brand font-black">
                  {Object.values(role.permissions || {}).filter(Boolean).length} / {ALL_PERMISSIONS.length}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {CATEGORIES.slice(0, 3).map(cat => {
                  const count = ALL_PERMISSIONS.filter(p => p.categoryKey === cat && role.permissions?.[p.key]).length;
                  if (count === 0) return null;
                  return (
                    <span key={cat} className="px-2.5 py-1 bg-surface-muted text-content-muted text-[10px] font-black rounded-lg">
                      {t(cat)}: {count}
                    </span>
                  );
                })}
                {CATEGORIES.length > 3 && (
                  <span className="px-2.5 py-1 bg-surface-muted text-content-muted text-[10px] font-black rounded-lg">
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
              className="bg-surface rounded-3xl w-full max-w-4xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col"
            >
              <div className="p-8 border-b border-border flex items-center justify-between bg-surface-muted/50">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-brand text-white rounded-2xl flex items-center justify-center shadow-lg shadow-brand/20">
                    <Shield size={24} />
                  </div>
                  <div>
                    <h3 className="text-xl font-black text-content">
                      {editingRole ? t('saas.global_roles.edit_system_role') : t('saas.global_roles.add_system_role_new')}
                    </h3>
                    <p className="text-sm text-content-muted font-bold">{t('saas.global_roles.template_defaults_hint')}</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setIsAdding(false);
                    setEditingRole(null);
                  }}
                  className="p-3 hover:bg-surface rounded-2xl transition-colors shadow-sm"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
                  <div className="space-y-3">
                    <label className="block text-sm font-black text-content">{t('settings_page.staff.permissions.role_name')}</label>
                    <input
                      type="text"
                      value={editingRole?.name || newRole.name}
                      onChange={(e) => editingRole
                        ? setEditingRole({ ...editingRole, name: e.target.value })
                        : setNewRole({ ...newRole, name: e.target.value })
                      }
                      placeholder={t('saas.global_roles.role_name_placeholder')}
                      className="w-full p-4 bg-surface-muted border border-border rounded-xl outline-none transition-all focus:ring-2 focus:ring-brand/20 focus:border-brand font-bold"
                    />
                  </div>
                  <div className="space-y-3">
                    <label className="block text-sm font-black text-content">{t('settings_page.staff.permissions.role_desc')}</label>
                    <input
                      type="text"
                      value={editingRole?.description || newRole.description}
                      onChange={(e) => editingRole
                        ? setEditingRole({ ...editingRole, description: e.target.value })
                        : setNewRole({ ...newRole, description: e.target.value })
                      }
                      placeholder={t('saas.global_roles.role_desc_placeholder')}
                      className="w-full p-4 bg-surface-muted border border-border rounded-xl outline-none transition-all focus:ring-2 focus:ring-brand/20 focus:border-brand font-bold"
                    />
                  </div>
                </div>

                <div className="space-y-8">
                  <div className="flex items-center justify-between">
                    <h4 className="text-lg font-black text-content flex items-center gap-2">
                      <Lock className="text-brand" size={20} />
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
                        className="text-xs font-black text-brand hover:underline"
                      >
                        {t('inventory.select_all')}
                      </button>
                      <span className="text-content-muted">|</span>
                      <button
                        onClick={() => {
                          const allFalse = {} as PermissionsMap;
                          ALL_PERMISSIONS.forEach(p => allFalse[p.key] = false);
                          if (editingRole) setEditingRole({ ...editingRole, permissions: allFalse });
                          else setNewRole({ ...newRole, permissions: allFalse });
                        }}
                        className="text-xs font-black text-content-muted hover:underline"
                      >
                        {t('customers.deselect_all')}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                    {CATEGORIES.map(category => (
                      <div key={category} className="space-y-4">
                        <div className="flex items-center gap-2 pb-2 border-b border-border">
                          <div className="w-1.5 h-6 bg-brand rounded-full" />
                          <h5 className="font-black text-content">{t(category)}</h5>
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
                                    ? "bg-brand/10 border-brand/20"
                                    : "bg-surface border-border hover:border-content-muted/40"
                                )}
                              >
                                <div className="flex items-center gap-3">
                                  <div className={cn(
                                    "w-6 h-6 rounded-lg flex items-center justify-center transition-all",
                                    isChecked ? "bg-brand text-white" : "bg-surface-muted text-transparent"
                                  )}>
                                    <Check size={14} strokeWidth={4} />
                                  </div>
                                  <span className={cn(
                                    "text-sm font-bold",
                                    isChecked ? "text-brand" : "text-content-muted"
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

              <div className="p-8 border-t border-border bg-surface-muted/50 flex items-center justify-between">
                <div className="flex items-center gap-2 text-warning">
                  <Info size={18} />
                  <span className="text-xs font-bold">{t('saas.global_roles.edit_warning')}</span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      setIsAdding(false);
                      setEditingRole(null);
                    }}
                    className="px-8 py-4 text-content-muted font-black hover:bg-surface rounded-2xl transition-all"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    onClick={handleSaveRole}
                    className="px-12 py-4 bg-brand text-white rounded-2xl font-black hover:bg-brand/90 transition-all shadow-lg shadow-brand/20 flex items-center gap-2"
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
              className="relative w-full max-w-sm bg-surface rounded-3xl shadow-2xl p-8 overflow-hidden"
            >
              <div className="w-20 h-20 bg-danger/10 rounded-full flex items-center justify-center mb-6 mx-auto">
                <Trash2 size={32} className="text-danger" />
              </div>
              <h3 className="text-xl font-black text-content text-center mb-2">{t('settings_page.staff.permissions.confirm_delete')}</h3>
              <p className="text-sm font-medium text-content-muted text-center mb-8">
                {t('saas.global_roles.confirm_delete_role', { name: roleToDelete.name })}
                <br />
                <span className="text-danger font-bold">{t('saas.global_roles.delete_impact_warning')}</span>
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setRoleToDelete(null)}
                  disabled={isSaving}
                  className="flex-1 px-4 py-3 rounded-2xl font-black text-sm text-content-muted bg-surface-muted hover:bg-border transition-all disabled:opacity-50"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={executeDeleteRole}
                  disabled={isSaving}
                  className="flex-1 px-4 py-3 rounded-2xl font-black text-sm text-white bg-danger hover:bg-danger/90 transition-all shadow-lg shadow-danger/20 disabled:opacity-50 flex items-center justify-center"
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
                ? 'bg-success/10 text-success border-success/20'
                : 'bg-danger/10 text-danger border-danger/20'
            )}
          >
            {toast.type === 'success' ? (
              <Check className="w-5 h-5 text-success" />
            ) : (
              <AlertCircle className="w-5 h-5 text-danger" />
            )}
            <span>{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
