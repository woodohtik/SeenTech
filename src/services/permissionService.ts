import i18n from 'i18next';
import { supabase } from '../lib/supabase/client';
import { Role, PermissionsMap, Staff, PermissionKey } from '../types';
import { SYSTEM_PERMISSIONS } from '../constants/permissions';
// seen-permissions-fix-task.md Phase 1: the eight roles' defaults have one
// source, shared with the database (role_default_permissions is generated
// from the same file by scripts/permissions/gen-sql.ts).
import permissionsMatrix from '../shared/permissionsMatrix.json';

const MATRIX_ROLES = permissionsMatrix.roles as Record<string, string[]>;

const createPermissions = (allowedIds: string[] = []): PermissionsMap => {
  const map: any = {};
  SYSTEM_PERMISSIONS.forEach(p => {
    map[p.id] = allowedIds.includes(p.id);
  });
  return map as PermissionsMap;
};

export const MERCHANT_ROLE_KEYS = [
  'owner',
  'admin',
  'manager',
  'branch_manager',
  'accountant',
  'warehouse_manager',
  'cashier',
  'tailor'
];

export const SAAS_ROLE_KEYS = [
  'super_admin',
  'support_tech',
  'billing_admin',
  'sales'
];

export const isMerchantRole = (roleKey: string): boolean => {
  return MERCHANT_ROLE_KEYS.includes(roleKey);
};

export const isSaaSRole = (roleKey: string): boolean => {
  return SAAS_ROLE_KEYS.includes(roleKey);
};

/**
 * `name` / `description` stay Arabic because they are seeded verbatim into the
 * `roles` table. Render `nameKey` / `descriptionKey` through `t()` instead.
 */
