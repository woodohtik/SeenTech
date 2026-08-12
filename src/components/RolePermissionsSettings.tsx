import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Shield, 
  Check, 
  X, 
  Search, 
  Save, 
  RotateCcw, 
  CheckSquare, 
  Square, 
  Info, 
  AlertCircle,
  Plus,
  Edit2,
  Trash2,
  Users,
  Monitor,
  ShoppingBag,
  FileText,
  Boxes,
  Truck,
  Settings,
  Sparkles,
  Zap,
  Lock
} from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { auth } from '../lib/firebase';
import { Role, PermissionKey, PermissionsMap } from '../types';
import { SYSTEM_PERMISSIONS } from '../constants/permissions';
import { DEFAULT_ROLES, updateRolePermissions, createCustomRole, isMerchantRole, isSaaSRole } from '../services/permissionService';
import { cn } from '../lib/utils';
import { useToast } from '../contexts/ToastContext';
import { useTranslation } from 'react-i18next';
import { useDirection } from '../lib/direction';

interface RolePermissionsSettingsProps {
  tenantId?: string | null;
  isSuperAdmin?: boolean;
  onPermissionsSaved?: () => void;
}

export const RolePermissionsSettings: React.FC<RolePermissionsSettingsProps> = ({ 
  tenantId, 
  isSuperAdmin = false, 
  onPermissionsSaved 
}) => {
  const [roles, setRoles] = useState<Role[]>([]);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [permissionsState, setPermissionsState] = useState<PermissionsMap>({} as PermissionsMap);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [roleCategoryFilter, setRoleCategoryFilter] = useState<'all' | 'merchant' | 'saas'>(isSuperAdmin ? 'all' : 'merchant');
  const [hasChanges, setHasChanges] = useState(false);
  const [showCreateRoleModal, setShowCreateRoleModal] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDesc, setNewRoleDesc] = useState('');

  const { success, error, info } = useToast();
  const { t } = useTranslation();
  const { dir } = useDirection();

  // Translation helpers for permissions and categories
  // `cat` is a permission `categoryKey` (e.g. 'permissions.categories.orders');
  // the trailing segment is the stable slug used by the settings_page.* keys.
  const getCategoryKey = (cat: string): string => {
    return cat.split('.').pop() || cat;
  };

  const getTransCat = (cat: string): string => {
    const key = getCategoryKey(cat);
    return t(`settings_page.staff.permissions.categories.${key}`, { defaultValue: cat });
  };

  const getTransPermName = (permId: string, cat: string, defaultName: string): string => {
    const catKey = getCategoryKey(cat);
    return t(`settings_page.staff.permissions.items.${permId}.${catKey}.name`, { defaultValue: defaultName });
  };

  const getTransPermDesc = (permId: string, cat: string, defaultDesc: string): string => {
    const catKey = getCategoryKey(cat);
    return t(`settings_page.staff.permissions.items.${permId}.${catKey}.description`, { defaultValue: defaultDesc });
  };

  const fetchRoles = async () => {
    setLoading(true);
    try {
      // 1. Fetch system roles (tenant_id IS NULL)
      const { data: systemRolesData } = await supabase
        .from('roles')
        .select('*')
        .is('tenant_id', null);

      // 2. Fetch system roles_permissions (tenant_id IS NULL)
      const { data: systemRolesPermissionsData } = await supabase
        .from('roles_permissions')
        .select('*')
        .is('tenant_id', null);

      const sysRpMap = new Map((systemRolesPermissionsData || []).map(rp => [rp.role_key, rp.permissions]));

      // 3. If in tenant mode, fetch tenant custom roles and tenant roles_permissions
      let tenantRpMap = new Map();
      let tenantRolesData: any[] = [];
      if (tenantId && !isSuperAdmin) {
        const { data: tRoles } = await supabase
          .from('roles')
          .select('*')
          .eq('tenant_id', tenantId);
        if (tRoles) tenantRolesData = tRoles;

        const { data: tRpData } = await supabase
          .from('roles_permissions')
          .select('*')
          .eq('tenant_id', tenantId);
        if (tRpData) {
          tenantRpMap = new Map(tRpData.map(rp => [rp.role_key, rp.permissions]));
        }
      }

      const combinedRolesMap = new Map<string, Role>();

      // Seed default system roles as base
      Object.entries(DEFAULT_ROLES).forEach(([key, roleInfo]) => {
        const sysPerms = sysRpMap.get(key) || roleInfo.permissions;
        const isCustomizedByTenant = Boolean(tenantId && !isSuperAdmin && tenantRpMap.has(key));
        const finalPerms = isCustomizedByTenant ? tenantRpMap.get(key) : sysPerms;

        combinedRolesMap.set(key, {
          id: key,
          name: roleInfo.name,
          description: roleInfo.description,
          roleKey: key,
          permissions: finalPerms as PermissionsMap,
          tenantId: isCustomizedByTenant ? tenantId : null,
          isDefault: !isCustomizedByTenant,
          createdAt: new Date().toISOString(),
          category: roleInfo.category || (isSaaSRole(key) ? 'saas' : 'merchant')
        });
      });

      // Override with DB system roles
      (systemRolesData || []).forEach(r => {
        const key = r.role_key || r.id;
        const sysPerms = sysRpMap.get(key) || r.permissions || DEFAULT_ROLES[key]?.permissions || {};
        const isCustomizedByTenant = Boolean(tenantId && !isSuperAdmin && tenantRpMap.has(key));
        const finalPerms = isCustomizedByTenant ? tenantRpMap.get(key) : sysPerms;
        const defaultCategory = DEFAULT_ROLES[key]?.category || (isSaaSRole(key) ? 'saas' : 'merchant');

        combinedRolesMap.set(key, {
          id: r.id,
          name: r.name,
          description: r.description || '',
          roleKey: key,
          permissions: finalPerms as PermissionsMap,
          tenantId: isCustomizedByTenant ? tenantId : r.tenant_id,
          isDefault: !isCustomizedByTenant,
          createdAt: r.created_at || new Date().toISOString(),
          category: defaultCategory
        });
      });

      // If tenant mode, override with Tenant specific custom created roles
      if (tenantId && !isSuperAdmin) {
        tenantRolesData.forEach(r => {
          const key = r.role_key || r.id;
          const finalPerms = tenantRpMap.get(key) || r.permissions || {};
          combinedRolesMap.set(key, {
            id: r.id,
            name: r.name,
            description: r.description || '',
            roleKey: key,
            permissions: finalPerms as PermissionsMap,
            tenantId: r.tenant_id,
            isDefault: false,
            createdAt: r.created_at || new Date().toISOString(),
            category: 'merchant'
          });
        });
      }

      const roleList = Array.from(combinedRolesMap.values());
      setRoles(roleList);

      if (roleList.length > 0) {
        const validList = isSuperAdmin ? roleList : roleList.filter(r => r.category === 'merchant' || isMerchantRole(r.roleKey));
        const defaultRole = validList.find(r => r.roleKey === 'manager') || validList[0] || roleList[0];
        setSelectedRole(defaultRole);
        setPermissionsState((defaultRole.permissions || {}) as PermissionsMap);
      }
    } catch (err) {
      console.error('Error fetching roles for settings:', err);
      error(t('permissions.load_failed_title'), t('permissions.load_failed_desc'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRoles();
  }, [tenantId, isSuperAdmin]);

  const isSelectedRoleDefault = Boolean(
    selectedRole && (
      selectedRole.roleKey === 'owner' ||
      selectedRole.isDefault ||
      !selectedRole.tenantId ||
      selectedRole.tenantId === 'system' ||
      Boolean(DEFAULT_ROLES[selectedRole.roleKey])
    )
  );

  const isReadOnlyRole = Boolean(selectedRole?.roleKey === 'owner' || (!isSuperAdmin && isSelectedRoleDefault));

  const handleSelectRole = (role: Role) => {
    if (hasChanges) {
      if (!window.confirm(t('permissions.unsaved_changes_confirm'))) {
        return;
      }
    }
    setSelectedRole(role);
    setPermissionsState((role.permissions || {}) as PermissionsMap);
    setHasChanges(false);
  };

  const handleTogglePermission = (permId: string) => {
    if (isReadOnlyRole) return; // Read-only or protected role permissions cannot be changed
    setPermissionsState(prev => {
      const updated = {
        ...prev,
        [permId]: !prev[permId as PermissionKey]
      };
      setHasChanges(true);
      return updated;
    });
  };

  const handleSelectAll = (category?: string) => {
    if (isReadOnlyRole) return;
    setPermissionsState(prev => {
      const updated = { ...prev };
      SYSTEM_PERMISSIONS.forEach(p => {
        if (!category || category === 'all' || p.categoryKey === category) {
          updated[p.id as PermissionKey] = true;
        }
      });
      return updated;
    });
    setHasChanges(true);
  };

  const handleDeselectAll = (category?: string) => {
    if (isReadOnlyRole) return;
    setPermissionsState(prev => {
      const updated = { ...prev };
      SYSTEM_PERMISSIONS.forEach(p => {
        if (!category || category === 'all' || p.categoryKey === category) {
          updated[p.id as PermissionKey] = false;
        }
      });
      return updated;
    });
    setHasChanges(true);
  };

  const handleResetToDefault = () => {
    if (!selectedRole || isReadOnlyRole) return;
    const defaultTemplate = DEFAULT_ROLES[selectedRole.roleKey]?.permissions || DEFAULT_ROLES.tailor.permissions;
    setPermissionsState({ ...defaultTemplate });
    setHasChanges(true);
    info(t('permissions.reset_title'), t('permissions.reset_desc'));
  };

  const handleSaveChanges = async () => {
    if (!selectedRole || saving || isReadOnlyRole) return;

    setSaving(true);
    try {
      const targetTenantId = isSuperAdmin ? null : (tenantId || null);

      await updateRolePermissions(
        selectedRole.id,
        permissionsState,
        auth.currentUser?.uid || null,
        auth.currentUser?.email || '',
        targetTenantId,
        isSuperAdmin
      );

      // Save directly to roles_permissions table in Supabase
      const roleKey = selectedRole.roleKey || selectedRole.id;
      if (typeof localStorage !== 'undefined') {
        const cacheKey = isSuperAdmin 
          ? `role_permissions_global_${roleKey}` 
          : `role_permissions_${targetTenantId}_${roleKey}`;
        localStorage.setItem(cacheKey, JSON.stringify(permissionsState));
      }

      const isUuid = (val: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
      const validRoleId = selectedRole && isUuid(selectedRole.id) ? selectedRole.id : null;

      if (isSuperAdmin) {
        // Upsert system global role permissions
        const { data: existingSysRp } = await supabase
          .from('roles_permissions')
          .select('id')
          .is('tenant_id', null)
          .eq('role_key', roleKey)
          .maybeSingle();

        if (existingSysRp) {
          await supabase.from('roles_permissions').update({
            permissions: permissionsState,
            updated_at: new Date().toISOString()
          }).eq('id', existingSysRp.id);
        } else {
          await supabase.from('roles_permissions').insert({
            role_id: validRoleId,
            role_key: roleKey,
            tenant_id: null,
            permissions: permissionsState,
            updated_at: new Date().toISOString()
          });
        }
      } else if (targetTenantId) {
        await supabase.from('roles_permissions').upsert({
          role_id: validRoleId,
          role_key: roleKey,
          tenant_id: targetTenantId,
          permissions: permissionsState,
          updated_at: new Date().toISOString()
        }, { onConflict: 'tenant_id,role_key' });
      }

      // Update local state
      setRoles(prev => prev.map(r => r.id === selectedRole.id ? { 
        ...r, 
        permissions: permissionsState,
        tenantId: targetTenantId,
        isDefault: isSuperAdmin
      } : r));
      setHasChanges(false);

      // Trigger immediate event across the app
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('permissions_updated', { 
          detail: { tenantId: targetTenantId, roleKey, isGlobal: isSuperAdmin } 
        }));
      }

      if (isSuperAdmin) {
        success(t('permissions.saved_global_title'), t('permissions.saved_global_desc', { role: selectedRole.name }));
      } else {
        success(t('permissions.saved_tenant_title'), t('permissions.saved_tenant_desc', { role: selectedRole.name }));
      }

      if (onPermissionsSaved) onPermissionsSaved();
    } catch (err) {
      console.error('Error saving role permissions:', err);
      error(t('permissions.save_failed_title'), t('permissions.save_failed_desc'));
    } finally {
      setSaving(false);
    }
  };

  const handleCreateCustomRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoleName.trim()) return;

    setSaving(true);
    try {
      const initialPerms = selectedRole?.permissions
        ? { ...selectedRole.permissions }
        : DEFAULT_ROLES.cashier.permissions;
      await createCustomRole(
        tenantId,
        newRoleName,
        newRoleDesc,
        initialPerms,
        auth.currentUser?.uid || null,
        auth.currentUser?.email || ''
      );
      success(t('permissions.role_created_title'), t('permissions.role_created_desc', { role: newRoleName }));
      setShowCreateRoleModal(false);
      setNewRoleName('');
      setNewRoleDesc('');
      await fetchRoles();
    } catch (err) {
      console.error('Error creating custom role:', err);
      error(t('common.error'), t('permissions.create_role_failed'));
    } finally {
      setSaving(false);
    }
  };

  // Filter permissions
  const categories = Array.from(new Set(SYSTEM_PERMISSIONS.map(p => p.categoryKey)));

  const filteredPermissions = SYSTEM_PERMISSIONS.filter(p => {
    const transName = getTransPermName(p.id, p.categoryKey, p.name);
    const transDesc = getTransPermDesc(p.id, p.categoryKey, p.description);
    const matchesSearch = transName.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          transDesc.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          p.id.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || p.categoryKey === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const getEnabledCount = (rolePerms?: PermissionsMap) => {
    if (!rolePerms) return 0;
    return Object.values(rolePerms).filter(Boolean).length;
  };

  if (loading) {
    return (
      <div className="bg-surface rounded-3xl p-12 border border-border flex flex-col items-center justify-center min-h-[400px]">
        <div className="w-12 h-12 border-4 border-brand border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm font-bold text-content-muted">{t('permissions.loading_matrix')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8" dir={dir}>
      {/* Top Banner Header */}
      <div className="bg-gradient-to-r from-brand/10 via-surface to-brand/5 p-6 md:p-8 rounded-[2.5rem] border border-brand/20 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-brand text-white rounded-2xl shadow-lg shadow-brand/20">
              <Shield size={28} />
            </div>
            <div>
              <h2 className="text-2xl font-black text-content flex items-center gap-2">
                {isSuperAdmin ? t('permissions.title_super_admin') : t('permissions.title_tenant')}
                <span className="text-xs bg-emerald-500/10 text-emerald-600 px-3 py-1 rounded-full border border-emerald-500/20 font-bold flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
                  {isSuperAdmin ? t('permissions.badge_super_admin') : t('permissions.badge_tenant')}
                </span>
              </h2>
              <p className="text-xs text-content-muted font-bold mt-1">
                {isSuperAdmin 
                  ? t('permissions.subtitle_super_admin')
                  : t('permissions.subtitle_tenant')
                }
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto justify-end">
          <button
            onClick={() => setShowCreateRoleModal(true)}
            className="px-5 py-3 bg-surface hover:bg-surface-muted text-content font-bold text-xs rounded-2xl border border-border flex items-center gap-2 transition-all shadow-sm"
          >
            <Plus size={16} className="text-brand" />
            <span>{t('settings_page.staff.add_custom_role')}</span>
          </button>
          
          <button
            onClick={handleSaveChanges}
            disabled={saving || !hasChanges || selectedRole?.roleKey === 'owner'}
            className={cn(
              "px-6 py-3 rounded-2xl text-xs font-black transition-all flex items-center gap-2 shadow-lg",
              hasChanges 
                ? "bg-brand text-white shadow-brand/20 hover:bg-brand/90 scale-105" 
                : "bg-surface-muted text-content-muted border border-border opacity-60 cursor-not-allowed"
            )}
          >
            {saving ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Save size={16} />
            )}
            <span>{hasChanges ? (isSuperAdmin ? t('permissions.save_global_template') : t('permissions.save_changes_now')) : t('permissions.changes_saved')}</span>
          </button>
        </div>
      </div>

      {/* Main Content Layout */}
      {(() => {
        const displayedRoles = roles.filter(role => {
          const isSaas = role.category === 'saas' || isSaaSRole(role.roleKey);

          // If inside a merchant's store, strictly exclude SaaS internal roles
          if (!isSuperAdmin && isSaas) {
            return false;
          }

          // If super admin and filtering by tab
          if (isSuperAdmin && roleCategoryFilter !== 'all') {
            if (roleCategoryFilter === 'merchant' && isSaas) return false;
            if (roleCategoryFilter === 'saas' && !isSaas) return false;
          }

          return true;
        });

        return (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Sidebar Role Selector Tabs */}
            <div className="lg:col-span-4 space-y-4">
              <div className="bg-surface rounded-[2.5rem] border border-border shadow-sm p-5 space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-border">
                  <h3 className="text-xs font-black text-content-muted uppercase tracking-wider">
                    {isSuperAdmin ? t('permissions.roles_list_super_admin') : t('permissions.roles_list_tenant')}
                  </h3>
                  <span className="text-[10px] bg-brand/10 text-brand px-2.5 py-1 rounded-full font-black">
                    {t('permissions.roles_count', { n: displayedRoles.length })}
                  </span>
                </div>

                {isSuperAdmin && (
                  <div className="flex items-center gap-1 p-1 bg-surface-muted rounded-2xl border border-border">
                    <button
                      type="button"
                      onClick={() => setRoleCategoryFilter('all')}
                      className={cn(
                        "flex-1 py-1.5 text-[11px] font-black rounded-xl transition-all",
                        roleCategoryFilter === 'all' 
                          ? "bg-surface text-content shadow-sm" 
                          : "text-content-muted hover:text-content"
                      )}
                    >
                      {t('permissions.filter_all_roles')} ({roles.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setRoleCategoryFilter('merchant')}
                      className={cn(
                        "flex-1 py-1.5 text-[11px] font-black rounded-xl transition-all flex items-center justify-center gap-1",
                        roleCategoryFilter === 'merchant' 
                          ? "bg-brand text-white shadow-sm" 
                          : "text-content-muted hover:text-content"
                      )}
                    >
                      <span>{t('permissions.filter_merchants')}</span>
                      <span className="text-[9px] opacity-80">
                        ({roles.filter(r => (r.category || (isSaaSRole(r.roleKey) ? 'saas' : 'merchant')) === 'merchant').length})
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setRoleCategoryFilter('saas')}
                      className={cn(
                        "flex-1 py-1.5 text-[11px] font-black rounded-xl transition-all flex items-center justify-center gap-1",
                        roleCategoryFilter === 'saas' 
                          ? "bg-purple-600 text-white shadow-sm" 
                          : "text-content-muted hover:text-content"
                      )}
                    >
                      <span>{t('permissions.filter_saas')}</span>
                      <span className="text-[9px] opacity-80">
                        ({roles.filter(r => (r.category || (isSaaSRole(r.roleKey) ? 'saas' : 'merchant')) === 'saas').length})
                      </span>
                    </button>
                  </div>
                )}

                <div className="space-y-2.5">
                  {displayedRoles.map(role => {
                    const isSelected = selectedRole?.id === role.id;
                    const isOwner = role.roleKey === 'owner';
                    const isTenantCustom = Boolean(role.tenantId);
                    const isSaas = role.category === 'saas' || isSaaSRole(role.roleKey);
                    const enabledCount = getEnabledCount(role.permissions);
                    const totalCount = SYSTEM_PERMISSIONS.length;

                    return (
                      <button
                        key={role.id}
                        onClick={() => handleSelectRole(role)}
                        className={cn(
                          "w-full p-4 rounded-2xl text-right transition-all flex items-center justify-between border relative overflow-hidden group cursor-pointer",
                          isSelected
                            ? "bg-brand/10 border-brand shadow-md shadow-brand/5 font-black"
                            : "bg-surface hover:bg-surface-muted/60 border-border"
                        )}
                      >
                        {isSelected && (
                          <div className="absolute right-0 top-0 bottom-0 w-1.5 bg-brand rounded-r-full" />
                        )}

                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "w-10 h-10 rounded-xl flex items-center justify-center font-black transition-colors shrink-0",
                            isOwner ? "bg-amber-500/10 text-amber-600" :
                            isSaas ? "bg-purple-500/10 text-purple-600" :
                            role.roleKey === 'manager' ? "bg-brand/10 text-brand" :
                            role.roleKey === 'cashier' ? "bg-blue-500/10 text-blue-600" :
                            role.roleKey === 'accountant' ? "bg-emerald-500/10 text-emerald-600" :
                            "bg-indigo-500/10 text-indigo-600"
                          )}>
                            {isOwner ? <Lock size={18} /> : <Shield size={18} />}
                          </div>

                          <div className="text-right overflow-hidden">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-black text-content truncate">{role.name}</span>
                              {isOwner && (
                                <span className="text-[9px] bg-amber-500/10 text-amber-600 px-2 py-0.5 rounded-full font-bold">
                                  {t('permissions.badge_full_access')}
                                </span>
                              )}
                              {isSuperAdmin && (
                                <span className={cn(
                                  "text-[9px] px-2 py-0.5 rounded-full font-black border",
                                  isSaas
                                    ? "bg-purple-500/10 text-purple-600 border-purple-500/20"
                                    : "bg-blue-500/10 text-blue-600 border-blue-500/20"
                                )}>
                                  {isSaas ? t('permissions.filter_saas') : t('permissions.badge_merchant_roles')}
                                </span>
                              )}
                              {!isOwner && isTenantCustom && !isSuperAdmin && (
                                <span className="text-[9px] bg-emerald-500/10 text-emerald-600 px-2 py-0.5 rounded-full font-bold">
                                  {t('permissions.badge_custom_to_store')}
                                </span>
                              )}
                              {!isOwner && !isTenantCustom && !isSuperAdmin && (
                                <span className="text-[9px] bg-brand/10 text-brand px-2 py-0.5 rounded-full font-bold">
                                  {t('permissions.badge_standard_template')}
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-content-muted font-bold truncate mt-0.5">
                              {role.description || t('permissions.no_description')}
                            </p>
                          </div>
                        </div>

                        <div className="text-left shrink-0">
                          <div className="text-xs font-black text-brand">
                            {enabledCount} / {totalCount}
                          </div>
                          <div className="text-[9px] text-content-muted font-bold mt-0.5">{t('permissions.enabled_permissions_label')}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

          <div className="p-5 bg-amber-500/5 rounded-2xl border border-amber-500/20 text-right space-y-2">
            <div className="flex items-center gap-2 text-amber-600 font-black text-xs">
              <Info size={16} />
              <span>{t('permissions.owner_note_title')}</span>
            </div>
            <p className="text-[11px] text-content-muted font-medium leading-relaxed">
              {t('permissions.owner_note_desc')}
            </p>
          </div>
        </div>

        {/* Permission Matrix Toggles */}
        <div className="lg:col-span-8 space-y-6">
          {selectedRole ? (
            <div className="bg-surface rounded-[2.5rem] border border-border shadow-sm p-6 md:p-8 space-y-6">
              {/* Role Header Controls */}
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-6 border-b border-border">
                <div>
                  <h3 className="text-xl font-black text-content flex items-center gap-2">
                    {t('permissions.edit_permissions_for')} <span className="text-brand">{selectedRole.name}</span>
                  </h3>
                  <p className="text-xs text-content-muted font-bold mt-1">
                    {selectedRole.description}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
                  <button
                    onClick={() => handleSelectAll(selectedCategory)}
                    disabled={isReadOnlyRole}
                    className="px-3.5 py-2 bg-surface-muted hover:bg-border text-content text-xs font-bold rounded-xl border border-border transition-all flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <CheckSquare size={14} className="text-brand" />
                    <span>{t('inventory.select_all')}</span>
                  </button>

                  <button
                    onClick={() => handleDeselectAll(selectedCategory)}
                    disabled={isReadOnlyRole}
                    className="px-3.5 py-2 bg-surface-muted hover:bg-border text-content text-xs font-bold rounded-xl border border-border transition-all flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Square size={14} className="text-content-muted" />
                    <span>{t('customers.deselect_all')}</span>
                  </button>

                  <button
                    onClick={handleResetToDefault}
                    disabled={isReadOnlyRole}
                    className="px-3.5 py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 text-xs font-bold rounded-xl border border-amber-500/20 transition-all flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <RotateCcw size={14} />
                    <span>{t('permissions.default_button')}</span>
                  </button>
                </div>
              </div>

              {/* Warning Banner for Merchant Viewing Default Role */}
              {!isSuperAdmin && isSelectedRoleDefault && (
                <div className="p-5 bg-amber-500/10 rounded-2xl border border-amber-500/30 text-right space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-2.5 text-amber-700 dark:text-amber-400 font-black text-sm">
                      <Lock size={18} />
                      <span>{t('permissions.protected_default_role')}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setNewRoleName(t('permissions.suggested_custom_role_name', { role: selectedRole.name }));
                        setNewRoleDesc(t('permissions.suggested_custom_role_desc', { role: selectedRole.name }));
                        setShowCreateRoleModal(true);
                      }}
                      className="px-4 py-2 bg-brand text-white font-black text-xs rounded-xl shadow-sm hover:bg-brand/90 transition-all flex items-center gap-1.5 cursor-pointer"
                    >
                      <Plus size={14} />
                      <span>{t('permissions.create_role_from_this')}</span>
                    </button>
                  </div>
                  <p className="text-xs text-content-muted font-bold leading-relaxed">
                    {t('permissions.protected_default_note')}
                  </p>
                </div>
              )}

              {/* Filters Bar */}
              <div className="flex flex-col md:flex-row items-center gap-4">
                <div className="relative flex-1 w-full">
                  <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-content-muted" size={18} />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder={t('permissions.search_placeholder')}
                    className="w-full bg-surface-muted border border-border rounded-2xl py-3 pr-11 pl-4 text-xs font-bold text-content focus:border-brand outline-none transition-all"
                  />
                  {searchTerm && (
                    <button onClick={() => setSearchTerm('')} className="absolute left-4 top-1/2 -translate-y-1/2 text-content-muted hover:text-content">
                      <X size={16} />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto pb-2 md:pb-0 scrollbar-none">
                  <button
                    onClick={() => setSelectedCategory('all')}
                    className={cn(
                      "px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap shrink-0",
                      selectedCategory === 'all'
                        ? "bg-brand text-white font-black shadow-md shadow-brand/10"
                        : "bg-surface-muted text-content-muted hover:text-content"
                    )}
                  >
                    {t('settings.staff.permissions.all_roles')} ({SYSTEM_PERMISSIONS.length})
                  </button>
                  {categories.map(cat => {
                    const count = SYSTEM_PERMISSIONS.filter(p => p.categoryKey === cat).length;
                    return (
                      <button
                        key={cat}
                        onClick={() => setSelectedCategory(cat)}
                        className={cn(
                          "px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap shrink-0",
                          selectedCategory === cat
                            ? "bg-brand text-white font-black shadow-md shadow-brand/10"
                            : "bg-surface-muted text-content-muted hover:text-content"
                        )}
                      >
                        {getTransCat(cat)} ({count})
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Toggles Grid */}
              <div className="space-y-6 pt-2">
                {categories
                  .filter(cat => selectedCategory === 'all' || selectedCategory === cat)
                  .map(category => {
                    const categoryPerms = filteredPermissions.filter(p => p.categoryKey === category);
                    if (categoryPerms.length === 0) return null;

                    return (
                      <div key={category} className="space-y-3 bg-surface-muted/30 p-5 rounded-3xl border border-border/80">
                        <div className="flex items-center justify-between pb-2 border-b border-border/50">
                          <h4 className="text-xs font-black text-brand flex items-center gap-2 uppercase tracking-wider">
                            <span className="w-2.5 h-2.5 rounded-full bg-brand"></span>
                            {getTransCat(category)}
                          </h4>
                          <span className="text-[10px] text-content-muted font-bold">
                            {categoryPerms.filter(p => permissionsState[p.id as PermissionKey]).length} / {categoryPerms.length} {t('settings.staff.permissions.enabled')}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {categoryPerms.map(perm => {
                            const isEnabled = permissionsState[perm.id as PermissionKey] === true;

                            return (
                              <div
                                key={perm.id}
                                onClick={() => !isReadOnlyRole && handleTogglePermission(perm.id)}
                                className={cn(
                                  "p-4 rounded-2xl border transition-all flex items-start justify-between gap-3 group select-none",
                                  isReadOnlyRole ? "opacity-75 cursor-not-allowed bg-surface border-border" : "cursor-pointer",
                                  isEnabled && !isReadOnlyRole
                                    ? "bg-surface border-brand/40 shadow-sm"
                                    : "bg-surface/60 hover:bg-surface border-border hover:border-brand/30"
                                )}
                              >
                                <div className="space-y-1">
                                  <div className="text-xs font-black text-content group-hover:text-brand transition-colors flex items-center gap-2 flex-wrap">
                                    <span>{getTransPermName(perm.id, perm.categoryKey, perm.name)}</span>
                                    {perm.id.endsWith('.view') && (
                                      <span className="text-[9px] bg-blue-500/10 text-blue-600 px-2 py-0.2 rounded font-bold">
                                        {t('settings.staff.permissions.view_badge')}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[10px] text-content-muted font-bold leading-relaxed">
                                    {getTransPermDesc(perm.id, perm.categoryKey, perm.description)}
                                  </p>
                                </div>

                                <button
                                  type="button"
                                  disabled={isReadOnlyRole}
                                  className={cn(
                                    "w-12 h-6 rounded-full relative transition-all duration-300 shrink-0 mt-0.5",
                                    isEnabled ? (isReadOnlyRole ? "bg-brand/50" : "bg-brand") : "bg-border",
                                    isReadOnlyRole && "opacity-60 cursor-not-allowed"
                                  )}
                                >
                                  <div
                                    className={cn(
                                      "absolute top-1 w-4 h-4 bg-white rounded-full shadow-md transition-all duration-300",
                                      isEnabled ? "right-1" : "right-7"
                                    )}
                                  />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
              </div>

              {/* Bottom Actions Bar */}
              {hasChanges && (
                <div className="sticky bottom-4 bg-brand/95 backdrop-blur-md text-white p-4 rounded-2xl shadow-xl flex items-center justify-between gap-4 border border-brand/20 animate-bounce-short">
                  <div className="flex items-center gap-2 text-xs font-bold">
                    <Sparkles size={18} />
                    <span>{t('permissions.unsaved_banner', { role: selectedRole.name })}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setPermissionsState((selectedRole.permissions || {}) as PermissionsMap);
                        setHasChanges(false);
                      }}
                      className="px-4 py-2 bg-white/20 hover:bg-white/30 text-white rounded-xl text-xs font-bold transition-all"
                    >
                      {t('permissions.discard_changes')}
                    </button>
                    <button
                      onClick={handleSaveChanges}
                      disabled={saving}
                      className="px-5 py-2 bg-white text-brand font-black rounded-xl text-xs transition-all hover:bg-surface shadow-md"
                    >
                      {saving ? t('common.saving') : t('permissions.save_permissions_now')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-surface rounded-[2.5rem] border border-border p-12 text-center text-content-muted font-bold">
              {t('permissions.select_role_hint')}
            </div>
          )}
        </div>
      </div>
        );
      })()}

      {/* Create Custom Role Modal */}
      <AnimatePresence>
        {showCreateRoleModal && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" dir={dir}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-surface p-8 rounded-3xl border border-border shadow-2xl max-w-md w-full space-y-6"
            >
              <div className="flex items-center justify-between pb-4 border-b border-border">
                <h3 className="text-lg font-black text-content flex items-center gap-2">
                  <Plus size={20} className="text-brand" />
                  {t('permissions.add_custom_role_modal_title')}
                </h3>
                <button onClick={() => setShowCreateRoleModal(false)} className="text-content-muted hover:text-content">
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleCreateCustomRole} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-black text-content-muted">{t('permissions.custom_role_name_label')}</label>
                  <input
                    type="text"
                    required
                    placeholder={t('permissions.custom_role_name_placeholder')}
                    value={newRoleName}
                    onChange={(e) => setNewRoleName(e.target.value)}
                    className="w-full bg-surface-muted border border-border rounded-2xl p-3.5 text-xs font-bold text-content focus:border-brand outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-black text-content-muted">{t('permissions.custom_role_desc_label')}</label>
                  <textarea
                    rows={3}
                    placeholder={t('permissions.custom_role_desc_placeholder')}
                    value={newRoleDesc}
                    onChange={(e) => setNewRoleDesc(e.target.value)}
                    className="w-full bg-surface-muted border border-border rounded-2xl p-3.5 text-xs font-bold text-content focus:border-brand outline-none resize-none"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
                  <button
                    type="button"
                    onClick={() => setShowCreateRoleModal(false)}
                    className="px-5 py-2.5 bg-surface-muted hover:bg-border text-content text-xs font-bold rounded-xl transition-all"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={saving || !newRoleName.trim()}
                    className="px-6 py-2.5 bg-brand text-white text-xs font-black rounded-xl transition-all shadow-md shadow-brand/10 disabled:opacity-50"
                  >
                    {saving ? t('settings_page.staff.seeding_roles') : t('permissions.create_custom_role_submit')}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default RolePermissionsSettings;
