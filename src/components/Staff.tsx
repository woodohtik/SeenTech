import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Users, 
  Plus, 
  Trash2, 
  Edit2, 
  Shield, 
  User, 
  CheckCircle, 
  XCircle,
  Mail,
  Smartphone,
  TrendingUp,
  Clock,
  CheckCircle2,
  X,
  Zap,
  ShoppingBag,
  Building2,
  Search,
  ChevronUp,
  ChevronDown,
  Info,
  Lock,
  Key,
  Settings
} from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { auth, handleFirestoreError, OperationType, getFriendlyErrorMessage } from '../lib/firebase';
import { Order, Staff as StaffMemberType, AuditLog, Role, Branch, PermissionKey, PermissionsMap } from '../types';
import { Controller, useForm } from 'react-hook-form';
import { SmartSelect } from './ui/SmartSelect';
import { zodResolver } from '@hookform/resolvers/zod';
import { staffSchema } from '../lib/validations';
import { cn } from '../lib/utils';
import Branding from './Branding';
import { useStaff } from '../contexts/StaffContext';
import { usePermissions } from '../hooks/usePermissions';
import { useSafeMutation } from '../hooks/useSafeMutation';
import { generateSecurePin, hashPin, isPinUnique } from '../services/staffService';
import { updateRolePermissions, createCustomRole, DEFAULT_ROLES, updateUserOverrides, seedGlobalRoles, isMerchantRole } from '../services/permissionService';
import { SYSTEM_PERMISSIONS } from '../constants/permissions';
import EmployeeActivityLogTab from './EmployeeActivityLog';
import AddEmployeeModal from './AddEmployeeModal';
import AdminTailorCommissions from './AdminTailorCommissions';

import { isRtlLang } from '../lib/direction';

/** Permission `categoryKey` -> the stable slug used by the settings_page.* translation keys. */
const getCategoryKey = (cat: string): string => {
  // `cat` is a permission `categoryKey` (e.g. 'settings_page.staff.permissions.categories.orders');
  // the trailing segment is the stable slug. This previously mapped Arabic labels,
  // which silently broke as soon as the UI language was not Arabic.
  return cat.split('.').pop() || cat;
};

interface StaffMember extends StaffMemberType {
  performance?: {
    totalHandled: number;
    completed: number;
    active: number;
  };
}

interface StaffProps {
  tenantId: string;
  initialViewMode?: 'list' | 'permissions' | 'employee_activity';
}