export const DEFAULT_ROLES: Record<string, { name: string; nameKey: string; description: string; descriptionKey: string; category: 'merchant' | 'saas'; permissions: PermissionsMap }> = {
  // === أدوار التجار والمتاجر (Merchant Roles) ===
  owner: {
    name: 'صاحب العمل (Owner)',
    nameKey: 'permissions.roles.owner.name',
    description: 'وصول كامل ومطلق لجميع وحدات النظام مع صلاحيات حصرية للإدارة العليا والإشتراكات',
    descriptionKey: 'permissions.roles.owner.description',
    category: 'merchant',
    permissions: createPermissions(MATRIX_ROLES.owner)
  },
  admin: {
    name: 'مسؤول النظام (Admin)',
    nameKey: 'permissions.roles.admin.name',
    description: 'إدارة تشغيل المتجر والفروع والموظفين والمخزون مع إمكانية تعديل الإعدادات والتقارير',
    descriptionKey: 'permissions.roles.admin.description',
    category: 'merchant',
    permissions: createPermissions(MATRIX_ROLES.admin)
  },
  manager: {
    name: 'المدير العام (Manager)',
    nameKey: 'permissions.roles.manager.name',
    description: 'إدارة المبيعات والمخزون والموظفين والتقارير المالية المتقدمة ومتابعة الأداء',
    descriptionKey: 'permissions.roles.manager.description',
    category: 'merchant',
    permissions: createPermissions(MATRIX_ROLES.manager)
  },
  branch_manager: {
    name: 'مدير الفرع (Branch Manager)',
    nameKey: 'permissions.roles.branch_manager.name',
    description: 'إدارة مبيعات ومخزون وموظفي الفرع ومتابعة الورديات والطلبات اليومية',
    descriptionKey: 'permissions.roles.branch_manager.description',
    category: 'merchant',
    permissions: createPermissions(MATRIX_ROLES.branch_manager)
  },
  accountant: {
    name: 'المحاسب (Accountant)',
    nameKey: 'permissions.roles.accountant.name',
    description: 'إدارة التقارير المالية والضرائب والمصروفات والموردين وتصدير البيانات',
    descriptionKey: 'permissions.roles.accountant.description',
    category: 'merchant',
    permissions: createPermissions(MATRIX_ROLES.accountant)
  },
  warehouse_manager: {
    name: 'مدير المستودع (Warehouse Manager)',
    nameKey: 'permissions.roles.warehouse_manager.name',
    description: 'إدارة كافة عمليات الأقمشة والمخزون والتوريد والتسويات ومتابعة الجرد والتحويلات',
    descriptionKey: 'permissions.roles.warehouse_manager.description',
    category: 'merchant',
    permissions: createPermissions(MATRIX_ROLES.warehouse_manager)
  },
  cashier: {
    name: 'الكاشير (Cashier)',
    nameKey: 'permissions.roles.cashier.name',
    description: 'إضافة العملاء والطلبات ونقطة البيع وتحصيل المدفوعات وإدارة الورديات والخصومات',
    descriptionKey: 'permissions.roles.cashier.description',
    category: 'merchant',
    permissions: createPermissions(MATRIX_ROLES.cashier)
  },
  tailor: {
    name: 'الخياط / الفني (Tailor)',
    nameKey: 'permissions.roles.tailor.name',
    description: 'عرض الطلبات المحالة وتفاصيل المقاسات وتحديث حالة الإنتاج والتفصيل',
    descriptionKey: 'permissions.roles.tailor.description',
    category: 'merchant',
    permissions: createPermissions(MATRIX_ROLES.tailor)
  },

  // === أدوار منصة ساس (SaaS Company Roles) ===
  super_admin: {
    name: 'المدير العام للمنصة (Super Admin)',
    nameKey: 'permissions.roles.super_admin.name',
    description: 'تحكم كامل وشامل بمنصة ساس والتجار والاشتراكات وإدارة النظام بالكامل',
    descriptionKey: 'permissions.roles.super_admin.description',
    category: 'saas',
    permissions: createPermissions(SYSTEM_PERMISSIONS.map(p => p.id))
  },
  support_tech: {
    name: 'الدعم الفني للمنصة (Support Tech)',
    nameKey: 'permissions.roles.support_tech.name',
    description: 'معاينة شاشات التاجر والمنصة لمساعدة التجار وحل المشكلات التشغيلية (استعراض فقط)',
    descriptionKey: 'permissions.roles.support_tech.description',
    category: 'saas',
    permissions: createPermissions([
      'dashboard.view', 'sales.view', 'orders.view', 'orders.view_details', 
      'customers.view', 'inventory.view', 'suppliers.manage', 'reports.view', 
      'settings.view', 'staff.view', 'branches.view', 'invoices.view'
    ])
  },
  billing_admin: {
    name: 'مسؤول الفوترة بالمنصة (Billing Admin)',
    nameKey: 'permissions.roles.billing_admin.name',
    description: 'إدارة اشتراكات التجار والفوترة والتقارير المالية والضرائب بالمنصة',
    descriptionKey: 'permissions.roles.billing_admin.description',
    category: 'saas',
    permissions: createPermissions([
      'dashboard.view', 'reports.view', 'reports.financial', 'reports.tax', 
      'reports.export', 'settings.billing', 'settings.tax', 'payments.view_prices', 
      'invoices.view', 'dashboard.revenue'
    ])
  },
  sales: {
    name: 'مبيعات المنصة والتسويق (Sales)',
    nameKey: 'permissions.roles.sales.name',
    description: 'إدارة مبيعات المنصة والتسويق وإحصائيات المشتركين والتقارير',
    descriptionKey: 'permissions.roles.sales.description',
    category: 'saas',
    permissions: createPermissions([
      'dashboard.view', 'sales.view', 'orders.view', 'orders.create', 'orders.view_details',
      'customers.view', 'customers.create', 'customers.edit', 'payments.collect', 
      'action.discount', 'dashboard.orders', 'dashboard.revenue', 'dashboard.customers',
      'reports.view'
    ])
  }
};

