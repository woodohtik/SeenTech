import i18n from 'i18next';
import { supabase } from '../lib/supabase/client';
import { Role, PermissionsMap, Staff, PermissionKey } from '../types';
import { SYSTEM_PERMISSIONS } from '../constants/permissions';

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
    permissions: createPermissions(SYSTEM_PERMISSIONS.map(p => p.id))
  },
  admin: {
    name: 'مسؤول النظام (Admin)',
    nameKey: 'permissions.roles.admin.name',
    description: 'إدارة تشغيل المتجر والفروع والموظفين والمخزون مع إمكانية تعديل الإعدادات والتقارير',
    descriptionKey: 'permissions.roles.admin.description',
    category: 'merchant',
    permissions: createPermissions(SYSTEM_PERMISSIONS.filter(p => p.id !== 'system.delete' && p.id !== 'settings.billing').map(p => p.id))
  },
  manager: {
    name: 'المدير العام (Manager)',
    nameKey: 'permissions.roles.manager.name',
    description: 'إدارة المبيعات والمخزون والموظفين والتقارير المالية المتقدمة ومتابعة الأداء',
    descriptionKey: 'permissions.roles.manager.description',
    category: 'merchant',
    permissions: createPermissions(SYSTEM_PERMISSIONS.filter(p => p.id !== 'system.delete' && p.id !== 'settings.billing' && p.id !== 'settings.tax' && p.id !== 'staff.permissions').map(p => p.id))
  },
  branch_manager: {
    name: 'مدير الفرع (Branch Manager)',
    nameKey: 'permissions.roles.branch_manager.name',
    description: 'إدارة مبيعات ومخزون وموظفي الفرع ومتابعة الورديات والطلبات اليومية',
    descriptionKey: 'permissions.roles.branch_manager.description',
    category: 'merchant',
    permissions: createPermissions([
      'dashboard.view', 'sales.view', 'orders.view', 'customers.view', 'inventory.view', 
      'suppliers.manage', 'reports.view', 'orders.create', 'orders.view_details', 
      'orders.update_status', 'orders.edit', 'invoices.view', 'payments.collect', 
      'payments.view_prices', 'action.discount', 'action.refund', 'shifts.manage', 
      'inventory.manage', 'inventory.create', 'inventory.edit', 'inventory.reconcile', 
      'customers.create', 'customers.edit', 'dashboard.revenue', 'dashboard.orders', 
      'dashboard.inventory', 'dashboard.customers', 'reports.financial', 'reports.export',
      'staff.view', 'staff.create', 'staff.edit', 'branches.view'
    ])
  },
  accountant: {
    name: 'المحاسب (Accountant)',
    nameKey: 'permissions.roles.accountant.name',
    description: 'إدارة التقارير المالية والضرائب والمصروفات والموردين وتصدير البيانات',
    descriptionKey: 'permissions.roles.accountant.description',
    category: 'merchant',
    permissions: createPermissions([
      'dashboard.view', 'orders.view', 'suppliers.manage', 'reports.view',
      'invoices.view', 'reports.financial', 'reports.tax', 'reports.export',
      'payments.view_prices', 'dashboard.revenue', 'settings.tax', 'action.refund'
    ])
  },
  warehouse_manager: {
    name: 'مدير المستودع (Warehouse Manager)',
    nameKey: 'permissions.roles.warehouse_manager.name',
    description: 'إدارة كافة عمليات الأقمشة والمخزون والتوريد والتسويات ومتابعة الجرد والتحويلات',
    descriptionKey: 'permissions.roles.warehouse_manager.description',
    category: 'merchant',
    permissions: createPermissions([
      'dashboard.view', 'inventory.view', 'inventory.manage', 'inventory.create', 
      'inventory.edit', 'inventory.delete', 'inventory.reconcile', 'inventory.transfer', 
      'suppliers.manage', 'orders.view', 'orders.view_details', 'dashboard.inventory'
    ])
  },
  cashier: {
    name: 'الكاشير (Cashier)',
    nameKey: 'permissions.roles.cashier.name',
    description: 'إضافة العملاء والطلبات ونقطة البيع وتحصيل المدفوعات وإدارة الورديات والخصومات',
    descriptionKey: 'permissions.roles.cashier.description',
    category: 'merchant',
    permissions: createPermissions([
      'dashboard.view', 'sales.view', 'orders.view', 'customers.view', 'inventory.view',
      'orders.create', 'orders.view_details', 'invoices.view',
      'payments.collect', 'shifts.manage', 'action.discount',
      'customers.create', 'dashboard.orders', 'dashboard.customers'
    ])
  },
  tailor: {
    name: 'الخياط / الفني (Tailor)',
    nameKey: 'permissions.roles.tailor.name',
    description: 'عرض الطلبات المحالة وتفاصيل المقاسات وتحديث حالة الإنتاج والتفصيل',
    descriptionKey: 'permissions.roles.tailor.description',
    category: 'merchant',
    permissions: createPermissions([
      'orders.view', 'orders.view_details', 'orders.update_status', 'customers.view'
    ])
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

  let permissions: PermissionsMap = DEFAULT_ROLES[staff.role] 
    ? { ...DEFAULT_ROLES[staff.role].permissions } 
    : { ...DEFAULT_ROLES.tailor.permissions };

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

  // Search for role in roles_permissions table first
  try {
    const { data: rpData } = await supabase
      .from('roles_permissions')
      .select('permissions')
      .eq('tenant_id', staff.tenantId)
      .eq('role_key', staff.role)
      .maybeSingle();
    
    if (rpData?.permissions) {
      permissions = rpData.permissions as PermissionsMap;
    } else {
      // Search for role in tenant roles
      const { data: tenantRoleData } = await supabase
        .from('roles')
        .select('permissions')
        .eq('tenant_id', staff.tenantId)
        .eq('role_key', staff.role)
        .maybeSingle();

      if (tenantRoleData?.permissions) {
        permissions = tenantRoleData.permissions as PermissionsMap;
      } else {
        // Check system roles_permissions (Super Admin global default)
        const { data: sysRpData } = await supabase
          .from('roles_permissions')
          .select('permissions')
          .is('tenant_id', null)
          .eq('role_key', staff.role)
          .maybeSingle();

        if (sysRpData?.permissions) {
          permissions = sysRpData.permissions as PermissionsMap;
        } else {
          // Check system roles
          const { data: systemRoleData } = await supabase
            .from('roles')
            .select('permissions')
            .is('tenant_id', null)
            .eq('role_key', staff.role)
            .maybeSingle();
          if (systemRoleData?.permissions) {
            permissions = systemRoleData.permissions as PermissionsMap;
          }
        }
      }
    }
  } catch (err) {
    console.warn('Error querying roles_permissions:', err);
  }

  // 2. Get User Overrides
  const { data: overrideData } = await supabase
    .from('user_permission_overrides')
    .select('overrides')
    .eq('staff_id', staff.id)
    .single();
  
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

export const createCustomRole = async (tenantId: string, name: string, description: string, permissions: PermissionsMap, performedBy: string | null, performedByEmail: string) => {
  const roleKey = `custom_${name.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`;
  
  const { data, error } = await supabase.from('roles').insert({
    name,
    description,
    permissions,
    tenant_id: tenantId,
    is_default: false,
    role_key: roleKey,
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

    // 3. Upsert into roles_permissions where tenant_id IS NULL
    try {
      const { data: existingSysRp } = await supabase
        .from('roles_permissions')
        .select('id')
        .is('tenant_id', null)
        .eq('role_key', roleKeyToSave)
        .maybeSingle();

      if (existingSysRp) {
        await supabase.from('roles_permissions').update({
          permissions,
          updated_at: new Date().toISOString()
        }).eq('id', existingSysRp.id);
      } else {
        await supabase.from('roles_permissions').insert({
          role_id: roleId,
          role_key: roleKeyToSave,
          tenant_id: null,
          permissions,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      }
    } catch (err) {
      console.warn('roles_permissions global update error:', err);
    }

    // 4. Dispatch real-time event across app
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('permissions_updated', { 
        detail: { tenantId: null, roleKey: roleKeyToSave, isGlobal: true } 
      }));
    }

    // 5. Audit Log
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

  // Save to roles_permissions table in Supabase & localStorage cache
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(`role_permissions_${tenantId}_${roleKeyToSave}`, JSON.stringify(permissions));
    }
    await supabase.from('roles_permissions').upsert({
      role_id: roleId,
      role_key: roleKeyToSave,
      tenant_id: tenantId,
      permissions,
      updated_at: new Date().toISOString()
    }, { onConflict: 'tenant_id,role_key' });
  } catch (err) {
    console.warn('roles_permissions table update note:', err);
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
    .single();
  
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
  for (const roleId of roleIds) {
    const { data: roleData } = await supabase
      .from('roles')
      .select('*')
      .eq('id', roleId)
      .single();
    
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