export default function Staff({ tenantId, initialViewMode = 'list' }: StaffProps) {
  const { t, i18n } = useTranslation();
  const isRtl = isRtlLang(i18n.language);

  // Translation helpers for permissions and categories
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
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [selectedStaffForDetails, setSelectedStaffForDetails] = useState<StaffMember | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'permissions' | 'employee_activity'>(initialViewMode === ('performance' as any) ? 'list' : initialViewMode);
  const [permissionTabMode, setPermissionTabMode] = useState<'roles' | 'staff'>('roles');
  const [sidebarSearchTerm, setSidebarSearchTerm] = useState('');
  const [selectedRoleForPermissions, setSelectedRoleForPermissions] = useState<Role | null>(null);
  const [selectedStaffForPermissions, setSelectedStaffForPermissions] = useState<StaffMember | null>(null);
  const [overrides, setOverrides] = useState<Record<string, Partial<PermissionsMap>>>({});

  useEffect(() => {
    if (initialViewMode) {
      setViewMode(initialViewMode === ('performance' as any) ? 'list' : initialViewMode);
    }
  }, [initialViewMode]);
  const { currentStaff } = useStaff();
  const { hasPermission } = usePermissions(currentStaff);
  const isSuperAdmin = currentStaff?.role === 'super_admin';
  const [isSeeding, setIsSeeding] = useState(false);

  const handleSeedRoles = async () => {
    setIsSeeding(true);
    try {
      const { autoSeed } = await import('../services/seedService');
      const success = await autoSeed();
      if (success) {
        setToast({ message: t('settings_page.staff.seed_success'), type: 'success' });
        await fetchRoles();
      } else {
        setToast({ message: t('settings_page.staff.seed_failed'), type: 'error' });
      }
    } catch (error) {
      console.warn('Seeding error:', error);
      setToast({ message: t('settings_page.staff.seed_error'), type: 'error' });
    } finally {
      setIsSeeding(false);
    }
  };

  useEffect(() => {
    if (roles.length === 0 && currentStaff?.email === "nomansa2566512@gmail.com" && !loading && !isSeeding) {
      handleSeedRoles();
    }
  }, [roles, currentStaff, loading, isSeeding]);

  const activeRoles = roles.reduce((acc, role) => {
    const existing = acc.find(r => r.roleKey === role.roleKey);
    const isRoleSystem = !role.tenantId || role.tenantId === 'system';
    const isExistingSystem = existing ? (!existing.tenantId || existing.tenantId === 'system') : false;
    
    if (!existing) {
      acc.push(role);
    } else if (!isRoleSystem && isExistingSystem) {
      const index = acc.indexOf(existing);
      acc[index] = role;
    } else if (isRoleSystem && !isExistingSystem) {
      // Keep the tenant one
    } else {
      acc.push(role);
    }
    return acc;
  }, [] as Role[]).sort((a, b) => {
    const order = ['owner', 'manager', 'accountant', 'cashier', 'tailor'];
    const indexA = order.indexOf(a.roleKey);
    const indexB = order.indexOf(b.roleKey);
    if (indexA === -1 && indexB === -1) return a.name.localeCompare(b.name);
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;
    return indexA - indexB;
  });

  useEffect(() => {
    if (selectedRoleForPermissions) {
      const updated = roles.find(r => r.id === selectedRoleForPermissions.id);
      if (updated && updated !== selectedRoleForPermissions) {
        setSelectedRoleForPermissions(updated);
      }
    } else if (activeRoles.length > 0) {
      setSelectedRoleForPermissions(activeRoles[0]);
    }
  }, [roles, activeRoles]);

  useEffect(() => {
    if (viewMode === 'permissions') {
      if (permissionTabMode === 'roles' && !selectedRoleForPermissions && activeRoles.length > 0) {
        setSelectedRoleForPermissions(activeRoles[0]);
      } else if (permissionTabMode === 'staff' && !selectedStaffForPermissions && staff.length > 0) {
        setSelectedStaffForPermissions(staff[0]);
      }
    }
  }, [viewMode, permissionTabMode, activeRoles, staff, selectedRoleForPermissions, selectedStaffForPermissions]);

  const [isSavingPermissions, setIsSavingPermissions] = useState(false);
  const [showCreateRole, setShowCreateRole] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDesc, setNewRoleDesc] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [branchFilter, setBranchFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showPermissionsModal, setShowPermissionsModal] = useState<Role | null>(null);
  const [roleToDelete, setRoleToDelete] = useState<Role | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<string[]>([]);

  const staffWithPerformance = staff.map(member => {
    const memberOrders = orders.filter(o => o.assignedTo === member.id);
    return {
      ...member,
      performance: {
        totalHandled: memberOrders.length,
        completed: memberOrders.filter(o => o.status === 'delivered' || o.status === 'ready').length,
        active: memberOrders.filter(o => o.status !== 'delivered' && o.status !== 'ready' && o.status !== 'cancelled').length
      }
    };
  });

  const filteredStaff = staffWithPerformance.filter(member => {
    const matchesSearch = member.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                         member.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         member.phone?.includes(searchQuery);
    const matchesRole = roleFilter === 'all' || member.role === roleFilter;
    const matchesBranch = branchFilter === 'all' || member.branchId === branchFilter;
    const matchesStatus = statusFilter === 'all' || member.status === statusFilter;
    return matchesSearch && matchesRole && matchesBranch && matchesStatus;
  });

  const canCreate = hasPermission('staff.create');
  const canEdit = hasPermission('staff.edit');
  const canDelete = hasPermission('staff.delete');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);

  useEffect(() => {
    // Expand all categories by default
    const cats = Array.from(new Set(SYSTEM_PERMISSIONS.map(p => p.categoryKey)));
    setExpandedCategories(cats);
  }, []);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const { register, handleSubmit, reset, setValue, control, watch, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(staffSchema),
    defaultValues: {
      name: '',
      role: 'tailor',
      branchId: '',
      email: '',
      phone: '',
      pin: '',
      enablePin: true,
      status: 'active',
      isTest: false
    }
  });

  const enablePin = watch('enablePin');

  // Handle form reset when modal opens/closes or editing changes
  useEffect(() => {
    if (isModalOpen) {
      if (editingStaff) {
        reset({
          name: editingStaff.name,
          role: editingStaff.role,
          branchId: editingStaff.branchId || (branches.length > 0 ? branches[0].id : ''),
          email: editingStaff.email,
          phone: editingStaff.phone || '',
          pin: '', // Always empty for editing unless user wants to change it
          enablePin: !!editingStaff.pin,
          status: editingStaff.status,
          isTest: editingStaff.isTest || false
        });
      } else {
        const defaultBranchId = branches.find(b => b.isMain)?.id || branches[0]?.id || '';
        reset({
          name: '',
          role: roles.find(r => r.tenantId === tenantId)?.roleKey || 'tailor',
          branchId: defaultBranchId,
          email: '',
          phone: '',
          pin: '',
          enablePin: true,
          status: 'active',
          isTest: false
        });
      }
    }
  }, [isModalOpen, editingStaff, reset]); // Removed branches and roles from dependencies to prevent unwanted resets while typing

  const fetchRoles = async () => {
    if (!tenantId) return;
    const { data, error } = await supabase
      .from('roles')
      .select('*')
      .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`);
    
    if (error) {
      handleFirestoreError(error, OperationType.LIST, 'roles');
    } else {
      const combinedMap = new Map<string, Role>();

      // 1. Seed base default roles
      Object.entries(DEFAULT_ROLES).forEach(([key, roleInfo]) => {
        if (roleInfo.category === 'merchant' || isMerchantRole(key)) {
          combinedMap.set(key, {
            id: key,
            name: roleInfo.name,
            description: roleInfo.description,
            roleKey: key,
            permissions: roleInfo.permissions,
            tenantId: null,
            isDefault: true,
            createdAt: new Date().toISOString(),
            category: 'merchant'
          });
        }
      });

      // 2. Override with DB roles
      (data || []).forEach(d => {
        const key = d.role_key || d.id;
        const defaultCategory = DEFAULT_ROLES[key]?.category;
        if (defaultCategory === 'merchant' || isMerchantRole(key) || d.tenant_id) {
          combinedMap.set(key, {
            ...d,
            tenantId: d.tenant_id,
            roleKey: key,
            createdAt: d.created_at,
            updatedAt: d.updated_at,
            category: 'merchant'
          } as Role);
        }
      });

      setRoles(Array.from(combinedMap.values()));
    }
  };

  const fetchOverrides = async () => {
    if (!tenantId) return;
    const { data } = await supabase
      .from('user_permission_overrides')
      .select('*')
      .eq('tenant_id', tenantId);
    
    if (data) {
      const overridesData: Record<string, Partial<PermissionsMap>> = {};
      data.forEach(item => {
        overridesData[item.staff_id] = item.overrides;
      });
      setOverrides(overridesData);
    }
  };

  useEffect(() => {
    if (!tenantId) return;

    // Supabase real-time subscriptions
    const staffChannel = supabase
      .channel('staff-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff', filter: `tenant_id=eq.${tenantId}` }, () => {
        fetchStaff();
      })
      .subscribe();

    const rolesChannel = supabase
      .channel('roles-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'roles' }, () => {
        fetchRoles();
      })
      .subscribe();

    const overridesChannel = supabase
      .channel('overrides-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_permission_overrides', filter: `tenant_id=eq.${tenantId}` }, () => {
        fetchOverrides();
      })
      .subscribe();

    const fetchStaff = async () => {
      const { data, error } = await supabase
        .from('staff')
        .select('*')
        .eq('tenant_id', tenantId);
      
      if (error) {
        handleFirestoreError(error, OperationType.LIST, 'staff');
      } else {
        const { data: rolesData } = await supabase
          .from('roles')
          .select('*')
          .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`);
        const rolesMap = new Map(rolesData?.map(r => [r.id, r.role_key]) || []);

        setStaff(data.map(d => {
          const actualRole = d.role_id ? (rolesMap.get(d.role_id) || d.role) : d.role;
          return {
            ...d,
            role: actualRole,
            tenantId: d.tenant_id,
            branchId: d.branch_id,
            roleId: d.role_id,
            pin: d.pin_hash,
            mustChangePin: d.must_change_pin,
            isTest: d.is_test,
            createdAt: d.created_at,
            updatedAt: d.updated_at
          } as StaffMember;
        }));
        setLoading(false);
      }
    };

    const fetchOrders = async () => {
      const { data } = await supabase
        .from('orders')
        .select('*')
        .eq('tenant_id', tenantId);
      if (data) {
        setOrders(data.map(d => ({
          ...d,
          customerId: d.customer_id,
          customerName: d.customer_name,
          orderDate: d.order_date,
          totalAmount: d.total_amount,
          paidAmount: d.paid_amount,
          remainingAmount: d.remaining_amount,
          branchId: d.branch_id,
          orderNumber: d.order_number,
          createdAt: d.created_at,
          updatedAt: d.updated_at,
          assignedTo: d.assigned_to
        }) as Order));
      }
    };

    const fetchBranches = async () => {
      const { data } = await supabase
        .from('branches')
        .select('*')
        .eq('tenant_id', tenantId);
      if (data) setBranches(data.map(d => ({
        ...d,
        tenantId: d.tenant_id,
        isMain: d.is_main,
        createdAt: d.created_at,
        updatedAt: d.updated_at
      }) as Branch));
    };

    fetchStaff();
    fetchOrders();
    fetchRoles();
    fetchBranches();
    fetchOverrides();

    return () => {
      supabase.removeChannel(staffChannel);
      supabase.removeChannel(rolesChannel);
      supabase.removeChannel(overridesChannel);
    };
  }, [tenantId]);

  const onInvalid = (errors: any) => {
    console.error("Staff form validation errors:", errors);
    const messages = Object.entries(errors)
      .map(([field, err]: [string, any]) => {
        const fieldLabelKeys: Record<string, string> = {
          name: 'login.full_name',
          email: 'common.email',
          phone: 'onboarding.fields.phone',
          role: 'settings_page.staff.field_role',
          branchId: 'common.branch',
          pin: 'settings_page.staff.field_pin'
        };
        const label = fieldLabelKeys[field] ? t(fieldLabelKeys[field]) : field;
        return `• ${label}: ${err.message || t('settings_page.staff.invalid_field')}`;
      })
      .join('\n');

    setToast({ 
      message: t('settings_page.staff.fix_errors', { errors: messages }), 
      type: 'error' 
    });
  };

  const onSubmit = async (data: any) => {
    try {
      let finalPin = data.pin;
      let isAutoGenerated = false;
      let finalPinHash: string | null = null;

      if (data.enablePin) {
        // Auto-generation logic: generate if new staff, OR if editing staff who didn't have a PIN before and no PIN was typed
        const shouldGenerate = !finalPin || finalPin.trim() === '';
        const hasExistingPin = editingStaff && !!editingStaff.pin;
        
        if (shouldGenerate && !hasExistingPin) {
          let uniquePin = '';
          let attempts = 0;
          while (attempts < 10) {
            const candidate = generateSecurePin(4);
            if (await isPinUnique(tenantId!, candidate)) {
              uniquePin = candidate;
              break;
            }
            attempts++;
          }
          
          if (!uniquePin) throw new Error(t('settings_page.staff.pin_unique_failed'));
          
          finalPin = uniquePin;
          isAutoGenerated = true;
          finalPinHash = await hashPin(finalPin);
        } else if (finalPin && finalPin.length === 4) {
          finalPinHash = await hashPin(finalPin);
        }
      }

      const VALID_DB_ROLES = [
        'super_admin', 'support_tech', 'billing_admin', 'owner', 'admin', 'manager', 
        'cashier', 'tailor', 'accountant', 'branch_manager', 'warehouse_manager'
      ];
      const selectedRole = roles.find(r => r.roleKey === data.role);
      const dbRoleValue = VALID_DB_ROLES.includes(data.role) ? data.role : 'tailor';
      const isUuid = (val: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
      const validRoleId = selectedRole?.id && isUuid(selectedRole.id) ? selectedRole.id : null;

      if (editingStaff) {
        const updateData: any = {
          name: data.name,
          role: dbRoleValue,
          role_id: validRoleId,
          branch_id: data.branchId || null,
          email: data.email,
          phone: data.phone,
          status: data.status,
          is_test: data.isTest,
          updated_at: new Date().toISOString()
        };

        if (data.enablePin) {
          // Only update PIN if a new one is provided (must be 4 digits) or it's auto-generated
          if (finalPinHash && (data.pin?.length === 4 || isAutoGenerated)) {
            updateData.pin_hash = finalPinHash;
            updateData.must_change_pin = isAutoGenerated;
          }
        } else {
          // Clear PIN
          updateData.pin_hash = null;
          updateData.must_change_pin = false;
        }

        const { error } = await supabase.from('staff').update(updateData).eq('id', editingStaff.id);
        if (error) throw error;
        setToast({ message: t('saas.update_success'), type: 'success' });
      } else {
        const { error } = await supabase.from('staff').insert({
          name: data.name,
          role: dbRoleValue,
          role_id: validRoleId,
          branch_id: data.branchId || null,
          email: data.email,
          phone: data.phone,
          status: data.status,
          is_test: data.isTest,
          pin_hash: data.enablePin ? finalPinHash : null,
          must_change_pin: data.enablePin ? isAutoGenerated : false,
          tenant_id: tenantId,
          created_at: new Date().toISOString()
        });

        if (error) throw error;

        // Audit Log
        await supabase.from('audit_logs').insert({
          action: isAutoGenerated ? 'إنشاء رمز تلقائي' : 'إضافة موظف',
          performed_by: auth.currentUser?.uid || null,
          performed_by_email: auth.currentUser?.email || 'unknown',
          target_tenant_id: tenantId,
          details: `تم إضافة الموظف ${data.name} ${isAutoGenerated ? 'مع إنشاء رمز تلقائي' : ''}`,
          occurred_at: new Date().toISOString(),
          type: 'security'
        });

        setToast({ message: isAutoGenerated ? t('settings_page.staff.add_success_with_pin') : t('settings_page.staff.add_success'), type: 'success' });
      }
      setIsModalOpen(false);
      setEditingStaff(null);
      reset();
    } catch (error: any) {
      console.error('Error saving staff:', error);
      let errorString = t('errors.system_generic');
      if (error) {
        if (error instanceof Error) {
          errorString = error.message;
        } else if (typeof error === 'string') {
          errorString = error;
        } else if (error.message) {
          errorString = error.message;
        } else {
          try {
            errorString = JSON.stringify(error);
          } catch (_) {
            errorString = String(error);
          }
        }
      }
      
      let friendlyMsg = errorString;
      if (errorString.includes('duplicate key') || errorString.includes('unique constraint') || errorString.includes('already exists')) {
        if (errorString.includes('email')) {
          friendlyMsg = t('settings_page.staff.email_duplicate');
        } else if (errorString.includes('phone')) {
          friendlyMsg = t('settings_page.staff.phone_duplicate');
        } else {
          friendlyMsg = t('settings_page.staff.duplicate_data');
        }
      } else if (errorString.includes('JWT') || errorString.includes('token') || errorString.includes('authenticated') || errorString.includes('Permission')) {
        friendlyMsg = t('errors.insufficient_permissions');
      }

      setToast({ message: t('settings_page.staff.save_failed', { message: friendlyMsg }), type: 'error' });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('settings_page.staff.confirm_delete_employee'))) return;
    try {
      const { error } = await supabase.from('staff').delete().eq('id', id);
      if (error) throw error;
      setToast({ message: t('settings_page.staff.delete_success'), type: 'success' });
    } catch (error: any) {
      console.error('Error deleting staff:', error);
      setToast({ message: t('settings_page.staff.delete_failed', { message: error?.message || t('errors.unknown') }), type: 'error' });
    }
  };

  const toggleStatus = async (member: StaffMember) => {
    try {
      const { error } = await supabase.from('staff').update({
        status: member.status === 'active' ? 'inactive' : 'active',
        updated_at: new Date().toISOString()
      }).eq('id', member.id);
      if (error) throw error;
      setToast({ message: t('settings_page.staff.status_update_success'), type: 'success' });
    } catch (error: any) {
      console.error('Error toggling staff status:', error);
      setToast({ message: t('settings_page.staff.status_update_failed', { message: error?.message || t('errors.unknown') }), type: 'error' });
    }
  };

  const togglePin = async (member: StaffMember) => {
    try {
      if (member.pin) {
        // Disable PIN
        const { error } = await supabase.from('staff').update({
          pin_hash: null,
          must_change_pin: false,
          updated_at: new Date().toISOString()
        }).eq('id', member.id);
        
        if (error) throw error;
        
        // Audit log for security
        await supabase.from('audit_logs').insert({
          action: 'إلغاء رمز الدخول',
          performed_by: auth.currentUser?.uid || null,
          performed_by_email: auth.currentUser?.email || 'unknown',
          target_tenant_id: tenantId,
          details: `تم إلغاء رمز الدخول للموظف ${member.name}`,
          occurred_at: new Date().toISOString(),
          type: 'security'
        });

        setToast({ message: t('settings_page.staff.pin_disabled_success'), type: 'success' });
      } else {
        // Enable PIN - Auto generate
        let uniquePin = '';
        let attempts = 0;
        while (attempts < 10) {
          const candidate = generateSecurePin(4);
          if (await isPinUnique(tenantId!, candidate)) {
            uniquePin = candidate;
            break;
          }
          attempts++;
        }
        
        if (!uniquePin) throw new Error(t('settings_page.staff.pin_unique_failed'));
        
        const pinHash = await hashPin(uniquePin);
        
        const { error } = await supabase.from('staff').update({
          pin_hash: pinHash,
          must_change_pin: true,
          updated_at: new Date().toISOString()
        }).eq('id', member.id);
        
        if (error) throw error;

        // Audit log for security
        await supabase.from('audit_logs').insert({
          action: 'تفعيل رمز الدخول التلقائي',
          performed_by: auth.currentUser?.uid || null,
          performed_by_email: auth.currentUser?.email || 'unknown',
          target_tenant_id: tenantId,
          details: `تم تفعيل وتوليد رمز دخول للموظف ${member.name}`,
          occurred_at: new Date().toISOString(),
          type: 'security'
        });

        setToast({ 
          message: t('settings_page.staff.pin_enabled_success', { name: member.name, pin: uniquePin }), 
          type: 'success' 
        });
      }
    } catch (error: any) {
      console.error('Error toggling staff pin:', error);
      setToast({ message: t('settings_page.staff.pin_update_failed', { message: error?.message || t('errors.unknown') }), type: 'error' });
    }
  };

  const handleTogglePermission = async (roleId: string, key: PermissionKey) => {
    try {
      const role = roles.find(r => r.id === roleId);
      if (!role) return;

      const isDefaultRole = Boolean(!role.tenantId || role.tenantId === 'system' || DEFAULT_ROLES[role.roleKey] || role.isDefault);
      if (!isSuperAdmin && (role.roleKey === 'owner' || isDefaultRole)) {
        setToast({ message: t('settings_page.staff.permissions.default_roles_protected'), type: 'error' });
        return;
      }

      const newPermissions = {
        ...role.permissions,
        [key]: !role.permissions[key]
      };

      // Optimistically update roles state and selected role view immediately
      setRoles(prevRoles => prevRoles.map(r => r.id === roleId ? { ...r, permissions: newPermissions } : r));
      setSelectedRoleForPermissions(prev => prev && prev.id === roleId ? { ...prev, permissions: newPermissions } : prev);

      await updateRolePermissions(
        roleId,
        newPermissions,
        auth.currentUser?.uid || null,
        auth.currentUser?.email || '',
        tenantId!
      );
      setToast({ message: t('settings_page.staff.permissions.update_success'), type: 'success' });
    } catch (error) {
      setToast({ message: t('settings_page.staff.permissions.update_error'), type: 'error' });
      await fetchRoles(); // Revert back to database state on failure
    }
  };

  const handleToggleStaffOverride = async (staffId: string, key: PermissionKey) => {
    const staffMember = staff.find(s => s.id === staffId);
    if (!staffMember) return;

    const role = roles.find(r => r.roleKey === staffMember.role);
    const baseValue = role?.permissions[key] ?? false;
    const currentOverride = overrides[staffId]?.[key];
    
    const effectiveValue = currentOverride !== undefined ? currentOverride : baseValue;
    const newValue = !effectiveValue;

    const newOverrides = { ...(overrides[staffId] || {}) };
    
    if (newValue === baseValue) {
      delete newOverrides[key];
    } else {
      newOverrides[key] = newValue;
    }

    // Optimistic update
    setOverrides(prev => ({ ...prev, [staffId]: newOverrides }));

    try {
      await updateUserOverrides(
        staffId,
        tenantId!,
        newOverrides,
        auth.currentUser?.uid || null,
        auth.currentUser?.email || ''
      );
      setToast({ message: t('settings_page.staff.permissions.override_success'), type: 'success' });
    } catch (err) {
      setToast({ message: t('settings_page.staff.permissions.override_failed'), type: 'error' });
      await fetchOverrides();
    }
  };

  const handleResetOverrides = async (staffId: string) => {
    if (!window.confirm(t('settings_page.staff.permissions.confirm_reset_overrides'))) return;

    setIsSavingPermissions(true);
    try {
      await supabase.from('user_permission_overrides').delete().eq('staff_id', staffId);
      setOverrides(prev => ({ ...prev, [staffId]: {} }));
      setToast({ message: t('settings_page.staff.permissions.reset_success'), type: 'success' });
    } catch (err) {
      setToast({ message: t('settings_page.staff.permissions.reset_failed'), type: 'error' });
    } finally {
      setIsSavingPermissions(false);
      setTimeout(() => setToast(null), 3000);
    }
  };

  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoleName || isSavingPermissions) return;

    setIsSavingPermissions(true);
    try {
      const defaultPerms = DEFAULT_ROLES.tailor.permissions;
      await createCustomRole(
        tenantId!,
        newRoleName,
        newRoleDesc,
        defaultPerms,
        auth.currentUser?.uid || null,
        auth.currentUser?.email || ''
      );
      setToast({ message: t('settings_page.staff.permissions.create_success'), type: 'success' });
      setShowCreateRole(false);
      setNewRoleName('');
      setNewRoleDesc('');
      await fetchRoles();
    } catch (err) {
      setToast({ message: t('settings_page.staff.permissions.create_failed'), type: 'error' });
    } finally {
      setIsSavingPermissions(false);
      setTimeout(() => setToast(null), 3000);
    }
  };

  const handleUpdateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRole || !newRoleName || isSavingPermissions) return;

    setIsSavingPermissions(true);
    try {
      const { error } = await supabase.from('roles').update({
        name: newRoleName,
        description: newRoleDesc,
        updated_at: new Date().toISOString()
      }).eq('id', editingRole.id);
      if (error) throw error;
      
      setToast({ message: t('settings_page.staff.permissions.role_update_success'), type: 'success' });
      setEditingRole(null);
      setNewRoleName('');
      setNewRoleDesc('');
      await fetchRoles();
    } catch (err) {
      setToast({ message: t('settings_page.staff.permissions.role_update_failed'), type: 'error' });
    } finally {
      setIsSavingPermissions(false);
      setTimeout(() => setToast(null), 3000);
    }
  };

  const confirmDeleteRole = (role: Role) => {
    if (role.roleKey === 'owner' || role.roleKey === 'manager') {
      setToast({ message: t('settings_page.staff.permissions.cannot_delete_core'), type: 'error' });
      return;
    }
    setRoleToDelete(role);
  };

  const executeDeleteRole = async () => {
    if (!roleToDelete || isSavingPermissions) return;

    setIsSavingPermissions(true);
    try {
      const { error } = await supabase.from('roles').delete().eq('id', roleToDelete.id);
      if (error) throw error;
      setToast({ message: t('settings_page.staff.permissions.delete_success'), type: 'success' });
      await fetchRoles();
      setRoleToDelete(null);
    } catch (err: any) {
      console.warn("Error deleting role:", err);
      setToast({ message: err?.message || t('settings_page.staff.permissions.delete_failed'), type: 'error' });
    } finally {
      setIsSavingPermissions(false);
      setTimeout(() => setToast(null), 3000);
    }
  };

  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => 
      prev.includes(category) 
        ? prev.filter(c => c !== category) 
        : [...prev, category]
    );
  };

  const toggleAllCategories = () => {
    if (expandedCategories.length === categories.length) {
      setExpandedCategories([]);
    } else {
      setExpandedCategories(categories);
    }
  };

  const filteredPermissions = SYSTEM_PERMISSIONS.filter(p => {
    const transName = getTransPermName(p.id, p.categoryKey, p.name);
    const transDesc = getTransPermDesc(p.id, p.categoryKey, p.description);
    return transName.toLowerCase().includes(searchTerm.toLowerCase()) || 
           transDesc.toLowerCase().includes(searchTerm.toLowerCase()) ||
           p.id.toLowerCase().includes(searchTerm.toLowerCase());
  });

  const categories = Array.from(new Set(filteredPermissions.map(p => p.categoryKey)));

  return (
    <div className={cn("p-4 sm:p-6 space-y-6 sm:space-y-8", isRtl ? "text-right" : "text-left")} dir={isRtl ? "rtl" : "ltr"}>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 min-w-0">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-3xl font-black text-content flex items-center gap-2 sm:gap-3">
            <Shield className="text-brand shrink-0" size={24} />
            {t('settings_page.staff.title')}
          </h1>
          <p className="text-content-muted font-medium mt-1 text-sm sm:text-base">{t('settings_page.staff.subtitle')}</p>
        </div>
        {/* The view switcher holds up to 5 tabs; it scrolls horizontally on
            narrow screens instead of being clipped by the Settings shell. */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full md:w-auto min-w-0">
          <div className="bg-surface-muted p-1 rounded-2xl flex w-full md:w-auto overflow-x-auto scrollbar-hide">
            <button 
              onClick={() => setViewMode('list')}
              className={`px-3 sm:px-4 py-2 rounded-xl text-xs font-black transition-all shrink-0 whitespace-nowrap ${viewMode === 'list' ? 'bg-surface text-brand shadow-sm' : 'text-content-muted'}`}
            >
              {t('settings_page.staff.tab_list')}
            </button>
            <button 
              onClick={() => setViewMode('permissions')}
              className={`px-3 sm:px-4 py-2 rounded-xl text-xs font-black transition-all shrink-0 whitespace-nowrap ${viewMode === 'permissions' ? 'bg-surface text-brand shadow-sm' : 'text-content-muted'}`}
            >
              {t('settings_page.staff.tab_permissions')}
            </button>
            {(hasPermission('reports.view') || currentStaff?.role === 'manager' || currentStaff?.role === 'owner') && (
              <button 
                onClick={() => setViewMode('employee_activity')}
                className={`px-3 sm:px-4 py-2 rounded-xl text-xs font-black transition-all shrink-0 whitespace-nowrap ${viewMode === 'employee_activity' ? 'bg-surface text-brand shadow-sm' : 'text-content-muted'}`}
              >
                {t('settings_page.staff.tab_activity')}
              </button>
            )}
          </div>
          {canCreate && viewMode !== 'permissions' && viewMode !== 'employee_activity' && (
            <button 
              onClick={() => {
                setIsAddModalOpen(true);
              }}
              className="bg-brand text-white px-5 sm:px-6 py-3 rounded-2xl flex items-center justify-center gap-2 hover:bg-brand/90 transition-all shadow-lg shadow-brand/10 font-bold shrink-0 whitespace-nowrap w-full sm:w-auto"
            >
              <Plus size={20} />
              <span>{t('settings_page.staff.add_employee')}</span>
            </button>
          )}
          {viewMode === 'permissions' && (
            <div className="flex items-center gap-2">
              {currentStaff?.email === "nomansa2566512@gmail.com" && roles.length === 0 && (
                <button 
                  onClick={handleSeedRoles}
                  disabled={isSeeding}
                  className="bg-warning text-white px-6 py-3 rounded-2xl flex items-center gap-2 hover:bg-warning/90 transition-all shadow-lg shadow-warning/20 font-bold disabled:opacity-50"
                >
                  <Zap size={20} className={isSeeding ? "animate-pulse" : ""} />
                  <span>{isSeeding ? t('settings_page.staff.seeding_roles') : t('settings_page.staff.seed_default_roles')}</span>
                </button>
              )}
              <button 
                onClick={() => setShowCreateRole(true)}
                className="bg-brand text-white px-6 py-3 rounded-2xl flex items-center gap-2 hover:bg-brand/90 transition-all shadow-lg shadow-brand/10 font-bold"
              >
                <Plus size={20} />
                <span>{t('settings_page.staff.add_custom_role')}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Toast Notification */}
      <AnimatePresence>
        {showPermissionsModal && (
          <RolePermissionsModal 
            role={showPermissionsModal}
            onClose={() => setShowPermissionsModal(null)}
          />
        )}

        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={cn(
              "fixed top-6 left-1/2 -translate-x-1/2 z-[200] px-6 py-3 rounded-2xl shadow-2xl font-bold text-sm flex items-center gap-2 border",
              toast.type === 'success' ? "bg-success/5 text-success border-success/10" : "bg-danger/5 text-danger border-danger/10"
            )}
          >
            {toast.type === 'success' ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>

      {viewMode !== 'permissions' && viewMode !== 'employee_activity' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 items-center">
          <div className="flex items-center gap-2.5 bg-surface-muted/50 hover:bg-surface-muted/80 border border-border focus-within:border-brand/40 focus-within:bg-surface rounded-2xl px-4 h-12 transition-all w-full shadow-inner shadow-black/5">
            <Search className="text-content-muted shrink-0" size={18} />
            <input 
              type="text"
              placeholder={t('settings_page.staff.search_placeholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-transparent font-bold outline-none text-content border-none p-0 focus:ring-0 text-sm"
            />
          </div>
          
          <SmartSelect 
            value={roleFilter}
            onChange={(val) => setRoleFilter(val)}
            className="w-full rounded-2xl h-12 bg-surface-muted/50 hover:bg-surface-muted/80 border border-border text-sm font-bold text-content shadow-inner shadow-black/5"
            options={[
              { value: 'all', label: t('settings_page.staff.all_roles'), icon: <Shield size={14} className="text-brand" /> },
              ...roles.map(role => ({ value: role.roleKey, label: role.name, icon: <Shield size={14} className="text-content-muted" /> }))
            ]}
          />

          <SmartSelect 
            value={branchFilter}
            onChange={(val) => setBranchFilter(val)}
            className="w-full rounded-2xl h-12 bg-surface-muted/50 hover:bg-surface-muted/80 border border-border text-sm font-bold text-content shadow-inner shadow-black/5"
            options={[
              { value: 'all', label: t('settings_page.staff.all_branches'), icon: <Building2 size={14} className="text-brand" /> },
              ...branches.map(branch => ({ value: branch.id, label: branch.name, icon: <Building2 size={14} className="text-content-muted" /> }))
            ]}
          />

          <SmartSelect 
            value={statusFilter}
            onChange={(val) => setStatusFilter(val)}
            className="w-full rounded-2xl h-12 bg-surface-muted/50 hover:bg-surface-muted/80 border border-border text-sm font-bold text-content shadow-inner shadow-black/5"
            options={[
              { value: 'all', label: t('settings_page.staff.all_statuses'), icon: <Users size={14} className="text-brand" /> },
              { value: 'active', label: t('settings_page.staff.status_active'), icon: <CheckCircle size={14} className="text-emerald-500" /> },
              { value: 'inactive', label: t('settings_page.staff.status_inactive'), icon: <XCircle size={14} className="text-rose-500" /> }
            ]}
          />
        </div>
      )}

      {viewMode === 'employee_activity' && (
        <EmployeeActivityLogTab tenantId={tenantId} />
      )}

      {viewMode === 'list' && (
        <div className="space-y-4">
          {filteredStaff.map((member) => {
            const isDropdownOpen = activeDropdown === member.id;
            return (
              <motion.div 
                key={member.id}
                layout
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-surface p-4 sm:p-6 rounded-2xl sm:rounded-3xl border border-border shadow-xs hover:shadow-md transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-6 relative overflow-visible text-right"
              >
                {/* Active/Inactive side accent */}
                <div className={cn(
                  "absolute top-0 right-0 w-2 h-full rounded-r-2xl sm:rounded-r-3xl",
                  member.status === 'active' ? 'bg-success' : 'bg-slate-300'
                )} />

                {/* Right side: Employee Avatar + Info */}
                <div className="flex items-center gap-4 min-w-0 flex-1 pr-2">
                  <div className={cn(
                    "w-12 h-12 sm:w-14 sm:h-14 rounded-2xl shrink-0 flex items-center justify-center font-black text-lg shadow-inner",
                    member.role === 'manager' || member.role === 'owner' ? 'bg-brand/10 text-brand' :
                    member.role === 'cashier' ? 'bg-info/10 text-info' : 'bg-warning/10 text-warning'
                  )}>
                    {member.name.charAt(0)}
                  </div>
                  
                  <div className="min-w-0 space-y-2 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-black text-base sm:text-lg text-content truncate">
                        {member.name}
                      </h3>
                      {member.isTest && (
                        <span className="text-[9px] bg-danger/10 text-danger px-2 py-0.5 rounded-full font-black uppercase tracking-wider flex items-center gap-1 shrink-0">
                          <Zap size={9} />
                          {t('common.test')}
                        </span>
                      )}
                      <span className="text-[10px] font-black text-content-muted uppercase tracking-wider bg-surface-muted px-2.5 py-0.5 rounded-full flex items-center gap-1 shrink-0">
                        {roles.find(r => r.roleKey === member.role)?.name || member.role}
                      </span>
                    </div>

                    {/* Basic details in a single clean row */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-content-muted">
                      {member.email && (
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Mail size={13} className="text-content-muted shrink-0" />
                          <span className="truncate">{member.email}</span>
                        </div>
                      )}
                      {member.phone && (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Smartphone size={13} className="text-content-muted shrink-0" />
                          <span className="ltr">{member.phone}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Building2 size={13} className="text-brand shrink-0" />
                        <span className="font-bold text-brand">
                          {branches.find(b => b.id === member.branchId)?.name || t('orders.not_specified')}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Left side: Status indicator + Settings Dropdown Trigger */}
                <div className="flex items-center justify-between sm:justify-end gap-3 pt-3 sm:pt-0 border-t sm:border-none border-border/40 shrink-0 relative">
                  <div className="flex items-center gap-1.5">
                    <span className={cn(
                      "w-2 h-2 rounded-full",
                      member.status === 'active' ? 'bg-success' : 'bg-slate-400'
                    )} />
                    <span className={cn(
                      "text-xs font-black",
                      member.status === 'active' ? 'text-success' : 'text-content-muted'
                    )}>
                      {member.status === 'active' ? t('common.active') : t('settings_page.staff.permissions.disabled')}
                    </span>
                  </div>

                  {/* Settings gear dropdown wrapper */}
                  <div className="relative">
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveDropdown(isDropdownOpen ? null : member.id);
                      }}
                      className={cn(
                        "p-2 rounded-xl transition-all border border-border/60 hover:bg-surface-muted text-content hover:text-brand cursor-pointer flex items-center justify-center",
                        isDropdownOpen ? "bg-surface-muted text-brand border-brand/20" : "bg-surface"
                      )}
                      title={t('common.actions')}
                    >
                      <Settings size={18} className={cn("transition-transform duration-300", isDropdownOpen && "rotate-45")} />
                    </button>

                    {/* Transparent overlay to close dropdown when clicking outside */}
                    {isDropdownOpen && (
                      <div 
                        className="fixed inset-0 z-30 cursor-default"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveDropdown(null);
                        }}
                      />
                    )}

                    {/* Dropdown menu */}
                    <AnimatePresence>
                      {isDropdownOpen && (
                        <motion.div 
                          initial={{ opacity: 0, y: 10, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 10, scale: 0.95 }}
                          transition={{ duration: 0.15 }}
                          className="absolute left-0 mt-2 w-48 bg-surface border border-border/80 rounded-2xl shadow-xl p-1.5 z-40 text-right space-y-0.5 origin-top-left"
                        >
                          <button 
                            onClick={() => {
                              setSelectedStaffForDetails(member);
                              setActiveDropdown(null);
                            }}
                            className="w-full text-right px-3 py-2 text-xs font-black text-content hover:bg-surface-muted/80 rounded-xl transition-colors flex items-center gap-2 cursor-pointer"
                          >
                            <User size={14} className="text-content-muted" />
                            <span>{t('settings_page.printer.show_details')}</span>
                          </button>

                          {canEdit && (
                            <>
                              <button 
                                onClick={() => {
                                  setEditingStaff(member);
                                  setIsModalOpen(true);
                                  setActiveDropdown(null);
                                }}
                                className="w-full text-right px-3 py-2 text-xs font-black text-content hover:bg-surface-muted/80 rounded-xl transition-colors flex items-center gap-2 cursor-pointer"
                              >
                                <Edit2 size={14} className="text-content-muted" />
                                <span>{t('customers.edit_data')}</span>
                              </button>

                              <button 
                                onClick={() => {
                                  setSelectedStaffForPermissions(member);
                                  setViewMode('permissions');
                                  setPermissionTabMode('staff');
                                  setActiveDropdown(null);
                                }}
                                className="w-full text-right px-3 py-2 text-xs font-black text-content hover:bg-surface-muted/80 rounded-xl transition-colors flex items-center gap-2 cursor-pointer"
                              >
                                <Shield size={14} className="text-content-muted" />
                                <span>{t('staff.manage_permissions')}</span>
                              </button>

                              <button 
                                onClick={() => {
                                  togglePin(member);
                                  setActiveDropdown(null);
                                }}
                                className="w-full text-right px-3 py-2 text-xs font-black text-content hover:bg-surface-muted/80 rounded-xl transition-colors flex items-center gap-2 cursor-pointer"
                              >
                                <Key size={14} className="text-content-muted" />
                                <span>{member.pin ? t('staff.disable_employee_pin') : t('staff.force_pin.enable_toggle')}</span>
                              </button>
                            </>
                          )}

                          <button 
                            onClick={() => {
                              toggleStatus(member);
                              setActiveDropdown(null);
                            }}
                            className={cn(
                              "w-full text-right px-3 py-2 text-xs font-black rounded-xl transition-colors flex items-center gap-2 cursor-pointer",
                              member.status === 'active' 
                                ? "text-danger hover:bg-danger/5" 
                                : "text-success hover:bg-success/5"
                            )}
                          >
                            <CheckCircle size={14} className={member.status === 'active' ? "text-danger" : "text-success"} />
                            <span>{member.status === 'active' ? t('staff.deactivate_account') : t('staff.activate_account')}</span>
                          </button>

                          {canDelete && (
                            <div className="border-t border-border/40 my-1 pt-1">
                              <button 
                                onClick={() => {
                                  handleDelete(member.id);
                                  setActiveDropdown(null);
                                }}
                                className="w-full text-right px-3 py-2 text-xs font-black text-danger hover:bg-danger/10 rounded-xl transition-colors flex items-center gap-2 cursor-pointer"
                              >
                                <Trash2 size={14} className="text-danger" />
                                <span>{t('staff.delete_employee')}</span>
                              </button>
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {viewMode === 'permissions' && (
        <div className="space-y-6 sm:space-y-8">
          {/* Permissions Mode Selector Header */}
          <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3 bg-surface p-2 sm:p-2.5 rounded-2xl border border-border shadow-sm">
            <div className="bg-surface-muted p-1 rounded-xl flex w-full sm:w-auto">
              <button 
                onClick={() => {
                  setPermissionTabMode('roles');
                  setSelectedStaffForPermissions(null);
                }}
                className={`flex-1 sm:flex-initial px-4 sm:px-6 py-2 rounded-lg sm:rounded-xl text-xs font-black transition-all ${permissionTabMode === 'roles' ? 'bg-surface text-brand shadow-sm' : 'text-content-muted hover:text-content'}`}
              >
                {t('settings_page.staff.tab_by_role')}
              </button>
              <button 
                onClick={() => setPermissionTabMode('staff')}
                className={`flex-1 sm:flex-initial px-4 sm:px-6 py-2 rounded-lg sm:rounded-xl text-xs font-black transition-all ${permissionTabMode === 'staff' ? 'bg-surface text-brand shadow-sm' : 'text-content-muted hover:text-content'}`}
              >
                {t('settings_page.staff.tab_by_employee')}
              </button>
            </div>

            {permissionTabMode === 'roles' && (
              <div className="flex items-center gap-2 justify-end">
                <button 
                  onClick={toggleAllCategories}
                  className="px-3.5 py-2 rounded-xl text-xs font-black bg-surface-muted border border-border text-content-muted hover:text-content hover:bg-border transition-all whitespace-nowrap"
                >
                  {expandedCategories.length === categories.length ? t('settings_page.staff.permissions.collapse_all') : t('settings_page.staff.permissions.expand_all')}
                </button>
                <button 
                  onClick={() => setShowCreateRole(true)}
                  className="px-4 py-2 rounded-xl text-xs font-black bg-brand text-white hover:bg-brand/90 shadow-md shadow-brand/10 transition-all flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Plus size={15} />
                  <span>{t('settings_page.staff.permissions.add_custom_role')}</span>
                </button>
              </div>
            )}
          </div>

          {permissionTabMode === 'roles' ? (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
              {/* Roles Sidebar */}
              <div className="lg:col-span-4 xl:col-span-3 space-y-4">
                <div className="bg-surface rounded-2xl sm:rounded-[2rem] border border-border shadow-sm overflow-hidden">
                  <div className="p-4 sm:p-5 bg-surface-muted/50 border-b border-border flex justify-between items-center">
                    <h4 className="text-xs font-black text-content-muted uppercase tracking-widest">{t('settings_page.staff.permissions.roles_title')}</h4>
                    <button 
                      onClick={() => setShowCreateRole(true)}
                      className="p-1.5 bg-brand text-white rounded-lg hover:bg-brand/90 transition-all shadow-sm"
                      title={t('settings_page.staff.permissions.add_custom_role')}
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                  <div className="p-3 border-b border-border bg-surface-muted/20">
                    <div className="flex items-center gap-2 bg-surface border border-border focus-within:border-brand rounded-xl px-3 py-2 transition-all w-full">
                      <Search className="text-content-muted shrink-0" size={14} />
                      <input 
                        type="text" 
                        placeholder={t('settings_page.staff.permissions.search_roles')} 
                        value={sidebarSearchTerm} 
                        onChange={e => setSidebarSearchTerm(e.target.value)} 
                        className="w-full bg-transparent text-xs font-bold outline-none text-content border-none p-0 focus:ring-0" 
                      />
                    </div>
                  </div>
                  <div className="max-h-[500px] lg:max-h-[600px] overflow-y-auto divide-y divide-border/60">
                    {activeRoles.filter(r => r.name.toLowerCase().includes(sidebarSearchTerm.toLowerCase())).map(role => (
                      <div
                        key={role.id}
                        onClick={() => setSelectedRoleForPermissions(role)}
                        className={cn(
                          "w-full p-3.5 sm:p-4 flex items-center justify-between hover:bg-surface-muted/60 transition-all text-right relative group cursor-pointer min-w-0",
                          selectedRoleForPermissions?.id === role.id ? "bg-brand/5 border-r-4 border-r-brand" : ""
                        )}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className={cn(
                            "w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center shrink-0",
                            role.roleKey === 'owner' ? "bg-warning/10 text-warning" : 
                            role.roleKey === 'manager' ? "bg-success/10 text-success" :
                            "bg-brand/10 text-brand"
                          )}>
                            <Shield size={18} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs sm:text-sm font-black text-content truncate">{role.name}</p>
                            <span className="text-[9px] font-bold text-content-muted block">
                              {(!role.tenantId || role.tenantId === 'system') ? t('settings_page.staff.permissions.system_template') : t('settings_page.staff.permissions.custom_role')}
                            </span>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-1 shrink-0 opacity-80 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                          {role.roleKey !== 'owner' && (
                            <>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingRole(role);
                                  setNewRoleName(role.name);
                                  setNewRoleDesc(role.description || '');
                                }}
                                className="p-1.5 text-content-muted hover:text-brand rounded-lg hover:bg-surface"
                                title={t('settings_page.staff.permissions.edit_role_title')}
                              >
                                <Edit2 size={13} />
                              </button>
                              {role.roleKey !== 'manager' && role.tenantId && role.tenantId !== 'system' && (
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    confirmDeleteRole(role);
                                  }}
                                  className="p-1.5 text-content-muted hover:text-danger rounded-lg hover:bg-surface"
                                  title={t('settings_page.staff.permissions.delete_role_title')}
                                >
                                  <Trash2 size={13} />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Permissions Matrix Cards */}
              <div className="lg:col-span-8 xl:col-span-9 space-y-6">
                {selectedRoleForPermissions && (
                  <>
                    {/* Role Header Card */}
                    <div className="bg-surface p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] border border-border shadow-sm space-y-4">
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                        <div className="flex items-center gap-3.5 min-w-0">
                          <div className={cn(
                            "p-3 rounded-2xl shadow-md shrink-0 text-white",
                            selectedRoleForPermissions.roleKey === 'owner' ? "bg-warning shadow-warning/20" :
                            selectedRoleForPermissions.roleKey === 'manager' ? "bg-success shadow-success/20" :
                            "bg-brand shadow-brand/20"
                          )}>
                            <Shield size={22} />
                          </div>
                          <div className="min-w-0">
                            <h3 className="text-base sm:text-xl font-black text-content truncate">
                              {t('settings_page.staff.permissions.role_permissions', { name: selectedRoleForPermissions.name })}
                            </h3>
                            <p className="text-xs text-content-muted font-bold mt-0.5 line-clamp-1">{selectedRoleForPermissions.description}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 bg-surface-muted border border-border focus-within:border-brand rounded-xl px-3 py-2 transition-all w-full sm:w-64 shrink-0">
                          <Search className="text-content-muted shrink-0" size={15} />
                          <input 
                            type="text"
                            placeholder={t('settings_page.staff.permissions.search_permissions')}
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full bg-transparent text-xs font-bold outline-none text-content border-none p-0 focus:ring-0"
                          />
                        </div>
                      </div>

                      {/* Staff Members Tagged under this role */}
                      {(() => {
                        const roleStaffMembers = staff.filter(s => s.role === selectedRoleForPermissions.roleKey);
                        return roleStaffMembers.length > 0 ? (
                          <div className="pt-3 border-t border-border/50 flex flex-wrap items-center gap-2">
                            <span className="text-xs font-black text-content-muted shrink-0">
                              {t('settings_page.staff.permissions.employees_in_role', { count: roleStaffMembers.length })}
                            </span>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {roleStaffMembers.map(s => (
                                <button
                                  key={s.id}
                                  onClick={() => {
                                    setPermissionTabMode('staff');
                                    setSelectedStaffForPermissions(s);
                                    setSelectedRoleForPermissions(null);
                                  }}
                                  className="px-2.5 py-1 bg-brand/10 hover:bg-brand text-brand hover:text-white rounded-xl text-[11px] font-black flex items-center gap-1 transition-all cursor-pointer border border-brand/20"
                                  title={t('settings_page.staff.permissions.view_employee_exceptions')}
                                >
                                  <User size={12} />
                                  <span>{s.name}</span>
                                  {Object.keys(overrides[s.id] || {}).length > 0 && (
                                    <span className="bg-amber-500 text-white text-[9px] px-1.5 rounded-full font-bold">
                                      {Object.keys(overrides[s.id] || {}).length}
                                    </span>
                                  )}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null;
                      })()}
                    </div>

                    {!isSuperAdmin && (!selectedRoleForPermissions.tenantId || selectedRoleForPermissions.tenantId === 'system' || DEFAULT_ROLES[selectedRoleForPermissions.roleKey] || selectedRoleForPermissions.isDefault) && (
                      <div className="p-4 bg-amber-500/10 rounded-2xl border border-amber-500/30 text-right flex items-center justify-between flex-wrap gap-3 shadow-sm">
                        <div className="flex items-center gap-2 text-amber-800 dark:text-amber-400 font-bold text-xs">
                          <Lock size={16} className="shrink-0" />
                          <span>{t('settings_page.staff.permissions.protected_role_msg')}</span>
                        </div>
                        <button
                          onClick={() => {
                            setNewRoleName(t('permissions.suggested_custom_role_name', { role: selectedRoleForPermissions.name }));
                            setNewRoleDesc(t('permissions.suggested_custom_role_desc', { role: selectedRoleForPermissions.name }));
                            setShowCreateRole(true);
                          }}
                          className="px-3.5 py-1.5 bg-brand text-white font-black text-xs rounded-xl shadow-sm hover:bg-brand/90 transition-all flex items-center gap-1.5 cursor-pointer shrink-0"
                        >
                          <Plus size={14} />
                          <span>{t('settings_page.staff.permissions.create_custom_role')}</span>
                        </button>
                      </div>
                    )}

                    {/* Permissions Grid Categories */}
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-6 items-start">
                      {categories.map(category => {
                        const categoryPerms = SYSTEM_PERMISSIONS.filter(p => {
                          const transName = getTransPermName(p.id, p.categoryKey, p.name);
                          const transDesc = getTransPermDesc(p.id, p.categoryKey, p.description);
                          return p.categoryKey === category && 
                            (transName.toLowerCase().includes(searchTerm.toLowerCase()) || transDesc.toLowerCase().includes(searchTerm.toLowerCase()));
                        });
                        
                        if (categoryPerms.length === 0) return null;
                        const isExpanded = expandedCategories.includes(category);
                        const enabledCount = categoryPerms.filter(p => selectedRoleForPermissions.permissions[p.id as PermissionKey]).length;

                        return (
                          <div key={category} className="bg-surface rounded-2xl sm:rounded-[2rem] border border-border shadow-sm overflow-hidden flex flex-col">
                            <button 
                              onClick={() => toggleCategory(category)}
                              className="w-full p-4 sm:p-5 bg-surface-muted/30 border-b border-border flex items-center justify-between group transition-colors hover:bg-surface-muted/60"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className="w-2 h-5 bg-brand rounded-full shrink-0" />
                                <h4 className="text-xs sm:text-sm font-black text-brand uppercase tracking-wider truncate">{getTransCat(category)}</h4>
                                <span className="bg-brand/10 text-brand text-[10px] px-2 py-0.5 rounded-full font-black shrink-0">
                                  {t('settings_page.staff.permissions.enabled_count', { enabled: enabledCount, total: categoryPerms.length })}
                                </span>
                              </div>
                              <div className={cn(
                                "p-1.5 rounded-lg bg-surface border border-border text-content-muted transition-all shrink-0",
                                isExpanded ? "rotate-180 text-brand border-brand/30" : ""
                              )}>
                                <ChevronDown size={15} />
                              </div>
                            </button>
                            
                            <AnimatePresence>
                              {isExpanded && (
                                <motion.div 
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: 'auto', opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  transition={{ duration: 0.25, ease: "easeInOut" }}
                                  className="overflow-hidden"
                                >
                                  <div className="p-3.5 sm:p-4 space-y-3">
                                    {categoryPerms.map(perm => {
                                      const isEnabled = selectedRoleForPermissions.permissions[perm.id as PermissionKey];
                                      const isDefaultRole = Boolean(!selectedRoleForPermissions.tenantId || selectedRoleForPermissions.tenantId === 'system' || DEFAULT_ROLES[selectedRoleForPermissions.roleKey] || selectedRoleForPermissions.isDefault);
                                      const isReadOnlyRole = selectedRoleForPermissions.roleKey === 'owner' || (!isSuperAdmin && isDefaultRole);
                                      
                                      return (
                                        <div key={perm.id} className={cn("flex items-start justify-between gap-3 p-3.5 sm:p-4 bg-surface-muted/30 hover:bg-surface-muted/70 rounded-2xl border border-border/60 transition-all group", isReadOnlyRole ? "opacity-75 cursor-not-allowed" : "hover:border-brand/30")}>
                                          <div className="min-w-0 flex-1 space-y-0.5">
                                            <span className="text-xs sm:text-sm font-bold text-content group-hover:text-brand transition-colors block leading-tight">{getTransPermName(perm.id, perm.categoryKey, perm.name)}</span>
                                            <span className="text-[11px] text-content-muted font-medium leading-relaxed block">{getTransPermDesc(perm.id, perm.categoryKey, perm.description)}</span>
                                          </div>
                                          
                                          <div className="shrink-0 flex items-center gap-2 pt-0.5">
                                            <span className={cn(
                                              "text-[9px] font-black px-2 py-0.5 rounded-full hidden sm:inline-block",
                                              isEnabled ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-surface-muted text-content-muted"
                                            )}>
                                              {isEnabled ? t('settings_page.staff.permissions.enabled') : t('settings_page.staff.permissions.disabled')}
                                            </span>
                                            
                                            <button
                                              onClick={() => !isReadOnlyRole && handleTogglePermission(selectedRoleForPermissions.id, perm.id as PermissionKey)}
                                              disabled={isReadOnlyRole}
                                              className={cn(
                                                "w-11 h-6 rounded-full relative transition-all duration-300 shrink-0 cursor-pointer",
                                                isEnabled ? (isReadOnlyRole ? "bg-brand/50" : "bg-brand") : "bg-border/80 dark:bg-zinc-700",
                                                isReadOnlyRole && "opacity-50 cursor-not-allowed"
                                              )}
                                            >
                                              <div className={cn(
                                                "absolute top-1 w-4 h-4 bg-surface rounded-full shadow-sm transition-all duration-300",
                                                isEnabled ? "right-1" : "right-6"
                                              )} />
                                            </button>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
              {/* Staff List Sidebar */}
              <div className="lg:col-span-4 xl:col-span-3 space-y-4">
                <div className="bg-surface rounded-2xl sm:rounded-[2rem] border border-border shadow-sm overflow-hidden">
                  <div className="p-4 sm:p-5 bg-surface-muted border-b border-border">
                    <h4 className="text-xs font-black text-content-muted uppercase tracking-widest">{t('settings_page.staff.permissions.choose_employee')}</h4>
                  </div>
                  <div className="p-3 border-b border-border bg-surface-muted/20">
                    <div className="flex items-center gap-2 bg-surface border border-border focus-within:border-brand rounded-xl px-3 py-2 transition-all w-full">
                      <Search className="text-content-muted shrink-0" size={14} />
                      <input 
                        type="text" 
                        placeholder={t('settings_page.staff.permissions.search_employees')} 
                        value={sidebarSearchTerm} 
                        onChange={e => setSidebarSearchTerm(e.target.value)} 
                        className="w-full bg-transparent text-xs font-bold outline-none text-content border-none p-0 focus:ring-0" 
                      />
                    </div>
                  </div>
                  <div className="max-h-[500px] lg:max-h-[600px] overflow-y-auto divide-y divide-border/60">
                    {staff.filter(m => m.name.toLowerCase().includes(sidebarSearchTerm.toLowerCase()) || m.role.toLowerCase().includes(sidebarSearchTerm.toLowerCase())).map(member => (
                       <button
                         key={member.id}
                         onClick={() => setSelectedStaffForPermissions(member)}
                         className={cn(
                           "w-full p-3.5 sm:p-4 flex items-center gap-3 hover:bg-surface-muted/60 transition-all text-right relative cursor-pointer min-w-0",
                           selectedStaffForPermissions?.id === member.id ? "bg-brand/5 border-r-4 border-r-brand" : ""
                         )}
                       >
                         <div className={cn(
                           "w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center font-black shrink-0",
                           member.role === 'manager' || member.role === 'owner' ? "bg-brand/10 text-brand" : "bg-surface-muted text-content-muted"
                         )}>
                           {member.name.charAt(0)}
                         </div>
                         <div className="min-w-0 flex-1">
                           <p className="text-xs sm:text-sm font-bold text-content truncate">{member.name}</p>
                           <p className="text-[10px] text-content-muted font-bold uppercase truncate">
                             {roles.find(r => r.roleKey === member.role)?.name || member.role}
                           </p>
                         </div>
                         {Object.keys(overrides[member.id] || {}).length > 0 && (
                           <span className="bg-amber-500/10 text-amber-600 border border-amber-500/20 text-[9px] px-1.5 py-0.5 rounded-full font-black shrink-0">
                             {t('settings_page.staff.permissions.exceptions_count', { count: Object.keys(overrides[member.id] || {}).length })}
                           </span>
                         )}
                       </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Permission Matrix for Selected Staff */}
              <div className="lg:col-span-8 xl:col-span-9 space-y-6">
                {selectedStaffForPermissions ? (
                  <div className="space-y-6">
                    {/* Header Card for Selected Staff */}
                    <div className="bg-surface p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] border border-border shadow-sm space-y-4">
                      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                        <div className="flex items-center gap-3.5 min-w-0">
                          <div className="w-12 h-12 rounded-2xl bg-brand/10 text-brand font-black text-xl flex items-center justify-center border border-brand/20 shrink-0">
                            {selectedStaffForPermissions.name.charAt(0)}
                          </div>
                          <div className="min-w-0">
                            <h3 className="text-base sm:text-xl font-black text-content truncate">
                              {t('settings_page.staff.permissions.employee_permissions', { name: selectedStaffForPermissions.name })}
                            </h3>
                            <p className="text-xs text-content-muted font-bold mt-0.5">
                              {t('settings_page.staff.permissions.edit_exceptions_subtitle')}
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 w-full md:w-auto">
                          <button
                            onClick={() => handleResetOverrides(selectedStaffForPermissions.id)}
                            disabled={isSavingPermissions || !overrides[selectedStaffForPermissions.id] || Object.keys(overrides[selectedStaffForPermissions.id]).length === 0}
                            className="flex-1 sm:flex-initial px-4 py-2 bg-danger/10 hover:bg-danger/20 text-danger rounded-xl text-xs font-black transition-all border border-danger/20 flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                          >
                            <TrendingUp className="rotate-180 shrink-0" size={14} />
                            <span>{t('settings_page.staff.permissions.restore_defaults')}</span>
                          </button>
                          
                          <div className="flex items-center gap-2 bg-surface-muted border border-border focus-within:border-brand rounded-xl px-3 py-2 transition-all w-full sm:w-56 shrink-0">
                            <Search className="text-content-muted shrink-0" size={15} />
                            <input 
                              type="text"
                              placeholder={t('settings_page.staff.permissions.search')}
                              value={searchTerm}
                              onChange={(e) => setSearchTerm(e.target.value)}
                              className="w-full bg-transparent text-xs font-bold outline-none text-content border-none p-0 focus:ring-0"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Info & Primary Role pill */}
                      {(() => {
                        const staffRoleObj = roles.find(r => r.roleKey === selectedStaffForPermissions.role);
                        const staffOverrideCount = Object.keys(overrides[selectedStaffForPermissions.id] || {}).length;
                        return (
                          <div className="pt-3 border-t border-border/50 flex flex-wrap items-center gap-2 text-xs">
                            <button
                              onClick={() => {
                                setPermissionTabMode('roles');
                                if (staffRoleObj) setSelectedRoleForPermissions(staffRoleObj);
                                setSelectedStaffForPermissions(null);
                              }}
                              className="px-3 py-1 bg-brand/10 hover:bg-brand text-brand hover:text-white rounded-xl text-xs font-black flex items-center gap-1.5 transition-all border border-brand/20 cursor-pointer"
                              title={t('settings_page.staff.permissions.transition_to_role')}
                            >
                              <Shield size={14} />
                              <span>{t('settings_page.staff.permissions.primary_role', { role: staffRoleObj?.name || selectedStaffForPermissions.role })}</span>
                              <span className="text-[10px] underline">{t('settings_page.staff.permissions.edit_role_link')}</span>
                            </button>
                            {staffOverrideCount > 0 ? (
                              <span className="bg-amber-500/10 text-amber-600 border border-amber-500/20 px-3 py-1 rounded-xl text-xs font-black flex items-center gap-1">
                                <Zap size={12} />
                                <span>{t('settings_page.staff.permissions.exceptions_present', { count: staffOverrideCount })}</span>
                              </span>
                            ) : (
                              <span className="bg-surface-muted text-content-muted px-3 py-1 rounded-xl text-xs font-bold border border-border">
                                {t('settings_page.staff.permissions.follows_role')}
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </div>

                    {/* Staff Permissions Categories */}
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-6 items-start">
                      {categories.map(category => {
                        const isExpanded = expandedCategories.includes(category);
                        const categoryPerms = SYSTEM_PERMISSIONS.filter(p => {
                          const transName = getTransPermName(p.id, p.categoryKey, p.name);
                          const transDesc = getTransPermDesc(p.id, p.categoryKey, p.description);
                          return p.categoryKey === category && 
                            (transName.toLowerCase().includes(searchTerm.toLowerCase()) || transDesc.toLowerCase().includes(searchTerm.toLowerCase()));
                        });

                        if (categoryPerms.length === 0) return null;

                        return (
                          <div key={category} className="bg-surface rounded-2xl sm:rounded-[2rem] border border-border shadow-sm overflow-hidden flex flex-col">
                            <button 
                              onClick={() => toggleCategory(category)}
                              className="w-full p-4 sm:p-5 bg-surface-muted/30 border-b border-border flex items-center justify-between group transition-colors hover:bg-surface-muted/60"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className="w-2 h-5 bg-brand rounded-full shrink-0" />
                                <h4 className="text-xs sm:text-sm font-black text-brand uppercase tracking-wider truncate">{getTransCat(category)}</h4>
                              </div>
                              <div className={cn(
                                "p-1.5 rounded-lg bg-surface border border-border text-content-muted transition-all shrink-0",
                                isExpanded ? "rotate-180 text-brand border-brand/30" : ""
                              )}>
                                <ChevronDown size={15} />
                              </div>
                            </button>

                            <AnimatePresence>
                              {isExpanded && (
                                <motion.div 
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: 'auto', opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  transition={{ duration: 0.25, ease: "easeInOut" }}
                                  className="overflow-hidden"
                                >
                                  <div className="p-3.5 sm:p-4 space-y-3">
                                    {categoryPerms.map(perm => {
                                      const role = roles.find(r => r.roleKey === selectedStaffForPermissions.role);
                                      const baseValue = role?.permissions[perm.id as PermissionKey] ?? false;
                                      const overrideValue = overrides[selectedStaffForPermissions.id]?.[perm.id as PermissionKey];
                                      const effectiveValue = overrideValue !== undefined ? overrideValue : baseValue;
                                      const isOverridden = overrideValue !== undefined;
                                      const isOwner = selectedStaffForPermissions.role === 'owner';

                                      return (
                                        <div key={perm.id} className="flex items-start justify-between gap-3 p-3.5 sm:p-4 bg-surface-muted/30 hover:bg-surface-muted/70 rounded-2xl border border-border/60 transition-all">
                                          <div className="min-w-0 flex-1 space-y-0.5">
                                            <div className="flex items-center gap-2 flex-wrap">
                                              <span className="text-xs sm:text-sm font-bold text-content leading-tight">{getTransPermName(perm.id, perm.categoryKey, perm.name)}</span>
                                              <span className={cn(
                                                "text-[9px] font-black px-2 py-0.5 rounded-full uppercase",
                                                isOverridden ? "bg-amber-500/10 text-amber-600 border border-amber-500/20" : "bg-surface-muted text-content-muted border border-border/40"
                                              )}>
                                                {isOverridden ? t('settings_page.staff.permissions.custom_exception') : t('settings_page.staff.permissions.inherited')}
                                              </span>
                                            </div>
                                            <span className="text-[11px] text-content-muted font-medium leading-relaxed block">{getTransPermDesc(perm.id, perm.categoryKey, perm.description)}</span>
                                          </div>

                                          <div className="shrink-0 flex items-center gap-2 pt-0.5">
                                            {isOverridden && (
                                              <button 
                                                onClick={() => handleToggleStaffOverride(selectedStaffForPermissions.id, perm.id as PermissionKey)}
                                                className="text-[10px] text-danger hover:underline font-bold px-1 hidden sm:inline-block"
                                                title={t('settings_page.staff.permissions.cancel_exception_title')}
                                              >
                                                {t('settings_page.staff.permissions.cancel')}
                                              </button>
                                            )}

                                            <button
                                              onClick={() => !isOwner && handleToggleStaffOverride(selectedStaffForPermissions.id, perm.id as PermissionKey)}
                                              disabled={isOwner}
                                              className={cn(
                                                "w-11 h-6 rounded-full relative transition-all duration-300 shrink-0 cursor-pointer",
                                                effectiveValue ? "bg-emerald-500" : "bg-border/80 dark:bg-zinc-700",
                                                isOwner && "opacity-50 cursor-not-allowed"
                                              )}
                                            >
                                              <div className={cn(
                                                "absolute top-1 w-4 h-4 bg-surface rounded-full shadow-sm transition-all duration-300",
                                                effectiveValue ? "right-1" : "right-6"
                                              )} />
                                            </button>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="h-full min-h-[350px] bg-surface rounded-2xl sm:rounded-[2rem] border border-dashed border-border flex flex-col items-center justify-center text-center p-8">
                    <div className="w-16 h-16 bg-surface-muted rounded-full flex items-center justify-center text-content-muted mb-4">
                      <User size={32} />
                    </div>
                    <h3 className="text-base font-black text-content">{t('settings_page.staff.permissions.select_employee_start')}</h3>
                    <p className="text-xs text-content-muted font-bold mt-1 max-w-xs">
                      {t('settings_page.staff.permissions.select_employee_desc')}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="bg-brand/5 rounded-2xl sm:rounded-[2rem] p-4 sm:p-6 flex items-start gap-3 sm:gap-4 border border-brand/10">
            <div className="p-3 bg-surface rounded-2xl text-brand shadow-sm border border-border">
              <Info size={24} />
            </div>
            <div className="space-y-1">
              <h4 className="text-sm font-black text-content">{t('settings_page.staff.permissions.how_matrix_works')}</h4>
              <p className="text-xs text-content-muted font-medium leading-relaxed">
                {t('settings_page.staff.permissions.matrix_desc')}
                <br />
                <span className="font-black text-content">{t('settings_page.staff.permissions.owner_note')}</span>
              </p>
            </div>
          </div>

          {/* Create/Edit Role Modal */}
          <AnimatePresence>
            {(showCreateRole || editingRole) && (
              <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 sm:p-6">
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => {
                    setShowCreateRole(false);
                    setEditingRole(null);
                    setNewRoleName('');
                    setNewRoleDesc('');
                  }}
                  className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                />
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 20 }}
                  className="relative w-full max-w-md max-h-[90vh] overflow-y-auto bg-surface rounded-3xl shadow-2xl border border-border p-8"
                >
                  <div className="flex items-center justify-between mb-8">
                    <h3 className="text-xl font-black text-content">
                      {editingRole ? t('settings_page.staff.permissions.edit_role') : t('settings_page.staff.permissions.add_custom_role')}
                    </h3>
                    <button 
                      onClick={() => {
                        setShowCreateRole(false);
                        setEditingRole(null);
                        setNewRoleName('');
                        setNewRoleDesc('');
                      }}
                      className="p-2 hover:bg-surface-muted rounded-xl transition-all"
                    >
                      <X size={20} className="text-content-muted" />
                    </button>
                  </div>

                  <form onSubmit={editingRole ? handleUpdateRole : handleCreateRole} className="space-y-6">
                    <div className="space-y-2">
                      <label className="text-xs font-black text-content-muted uppercase tracking-widest mr-2">{t('settings_page.staff.permissions.role_name')}</label>
                      <input 
                        type="text"
                        value={newRoleName}
                        onChange={(e) => setNewRoleName(e.target.value)}
                        className="w-full bg-surface-muted border-2 border-transparent focus:border-brand rounded-2xl p-4 font-bold outline-none transition-all text-content"
                        placeholder={t('settings_page.staff.permissions.role_name_example')}
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-black text-content-muted uppercase tracking-widest mr-2">{t('settings_page.staff.permissions.role_desc')}</label>
                      <textarea 
                        value={newRoleDesc}
                        onChange={(e) => setNewRoleDesc(e.target.value)}
                        className="w-full bg-surface-muted border-2 border-transparent focus:border-brand rounded-2xl p-4 font-bold outline-none transition-all h-24 resize-none text-content"
                        placeholder={t('settings_page.staff.permissions.role_desc_placeholder')}
                      />
                    </div>

                    <button 
                      type="submit"
                      disabled={isSavingPermissions || !newRoleName}
                      className="w-full bg-brand text-white py-4 rounded-2xl font-black hover:bg-brand/90 shadow-xl shadow-brand/10 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {isSavingPermissions ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Plus size={20} />}
                      <span>{editingRole ? t('settings_page.staff.permissions.save_changes') : t('settings_page.staff.permissions.create_role')}</span>
                    </button>
                  </form>
                </motion.div>
              </div>
            )}

            {roleToDelete && (
              <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 sm:p-6">
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => !isSavingPermissions && setRoleToDelete(null)}
                  className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                />
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 20 }}
                  className="relative w-full max-w-sm max-h-[92dvh] overflow-y-auto bg-surface rounded-2xl sm:rounded-[2rem] shadow-2xl border border-border p-5 sm:p-8"
                >
                  <div className="w-20 h-20 bg-danger/10 rounded-full flex items-center justify-center mb-6 mx-auto">
                    <Trash2 size={32} className="text-danger" />
                  </div>
                  
                  <h3 className="text-xl font-black text-content text-center mb-2">{t('settings_page.staff.permissions.confirm_delete_title')}</h3>
                  <p className="text-sm font-bold text-content-muted text-center mb-8 leading-relaxed">
                    {t('settings_page.staff.permissions.confirm_delete_desc', { name: roleToDelete.name })}
                  </p>

                  <div className="flex gap-3">
                    <button
                      onClick={() => setRoleToDelete(null)}
                      disabled={isSavingPermissions}
                      className="flex-1 px-4 py-3 rounded-2xl font-black text-sm text-content-muted bg-surface-muted hover:bg-border transition-all disabled:opacity-50"
                    >
                      {t('settings_page.staff.permissions.cancel')}
                    </button>
                    <button
                      onClick={executeDeleteRole}
                      disabled={isSavingPermissions}
                      className="flex-1 px-4 py-3 rounded-2xl font-black text-sm text-white bg-danger hover:bg-danger/90 transition-all shadow-xl shadow-danger/20 disabled:opacity-50 flex items-center justify-center"
                    >
                      {isSavingPermissions ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : t('settings_page.staff.permissions.confirm_delete')}
                    </button>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Details Modal */}
      <AnimatePresence>
        {selectedStaffForDetails && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 sm:p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedStaffForDetails(null)}
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-surface rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden relative z-10 max-h-[90vh] flex flex-col border border-border"
            >
              <div className="p-6 border-b border-border flex justify-between items-center bg-surface-muted">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-surface shadow-sm flex items-center justify-center text-brand font-black text-xl">
                    {selectedStaffForDetails.name.charAt(0)}
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-content">{selectedStaffForDetails.name}</h2>
                    <p className="text-xs font-bold text-content-muted uppercase tracking-widest">
                      {roles.find(r => r.roleKey === selectedStaffForDetails.role)?.name || selectedStaffForDetails.role}
                    </p>
                  </div>
                </div>
                <button onClick={() => setSelectedStaffForDetails(null)} className="p-2 hover:bg-surface rounded-full transition-colors shadow-sm">
                  <X size={24} className="text-content-muted" />
                </button>
              </div>
              
              <div className="p-8 overflow-y-auto space-y-6">
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-surface-muted p-4 rounded-2xl text-center">
                    <p className="text-[10px] text-content-muted font-black uppercase mb-1">{t('staff.total_tasks')}</p>
                    <p className="text-2xl font-black text-content">{selectedStaffForDetails.performance?.totalHandled}</p>
                  </div>
                  <div className="bg-brand/10 p-4 rounded-2xl text-center">
                    <p className="text-[10px] text-brand font-black uppercase mb-1">{t('staff.in_progress')}</p>
                    <p className="text-2xl font-black text-brand">{selectedStaffForDetails.performance?.active}</p>
                  </div>
                  <div className="bg-success/5 p-4 rounded-2xl text-center">
                    <p className="text-[10px] text-success font-black uppercase mb-1">{t('staff.completed_tasks')}</p>
                    <p className="text-2xl font-black text-success">{selectedStaffForDetails.performance?.completed}</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="font-black text-content flex items-center gap-2">
                    <Clock size={18} className="text-brand" />
                    {t('staff.recent_handled_orders')}
                  </h3>
                  <div className="space-y-3">
                    {orders
                      .filter(order => order.history?.some(h => h.updatedBy === selectedStaffForDetails.name || h.updatedBy === selectedStaffForDetails.email))
                      .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
                      .slice(0, 10)
                      .map(order => (
                        <div key={order.id} className="flex items-center justify-between p-4 bg-surface-muted rounded-2xl border border-border">
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-xl bg-surface flex items-center justify-center text-content-muted">
                              <ShoppingBag size={20} />
                            </div>
                            <div>
                              <p className="font-bold text-content">{t('staff.order_number', { number: order.orderNumber })}</p>
                              <p className="text-[10px] text-content-muted font-bold">{new Date(order.updatedAt || '').toLocaleDateString('ar-SA-u-nu-latn')}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className={cn(
                              "text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-widest",
                              order.status === 'delivered' ? "bg-success/10 text-success" :
                              order.status === 'ready' ? "bg-info/10 text-info" : "bg-warning/10 text-warning"
                            )}>
                              {order.status}
                            </span>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AddEmployeeModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        tenantId={tenantId}
        roles={activeRoles}
        branches={branches}
        currentStaffName={currentStaff?.name}
        currentStaffEmail={currentStaff?.email}
        onSuccess={() => {
          setIsAddModalOpen(false);
        }}
      />

      {/* Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 sm:p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-surface rounded-3xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto relative z-10 border border-border"
            >
              <div className="p-6 border-b border-border flex justify-between items-center bg-surface-muted">
                <h2 className="text-xl font-black text-content">
                  {t('staff.edit_employee_title')}
                </h2>
                <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-surface rounded-full transition-colors shadow-sm">
                  <X size={24} className="text-content-muted" />
                </button>
              </div>
              <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="p-8 space-y-6">
                <div className="space-y-2">
                  <label className="text-xs font-black text-content-muted uppercase tracking-widest">{t('common.full_name')}</label>
                  <div className="relative">
                    <User className="absolute right-4 top-1/2 -translate-y-1/2 text-content-muted" size={20} />
                    <input 
                      {...register('name')}
                      className={cn(
                        "w-full bg-surface-muted border-2 border-transparent focus:border-brand rounded-2xl py-4 pl-4 pr-12 font-bold transition-all outline-none text-content",
                        errors.name && "border-red-500"
                      )}
                    />
                  </div>
                  {errors.name && <p className="text-xs text-red-500 font-bold">{errors.name.message}</p>}
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-content-muted uppercase tracking-widest">{t('staff.job_role')}</label>
                  <Controller
                    name="role"
                    control={control}
                    render={({ field }) => (
                      <SmartSelect 
                        {...field}
                        className="w-full"
                        options={activeRoles.map(role => ({ value: role.roleKey, label: role.name }))}
                      />
                    )}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-content-muted uppercase tracking-widest">{t('common.branch')}</label>
                  <Controller
                    name="branchId"
                    control={control}
                    render={({ field }) => (
                      <SmartSelect 
                        {...field}
                        className={cn("w-full", errors.branchId && "ring-2 ring-red-500")}
                        options={[
                          { value: '', label: t('staff.select_branch_placeholder') },
                          ...branches.map(branch => ({ value: branch.id, label: branch.name }))
                        ]}
                      />
                    )}
                  />
                  {errors.branchId && <p className="text-xs text-red-500 font-bold">{errors.branchId.message}</p>}
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-content-muted uppercase tracking-widest">{t('common.email')}</label>
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-content-muted" size={20} />
                    <input 
                      {...register('email')}
                      className={cn(
                        "w-full bg-surface-muted border-2 border-transparent focus:border-brand rounded-2xl py-4 pr-4 pl-12 font-bold transition-all outline-none text-content text-left",
                        errors.email && "border-red-500"
                      )}
                      dir="ltr"
                    />
                  </div>
                  {errors.email && <p className="text-xs text-red-500 font-bold">{errors.email.message}</p>}
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-content-muted uppercase tracking-widest">{t('onboarding.fields.phone')}</label>
                  <div className="relative">
                    <Smartphone className="absolute left-4 top-1/2 -translate-y-1/2 text-content-muted" size={20} />
                    <input 
                      {...register('phone')}
                      className={cn(
                        "w-full bg-surface-muted border-2 border-transparent focus:border-brand rounded-2xl py-4 pr-4 pl-12 font-bold transition-all outline-none text-content text-left",
                        errors.phone && "border-red-500"
                      )}
                      dir="ltr"
                    />
                  </div>
                  {errors.phone && <p className="text-xs text-red-500 font-bold">{errors.phone.message}</p>}
                </div>
                {/* Enable PIN Flag */}
                <div className="flex items-center gap-3 p-4 bg-brand/5 rounded-2xl border border-brand/10">
                  <input
                    type="checkbox"
                    id="enablePin"
                    {...register('enablePin')}
                    className="w-5 h-5 text-brand border-border rounded focus:ring-brand"
                  />
                  <div className="flex-1">
                    <label htmlFor="enablePin" className="font-bold text-content block cursor-pointer">
                      {t('staff.force_pin.enable_toggle')}
                    </label>
                    <p className="text-xs text-content-muted">{t('staff.pin_login_hint')}</p>
                  </div>
                </div>

                {enablePin && (
                  <div className="space-y-2">
                    <label className="text-xs font-black text-content-muted uppercase tracking-widest">{t('staff.pin_field_label')}</label>
                    <div className="relative">
                      <Shield className="absolute right-4 top-1/2 -translate-y-1/2 text-content-muted" size={20} />
                      <input 
                        {...register('pin')}
                        type="password"
                        maxLength={4}
                        placeholder="****"
                        className={cn(
                          "w-full bg-surface-muted border-2 border-transparent focus:border-brand rounded-2xl py-4 px-12 font-bold transition-all outline-none text-center tracking-[0.5em] text-content",
                          errors.pin && "border-red-500"
                        )}
                      />
                    </div>
                    {errors.pin && <p className="text-xs text-red-500 font-bold">{errors.pin.message}</p>}
                    <p className="text-xs text-brand font-bold mt-2">{t('staff.pin_leave_empty_hint')}</p>
                  </div>
                )}

                {/* isTest Flag */}
                <div className="flex items-center gap-3 p-4 bg-amber-500/10 rounded-2xl border border-amber-500/20">
                  <input
                    type="checkbox"
                    id="isTest"
                    {...register('isTest')}
                    className="w-5 h-5 text-brand border-border rounded focus:ring-brand"
                  />
                  <label htmlFor="isTest" className="text-sm font-bold text-amber-600 flex items-center gap-2">
                    <Zap size={16} />
                    {t('common.test_data')}
                  </label>
                </div>

                <button 
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-brand text-white py-4 rounded-2xl font-black hover:bg-brand/90 shadow-xl shadow-brand/10 transition-all hover:scale-105 active:scale-95 mt-4 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? t('common.saving') : t('procurement.save_changes')}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

const RolePermissionsModal = ({ role, onClose }: { role: Role; onClose: () => void }) => {
  const { t } = useTranslation();
  const transCat = (cat: string): string => t(`settings_page.staff.permissions.categories.${getCategoryKey(cat)}`, { defaultValue: cat });
  const transPermName = (permId: string, cat: string, defaultName: string): string => t(`settings_page.staff.permissions.items.${permId}.${getCategoryKey(cat)}.name`, { defaultValue: defaultName });
  const transPermDesc = (permId: string, cat: string, defaultDesc: string): string => t(`settings_page.staff.permissions.items.${permId}.${getCategoryKey(cat)}.description`, { defaultValue: defaultDesc });
  const categories = Array.from(new Set(SYSTEM_PERMISSIONS.map(p => p.categoryKey)));
  const [expandedCategories, setExpandedCategories] = useState<string[]>([]);

  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => 
      prev.includes(category) 
        ? prev.filter(c => c !== category)
        : [...prev, category]
    );
  };

  const toggleAll = () => {
    if (expandedCategories.length === categories.length) {
      setExpandedCategories([]);
    } else {
      setExpandedCategories(categories);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6">
      <motion.div 
        initial={{ opacity: 0 }} 
        animate={{ opacity: 1 }} 
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm" 
        onClick={onClose} 
      />
      <motion.div 
        initial={{ scale: 0.9, opacity: 0, y: 20 }} 
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        className="bg-surface w-full max-w-2xl rounded-3xl shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="p-8 border-b border-border flex justify-between items-center bg-surface-muted/50">
          <div className="flex items-center gap-4">
            <div className="p-4 bg-brand text-white rounded-2xl shadow-lg shadow-brand/10">
              <Shield size={24} />
            </div>
            <div>
              <h2 className="text-2xl font-black text-content">{t('settings_page.staff.permissions.role_permissions', { name: role.name })}</h2>
              <p className="text-xs text-content-muted font-bold uppercase tracking-widest">{t('staff.role_matrix_subtitle')}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={toggleAll}
              className="text-xs font-bold text-brand hover:text-brand/80 transition-colors"
            >
              {expandedCategories.length === categories.length ? t('settings_page.staff.permissions.collapse_all') : t('settings_page.staff.permissions.expand_all')}
            </button>
            <button onClick={onClose} className="p-2 hover:bg-surface rounded-full transition-colors shadow-sm bg-surface">
              <X size={24} className="text-content-muted" />
            </button>
          </div>
        </div>

        <div className="p-8 overflow-y-auto space-y-4">
          {categories.map(category => {
            const isExpanded = expandedCategories.includes(category);
            const categoryPerms = SYSTEM_PERMISSIONS.filter(p => p.categoryKey === category);
            
            return (
              <div key={category} className="bg-surface rounded-[2rem] border border-border overflow-hidden">
                <button 
                  onClick={() => toggleCategory(category)}
                  className="w-full p-4 bg-surface-muted/30 flex items-center justify-between group transition-colors hover:bg-surface-muted/50"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-1.5 h-5 bg-brand rounded-full" />
                    <h3 className="text-sm font-black text-brand uppercase tracking-widest">{transCat(category)}</h3>
                    <span className="bg-brand/10 text-brand text-[10px] px-2 py-0.5 rounded-full font-black">
                      {categoryPerms.length}
                    </span>
                  </div>
                  <div className={cn(
                    "p-1.5 rounded-lg bg-surface border border-border text-content-muted transition-all",
                    isExpanded ? "rotate-180 text-brand border-brand/20" : ""
                  )}>
                    <ChevronDown size={14} />
                  </div>
                </button>
                
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div 
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="p-4 border-t border-border">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {categoryPerms.map(perm => {
                            const isEnabled = role.permissions[perm.id as PermissionKey];
                            return (
                              <div key={perm.id} className="flex items-center justify-between p-4 bg-surface-muted rounded-2xl border border-border/50">
                                <div className="flex flex-col">
                                  <span className="text-sm font-bold text-content">{transPermName(perm.id, perm.categoryKey, perm.name)}</span>
                                  <span className="text-[10px] text-content-muted font-medium">{transPermDesc(perm.id, perm.categoryKey, perm.description)}</span>
                                </div>
                                {isEnabled ? (
                                  <div className="bg-emerald-500/10 text-emerald-600 p-1 rounded-full">
                                    <CheckCircle2 size={16} />
                                  </div>
                                ) : (
                                  <div className="bg-rose-500/10 text-rose-600 p-1 rounded-full">
                                    <XCircle size={16} />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>

        <div className="p-8 bg-surface-muted/50 border-t border-border">
          <button 
            onClick={onClose}
            className="w-full bg-brand text-white py-4 rounded-2xl font-black text-lg shadow-xl shadow-brand/10 hover:bg-brand/90 transition-all"
          >
            {t('common.close')}
          </button>
        </div>
      </motion.div>
    </div>
  );
};