export const seedGlobalRoles = async () => {
  console.log('Starting seedGlobalRoles...');
  const { data: existingRolesData, error: rolesError } = await supabase
    .from('roles')
    .select('*')
    .is('tenant_id', null);
  
  if (rolesError) throw rolesError;
  
  console.log(`Found ${existingRolesData?.length || 0} existing system roles.`);
  
  const existingRoles = new Map(existingRolesData?.map(doc => [doc.role_key, doc]));
  
  const promises = Object.entries(DEFAULT_ROLES).map(async ([key, roleData]) => {
    const existing = existingRoles.get(key) as any;
    if (!existing) {
      console.log(`Seeding new role: ${key}`);
      return supabase.from('roles').insert({
        name: roleData.name,
        description: roleData.description,
        permissions: roleData.permissions,
        tenant_id: null,
        is_default: true,
        is_system: true,
        role_key: key,
        created_at: new Date().toISOString()
      });
    } else {
      // Always update system roles to ensure they have the latest permissions from code
      console.log(`Updating existing system role permissions: ${key}`);
      return supabase.from('roles').update({
        permissions: roleData.permissions,
        name: roleData.name,
        description: roleData.description,
        updated_at: new Date().toISOString()
      }).eq('id', existing.id);
    }
  });
  
  await Promise.all(promises);
  console.log('seedGlobalRoles completed successfully.');
  return true;
};

export const initializeTenantRoles = async (tenantId: string) => {
  return true;
};

export const checkSaasRole = async (uid: string, allowedRoles: string[]): Promise<boolean> => {
  try {
    // Treat 'owner' as an alias for 'super_admin' in the context of SaaS
    const normalizedAllowedRoles = allowedRoles.map(r => r === 'owner' ? 'super_admin' : r);
    
    // Quick check if super_admin is allowed (they typically have full access)
    // We already do this by fetching the current user's role
    const { data: saasUser, error } = await supabase
      .from('saas_users')
      .select('email, role, is_active')
      .eq('uid', uid)
      .single();
      
    if (error || !saasUser || !saasUser.is_active) {
      return false;
    }
    
    // Super admins and owners have access to everything if owner/super_admin is allowed, 
    // or arguably to all routes at all times depending on business logic.
    if (saasUser.role === 'super_admin' || saasUser.role === 'owner' as any) {
      return true;
    }
    
    return normalizedAllowedRoles.includes(saasUser.role);
  } catch (error) {
    console.error('Error checking saas role:', error);
    return false;
  }
};

