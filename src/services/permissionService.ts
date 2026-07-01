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

export const DEFAULT_ROLES: Record<string, { name: string; description: string; permissions: PermissionsMap }> = {
  owner: {
    name: 'صاحب العمل (Owner)',
    description: 'وصول كامل ومطلق لجميع وحدات النظام مع صلاحيات حصرية للإدارة العليا',
    permissions: createPermissions(SYSTEM_PERMISSIONS.map(p => p.id))
  },
  manager: {
    name: 'المدير (Manager)',
    description: 'إدارة المبيعات والمخزون والموظفين والتقارير المالية المتقدمة',
    permissions: createPermissions(SYSTEM_PERMISSIONS.filter(p => p.id !== 'system.delete' && p.id !== 'settings.billing' && p.id !== 'shifts.manage').map(p => p.id))
  },
  accountant: {
    name: 'المحاسب (Accountant)',
    description: 'إدارة التقارير المالية والضرائب والمصروفات',
    permissions: createPermissions([
      'orders.view', 'invoices.view',
      'reports.view', 'reports.financial', 'reports.tax',
      'payments.view_prices', 'dashboard.view', 'dashboard.revenue'
    ])
  },
  cashier: {
    name: 'الكاشير (Cashier)',
    description: 'إضافة العملاء والطلبات وتحصيل المدفوعات وإدارة الورديات',
    permissions: createPermissions([
      'orders.create', 'orders.view', 'orders.view_details',
      'payments.collect', 'shifts.manage', 'action.discount',
      'inventory.view', 'customers.create', 'customers.view',
      'dashboard.view', 'dashboard.orders', 'dashboard.customers'
    ])
  },
  tailor: {
    name: 'الخياط / الفني (Tailor)',
    description: 'عرض الطلبات المحالة وتفاصيل المقاسات وتحديث حالة الإنتاج',
    permissions: createPermissions([
      'orders.view', 'orders.view_details', 'orders.update_status'
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
      console.log(`Updating existing role: ${key}`);
      return supabase.from('roles').update({
        name: roleData.name,
        description: roleData.description,
        permissions: roleData.permissions,
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
      
    // Always grant full access to primary super admin email
    if (saasUser?.email?.toLowerCase() === 'nomansa2566512@gmail.com') {
      return true;
    }
      
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

    // Always grant full access to primary super admin email
    if (saasUser?.email?.toLowerCase() === 'nomansa2566512@gmail.com') {
      return DEFAULT_ROLES.owner.permissions;
    }

    if (saasUser && saasUser.is_active) {
      if (saasUser.role === 'super_admin' || saasUser.role === 'owner' as any) return DEFAULT_ROLES.owner.permissions;
      if (saasUser.role === 'support_tech') return createPermissions(['orders.view', 'customers.view', 'reports.view']); // Read only 
      if (saasUser.role === 'sales') return createPermissions(['dashboard.view', 'reports.view', 'customers.create']); // Example mapping
      if (saasUser.role === 'billing_admin') return createPermissions(['reports.financial', 'reports.view', 'settings.billing']);
    }
  }

  // Search for role in tenant roles first
  const { data: tenantRoleData } = await supabase
    .from('roles')
    .select('permissions')
    .eq('tenant_id', staff.tenantId)
    .eq('role_key', staff.role)
    .single();
  
  let permissions: PermissionsMap = { ...DEFAULT_ROLES.tailor.permissions }; // Fallback
  
  if (tenantRoleData) {
    permissions = tenantRoleData.permissions as PermissionsMap;
  } else {
    // Check system roles
    const { data: systemRoleData } = await supabase
      .from('roles')
      .select('permissions')
      .is('tenant_id', null)
      .eq('role_key', staff.role)
      .single();
    if (systemRoleData) {
      permissions = systemRoleData.permissions as PermissionsMap;
    }
  }

  // 2. Get User Overrides
  const { data: overrideData } = await supabase
    .from('user_permission_overrides')
    .select('overrides')
    .eq('user_id', staff.id)
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
      timestamp: new Date().toISOString(),
      message: `محاولة وصول غير مصرح بها لـ ${permission} في موديول ${module}`
    });
  } catch (error) {
    console.error('Error logging security event:', error);
  }
};

export const createCustomRole = async (tenantId: string, name: string, description: string, permissions: PermissionsMap, performedBy: string, performedByEmail: string) => {
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
    timestamp: new Date().toISOString(),
    type: 'security'
  });

  return data.id;
};

export const updateRolePermissions = async (roleId: string, permissions: PermissionsMap, performedBy: string, performedByEmail: string, tenantId: string) => {
  const { data: roleData, error: roleFetchError } = await supabase
    .from('roles')
    .select('*')
    .eq('id', roleId)
    .single();
  
  if (roleFetchError || !roleData) return;

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
    // Normal update
    await supabase.from('roles').update({ 
      permissions, 
      updated_at: new Date().toISOString() 
    }).eq('id', roleId);
  }

  // Audit Log
  await supabase.from('audit_logs').insert({
    action: 'تحديث صلاحيات المهنة',
    performed_by: performedBy,
    performed_by_email: performedByEmail,
    target_tenant_id: tenantId,
    details: `تم تحديث صلاحيات المهنة: ${roleData.name}`,
    timestamp: new Date().toISOString(),
    type: 'security'
  });
};

export const updateUserOverrides = async (staffId: string, tenantId: string, overrides: Partial<PermissionsMap>, performedBy: string, performedByEmail: string) => {
  await supabase.from('user_permission_overrides').upsert({
    user_id: staffId,
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
    timestamp: new Date().toISOString(),
    type: 'security'
  });
};

export interface PermissionDetail {
  id: string;
  name: string;
  description: string;
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
  
  let basePermissions: PermissionsMap = { ...DEFAULT_ROLES.tailor.permissions }; // Fallback
  
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
    .eq('user_id', staff.id)
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
  performedBy: string,
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
      timestamp: new Date().toISOString(),
      type: 'security'
    });
  }
};