// seen-permissions-fix-task.md Phase 1: the server now reads the same roles
// rows as this function. public.app_effective_permissions decides, in this
// order: owner -> everything; the role row (staff.role_id, else the shop's
// row with role_key = staff.role, else the system row) over the role's
// defaults; then the staff member's overrides. app_has_permission (every
// guarded RPC and policy) reads it, so editing a role on the settings screen
// changes the server too. This function mirrors that order for the UI.
export const getEffectivePermissions = async (staff: Staff): Promise<PermissionsMap> => {
  if (staff.role === 'owner' || staff.role === 'super_admin') {
    return DEFAULT_ROLES.owner.permissions;
  }

  // Check if this is a SaaS user (system global roles)
  if (!staff.tenantId || staff.tenantId === 'system') {
    const { data: saasUser } = await supabase
      .from('saas_users')
      .select('email, role, is_active')
      .eq('uid', staff.id)
      .single();

    if (saasUser && saasUser.is_active) {
      if (saasUser.role === 'super_admin' || saasUser.role === 'owner' as any) return DEFAULT_ROLES.owner.permissions;
      if (saasUser.role === 'support_tech') return createPermissions(['orders.view', 'customers.view', 'reports.view']); // Read only 
      if (saasUser.role === 'sales') return createPermissions(['dashboard.view', 'reports.view', 'customers.create']); // Example mapping
      if (saasUser.role === 'billing_admin') return createPermissions(['reports.financial', 'reports.view', 'settings.billing']);
    }
  }

  // seen-permissions-fix-task.md Phase 2: the server decides (get_my_permissions,
  // for whoever the server sees -- after a PIN switch, that employee). Its
  // answer is kept for offline use only. If the server sees someone else
  // (no PIN session yet) or cannot be reached, the same order is applied here.
  try {
    const { data, error } = await supabase.rpc('get_my_permissions');
    if (!error && data) {
      if (data.session_invalid) {
        const { forgetActingSession, ACTING_SESSION_INVALID_EVENT } = await import('../lib/actingSession');
        forgetActingSession();
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(ACTING_SESSION_INVALID_EVENT));
      } else if (data.staff_id === staff.id && data.permissions && typeof data.permissions === 'object') {
        const fromServer = { ...createPermissions([]), ...data.permissions } as PermissionsMap;
        try { localStorage.setItem(`seen_permissions_${staff.id}`, JSON.stringify(fromServer)); } catch { /* no storage */ }
        return fromServer;
      }
    } else if (error && typeof navigator !== 'undefined' && navigator.onLine === false) {
      const cached = (() => { try { return localStorage.getItem(`seen_permissions_${staff.id}`); } catch { return null; } })();
      if (cached) return JSON.parse(cached) as PermissionsMap;
    }
  } catch {
    try {
      const cached = localStorage.getItem(`seen_permissions_${staff.id}`);
      if (cached) return JSON.parse(cached) as PermissionsMap;
    } catch { /* fall through to the local order */ }
  }

  const defaults: PermissionsMap = DEFAULT_ROLES[staff.role]
    ? { ...DEFAULT_ROLES[staff.role].permissions }
    : { ...DEFAULT_ROLES.tailor.permissions };
  let permissions: PermissionsMap = defaults;
  // A custom role is named by role_id (staff.role is only its base role).
  const roleId: string | null = (staff as any).roleId ?? (staff as any).role_id ?? null;

  // Check localStorage for immediate local cache
  if (typeof localStorage !== 'undefined' && staff.tenantId && staff.role) {
    const cached = localStorage.getItem(`role_permissions_${staff.tenantId}_${staff.role}`);
    if (cached) {
      try {
        permissions = JSON.parse(cached) as PermissionsMap;
      } catch (e) {
        // ignore invalid JSON
      }
    }
  }

  // Search for role in tenant roles, then system roles.
  // seen-deep-technical-audit.md: this used to check a 'roles_permissions'
  // table first -- that table never existed in any environment, so every
  // read/write to it was a silent no-op; removed rather than finally
  // created, since this `roles` lookup was already the real source of
  // truth the whole time.
  try {
    let rolePermissions: Partial<PermissionsMap> | null = null;
    if (roleId) {
      const { data: byId } = await supabase.from('roles').select('permissions').eq('id', roleId).maybeSingle();
      rolePermissions = (byId?.permissions as Partial<PermissionsMap>) ?? null;
    }
    const { data: tenantRoleData } = rolePermissions
      ? { data: null }
      : await supabase
          .from('roles')
          .select('permissions')
          .eq('tenant_id', staff.tenantId)
          .eq('role_key', staff.role)
          .maybeSingle();

    if (rolePermissions || tenantRoleData?.permissions) {
      // The role's keys win; keys it omits keep the role's defaults (as on the server).
      permissions = { ...defaults, ...(rolePermissions ?? tenantRoleData!.permissions) } as PermissionsMap;
    } else {
      // Check system roles
      const { data: systemRoleData } = await supabase
        .from('roles')
        .select('permissions')
        .is('tenant_id', null)
        .eq('role_key', staff.role)
        .maybeSingle();
      if (systemRoleData?.permissions) {
        permissions = { ...defaults, ...systemRoleData.permissions } as PermissionsMap;
      }
    }
  } catch (err) {
    // A stale localStorage cache (set above, before this query ran) must
    // never survive a failed permissions lookup -- if a super_admin just
    // revoked this role's permissions and this query happens to fail
    // transiently, keeping the old cached value would silently grant
    // whatever was cached, possibly over-privileged. Fall back to the
    // built-in per-role defaults instead of trusting localStorage alone.
    console.warn('Error querying roles:', err);
    permissions = DEFAULT_ROLES[staff.role]?.permissions ?? ({} as PermissionsMap);
  }

  // 2. Get User Overrides
  const { data: overrideData } = await supabase
    .from('user_permission_overrides')
    .select('overrides')
    .eq('staff_id', staff.id)
    .maybeSingle();
  
  if (overrideData) {
    const overrides = overrideData.overrides as Partial<PermissionsMap>;
    permissions = { ...permissions, ...overrides };
  }

  return permissions;
};

export const logUnauthorizedAccess = async (staff: Staff, permission: string, module: string) => {
  try {
    await supabase.from('security_logs').insert({
      tenant_id: staff.tenantId,
      staff_id: staff.id,
      staff_name: staff.name,
      staff_email: staff.email,
      attempted_permission: permission,
      module,
      occurred_at: new Date().toISOString(),
      message: `محاولة وصول غير مصرح بها لـ ${permission} في موديول ${module}`
    });
  } catch (error) {
    console.error('Error logging security event:', error);
  }
};

/** The built-in roles a custom role can be based on (roles.base_role). */
export const BASE_ROLE_KEYS = ['admin', 'manager', 'branch_manager', 'accountant', 'warehouse_manager', 'cashier', 'tailor'];

/**
 * staff.role to save for a member of the chosen role: the role itself when it
 * is built in, otherwise the custom role's base_role (Phase 1) -- 'tailor'
 * only for a custom role made before base_role existed. role_id stays the
 * deciding one; staff.role only supplies defaults for keys the role omits.
 */
export const staffRoleForSave = (roleKey: string, role?: { base_role?: string | null; baseRole?: string | null } | null): string => {
  if (MERCHANT_ROLE_KEYS.includes(roleKey) || SAAS_ROLE_KEYS.includes(roleKey)) return roleKey;
  const base = role?.base_role ?? role?.baseRole ?? null;
  return base && BASE_ROLE_KEYS.includes(base) ? base : 'tailor';
};

export const createCustomRole = async (tenantId: string, name: string, description: string, permissions: PermissionsMap, performedBy: string | null, performedByEmail: string, baseRole: string = 'tailor') => {
  const roleKey = `custom_${name.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`;
  
  const { data, error } = await supabase.from('roles').insert({
    name,
    description,
    permissions,
    tenant_id: tenantId,
    is_default: false,
    role_key: roleKey,
    base_role: BASE_ROLE_KEYS.includes(baseRole) ? baseRole : 'tailor',
    created_at: new Date().toISOString()
  }).select().single();

  if (error) throw error;

  // Audit Log
  await supabase.from('audit_logs').insert({
    action: 'إنشاء مهنة مخصصة',
    performed_by: performedBy,
    performed_by_email: performedByEmail,
    target_tenant_id: tenantId,
    details: `تم إنشاء مهنة مخصصة جديدة: ${name}`,
    occurred_at: new Date().toISOString(),
    type: 'security'
  });

  return data.id;
};

export const updateRolePermissions = async (
  roleId: string, 
  permissions: PermissionsMap, 
  performedBy: string | null, 
  performedByEmail: string, 
  tenantId: string | null,
  isSuperAdmin: boolean = false
) => {
  const isUuid = (val: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
  
  if (!isUuid(roleId)) {
    if (!isSuperAdmin) {
      throw new Error(i18n.t('permissions.default_roles_protected'));
    }
    return;
  }

  const { data: roleData, error: roleFetchError } = await supabase
    .from('roles')
    .select('*')
    .eq('id', roleId)
    .single();
  
  if (roleFetchError || !roleData) return;

  const roleKeyToSave = roleData.role_key || roleData.name?.toLowerCase().replace(/\s+/g, '_');

  // Prevent merchants from editing default system roles
  if (!isSuperAdmin) {
    const isDefault = !roleData.tenant_id || roleData.tenant_id === 'system' || Boolean(DEFAULT_ROLES[roleKeyToSave]) || roleData.is_default;
    if (isDefault) {
      throw new Error(i18n.t('permissions.default_roles_protected'));
    }
  }

  // SUPER ADMIN MODE: Save System Global Role Default (tenant_id IS NULL)
  if (isSuperAdmin || !tenantId) {
    // 1. Update roles table where tenant_id IS NULL or eq id
    await supabase.from('roles').update({ 
      permissions, 
      updated_at: new Date().toISOString() 
    }).eq('id', roleId);

    // 2. Cache in localStorage
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(`role_permissions_global_${roleKeyToSave}`, JSON.stringify(permissions));
    }

    // 3. Dispatch real-time event across app
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('permissions_updated', {
        detail: { tenantId: null, roleKey: roleKeyToSave, isGlobal: true }
      }));
    }

    // 4. Audit Log
    await supabase.from('audit_logs').insert({
      action: 'تحديث صلاحيات النظام القياسية',
      performed_by: performedBy,
      performed_by_email: performedByEmail,
      target_tenant_id: null,
      details: `تم تحديث صلاحيات النظام القياسية لدور: ${roleData.name}`,
      occurred_at: new Date().toISOString(),
      type: 'security'
    });

    return;
  }

  // MERCHANT MODE: Save Tenant-Specific Custom Role / Override
  if (roleData.tenant_id === null || roleData.tenant_id === 'system') {
    const newRoleKey = roleData.role_key;
    
    const { data: existingSnap } = await supabase
      .from('roles')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('role_key', newRoleKey);
    
    if (!existingSnap || existingSnap.length === 0) {
      await supabase.from('roles').insert({
        name: roleData.name,
        description: roleData.description,
        permissions,
        tenant_id: tenantId,
        is_default: false,
        role_key: newRoleKey,
        created_at: new Date().toISOString()
      });
    } else {
      await supabase.from('roles').update({
        permissions,
        updated_at: new Date().toISOString()
      }).eq('id', existingSnap[0].id);
    }
  } else {
    // Normal update
    await supabase.from('roles').update({ 
      permissions, 
      updated_at: new Date().toISOString() 
    }).eq('id', roleId);
  }

  // Cache in localStorage (real persistence is the roles.permissions update above)
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(`role_permissions_${tenantId}_${roleKeyToSave}`, JSON.stringify(permissions));
  }

  // Dispatch real-time update event across app
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('permissions_updated', { detail: { tenantId, roleKey: roleKeyToSave } }));
  }

  // Audit Log
  await supabase.from('audit_logs').insert({
    action: 'تحديث صلاحيات المهنة للتاجر',
    performed_by: performedBy,
    performed_by_email: performedByEmail,
    target_tenant_id: tenantId,
    details: `تم تحديث صلاحيات المهنة المخصصة للتاجر: ${roleData.name}`,
    occurred_at: new Date().toISOString(),
    type: 'security'
  });
};

export const updateUserOverrides = async (staffId: string, tenantId: string, overrides: Partial<PermissionsMap>, performedBy: string | null, performedByEmail: string) => {
  await supabase.from('user_permission_overrides').upsert({
    staff_id: staffId,
    tenant_id: tenantId,
    overrides,
    updated_at: new Date().toISOString()
  });

  // Audit Log
  await supabase.from('audit_logs').insert({
    action: 'تحديث استثناءات صلاحيات المستخدم',
    performed_by: performedBy,
    performed_by_email: performedByEmail,
    target_tenant_id: tenantId,
    details: `تم تحديث الاستثناءات الفردية للموظف ذو المعرف: ${staffId}`,
    occurred_at: new Date().toISOString(),
    type: 'security'
  });

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('permissions_updated', { detail: { tenantId, staffId } }));
  }
};

export interface PermissionDetail {
  id: string;
  name: string;
  description: string;
  /** Stable, language-independent i18n key — use this for grouping/comparison. */
  categoryKey: string;
  /** Category label already resolved in the active language (display only). */
  category: string;
  baseValue: boolean;
  overrideValue?: boolean;
  effectiveValue: boolean;
  isOverridden: boolean;
}

export const getStaffPermissionDetails = async (staff: Staff): Promise<PermissionDetail[]> => {
  // Search for role in tenant roles first
  const { data: tenantRoleData } = await supabase
    .from('roles')
    .select('permissions')
    .eq('tenant_id', staff.tenantId)
    .eq('role_key', staff.role)
    .single();
  
  let basePermissions: PermissionsMap = DEFAULT_ROLES[staff.role]
    ? { ...DEFAULT_ROLES[staff.role].permissions }
    : { ...DEFAULT_ROLES.tailor.permissions }; // Fallback

  if (tenantRoleData) {
    basePermissions = tenantRoleData.permissions as PermissionsMap;
  } else {
    // Check system roles
    const { data: systemRoleData } = await supabase
      .from('roles')
      .select('permissions')
      .is('tenant_id', null)
      .eq('role_key', staff.role)
      .single();
    if (systemRoleData) {
      basePermissions = systemRoleData.permissions as PermissionsMap;
    }
  }

  // Get User Overrides
  const { data: overrideData } = await supabase
    .from('user_permission_overrides')
    .select('overrides')
    .eq('staff_id', staff.id)
    .maybeSingle();
  
  let overrides: Partial<PermissionsMap> = {};
  if (overrideData) {
    overrides = overrideData.overrides as Partial<PermissionsMap>;
  }

  return SYSTEM_PERMISSIONS.map(perm => {
    const baseValue = basePermissions[perm.id as PermissionKey] ?? false;
    const overrideValue = overrides[perm.id as PermissionKey];
    const effectiveValue = overrideValue !== undefined ? overrideValue : baseValue;
    const isOverridden = overrideValue !== undefined;

    return {
      ...perm,
      baseValue,
      overrideValue,
      effectiveValue,
      isOverridden
    };
  });
};

export const bulkUpdateRolePermissions = async (
  roleIds: string[],
  permissions: PermissionsMap,
  performedBy: string | null,
  performedByEmail: string,
  tenantId: string
) => {
  if (roleIds.length === 0) return;

  // Previously one `.eq('id', roleId).single()` round trip per role --
  // batch that initial lookup into one `.in()` query and index the
  // results by id. The writes below (insert/update/audit-log) stay one
  // per role: whether a role forks a new tenant-scoped copy or updates in
  // place is decided per-row, and each audit_log message names that role.
  const { data: roles } = await supabase.from('roles').select('*').in('id', roleIds);
  const roleById = new Map((roles ?? []).map((role: any) => [role.id, role]));

  for (const roleId of roleIds) {
    const roleData = roleById.get(roleId);

    if (!roleData) continue;

    // FORKING LOGIC
    if (roleData.tenant_id === null || roleData.tenant_id === 'system') {
      const newRoleKey = roleData.role_key;
      
      const { data: existingSnap } = await supabase
        .from('roles')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('role_key', newRoleKey);
      
      if (!existingSnap || existingSnap.length === 0) {
        await supabase.from('roles').insert({
          name: roleData.name,
          description: roleData.description,
          permissions,
          tenant_id: tenantId,
          is_default: false,
          role_key: newRoleKey,
          created_at: new Date().toISOString()
        });
      } else {
        await supabase.from('roles').update({
          permissions,
          updated_at: new Date().toISOString()
        }).eq('id', existingSnap[0].id);
      }
    } else {
      await supabase.from('roles').update({ permissions, updated_at: new Date().toISOString() }).eq('id', roleId);
    }

    await supabase.from('audit_logs').insert({
      action: 'تحديث جماعي لصلاحيات المهنة',
      performed_by: performedBy,
      performed_by_email: performedByEmail,
      target_tenant_id: tenantId,
      details: `تم تحديث صلاحيات المهنة: ${roleData.name} بشكل جماعي`,
      occurred_at: new Date().toISOString(),
      type: 'security'
    });
  }
};
