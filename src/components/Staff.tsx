import React, { useState, useEffect } from 'react';
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
  Settings
} from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { Order, Staff as StaffMemberType, AuditLog, Role, Branch, PermissionKey, PermissionsMap } from '../types';
import { Controller, useForm } from 'react-hook-form';
import { SmartSelect } from './ui/SmartSelect';
import { zodResolver } from '@hookform/resolvers/zod';
import { staffSchema } from '../lib/validations';
import { cn } from '../lib/utils';
import Branding from './Branding';
import { useStaff } from '../contexts/StaffContext';
import { usePermissions } from '../hooks/usePermissions';
import { generateSecurePin, hashPin, isPinUnique } from '../services/staffService';
import { updateRolePermissions, createCustomRole, DEFAULT_ROLES, updateUserOverrides, seedGlobalRoles, isMerchantRole } from '../services/permissionService';
import { SYSTEM_PERMISSIONS } from '../constants/permissions';
import EmployeeActivityLogTab from './EmployeeActivityLog';
import AddEmployeeModal from './AddEmployeeModal';
import AdminTailorCommissions from './AdminTailorCommissions';

interface StaffMember extends StaffMemberType {
  performance?: {
    totalHandled: number;
    completed: number;
    active: number;
  };
}

interface StaffProps {
  tenantId: string;
  initialViewMode?: 'list' | 'performance' | 'permissions' | 'employee_activity' | 'tailor_commissions';
}

export default function Staff({ tenantId, initialViewMode = 'list' }: StaffProps) {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [selectedStaffForDetails, setSelectedStaffForDetails] = useState<StaffMember | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'performance' | 'permissions' | 'employee_activity' | 'tailor_commissions'>(initialViewMode);
  const [permissionTabMode, setPermissionTabMode] = useState<'roles' | 'staff'>('roles');
  const [sidebarSearchTerm, setSidebarSearchTerm] = useState('');
  const [selectedRoleForPermissions, setSelectedRoleForPermissions] = useState<Role | null>(null);
  const [selectedStaffForPermissions, setSelectedStaffForPermissions] = useState<StaffMember | null>(null);
  const [overrides, setOverrides] = useState<Record<string, Partial<PermissionsMap>>>({});

  useEffect(() => {
    if (initialViewMode) {
      setViewMode(initialViewMode);
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
        setToast({ message: 'تم إضافة المهن الافتراضية بنجاح', type: 'success' });
        await fetchRoles();
      } else {
        setToast({ message: 'فشل في إضافة المهن، يرجى المحاولة مرة أخرى', type: 'error' });
      }
    } catch (error) {
      console.warn('Seeding error:', error);
      setToast({ message: 'حدث خطأ أثناء إضافة المهن', type: 'error' });
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

  useEffect(() => {
    // Expand all categories by default
    const cats = Array.from(new Set(SYSTEM_PERMISSIONS.map(p => p.category)));
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
        overridesData[item.user_id] = item.overrides;
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
          
          if (!uniquePin) throw new Error('تعذر إنشاء رمز دخول فريد، يرجى المحاولة مرة أخرى');
          
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

      if (editingStaff) {
        const updateData: any = {
          name: data.name,
          role: dbRoleValue,
          role_id: selectedRole?.id || null,
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
        setToast({ message: 'تم تحديث بيانات الموظف بنجاح', type: 'success' });
      } else {
        const { error } = await supabase.from('staff').insert({
          name: data.name,
          role: dbRoleValue,
          role_id: selectedRole?.id || null,
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

        setToast({ message: isAutoGenerated ? 'تم إضافة الموظف وإنشاء رمز سري عشوائي بنجاح' : 'تم إضافة الموظف بنجاح', type: 'success' });
      }
      setIsModalOpen(false);
      setEditingStaff(null);
      reset();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'staff');
      setToast({ message: 'حدث خطأ أثناء الحفظ', type: 'error' });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('هل أنت متأكد من حذف هذا الموظف؟')) return;
    try {
      const { error } = await supabase.from('staff').delete().eq('id', id);
      if (error) throw error;
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'staff');
    }
  };

  const toggleStatus = async (member: StaffMember) => {
    try {
      const { error } = await supabase.from('staff').update({
        status: member.status === 'active' ? 'inactive' : 'active',
        updated_at: new Date().toISOString()
      }).eq('id', member.id);
      if (error) throw error;
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'staff');
    }
  };

  const handleTogglePermission = async (roleId: string, key: PermissionKey) => {
    try {
      const role = roles.find(r => r.id === roleId);
      if (!role) return;

      const isDefaultRole = Boolean(!role.tenantId || role.tenantId === 'system' || DEFAULT_ROLES[role.roleKey] || role.isDefault);
      if (!isSuperAdmin && (role.roleKey === 'owner' || isDefaultRole)) {
        setToast({ message: 'المهن الافتراضية محمية بالنظام. للتعديل، يرجى إنشاء مهنة مخصصة جديدة.', type: 'error' });
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
      setToast({ message: 'تم تحديث الصلاحية بنجاح', type: 'success' });
    } catch (error) {
      setToast({ message: 'حدث خطأ أثناء تحديث الصلاحيات', type: 'error' });
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
      setToast({ message: 'تم تحديث استثناء الصلاحية بنجاح', type: 'success' });
    } catch (err) {
      setToast({ message: 'فشل تحديث استثناء الصلاحية', type: 'error' });
      await fetchOverrides();
    }
  };

  const handleResetOverrides = async (staffId: string) => {
    if (!window.confirm('هل أنت متأكد من استعادة الصلاحيات الافتراضية لهذا الموظف؟ سيتم حذف جميع الاستثناءات المخصصة.')) return;

    setIsSavingPermissions(true);
    try {
      await supabase.from('user_permission_overrides').delete().eq('user_id', staffId);
      setOverrides(prev => ({ ...prev, [staffId]: {} }));
      setToast({ message: 'تم استعادة الصلاحيات الافتراضية بنجاح', type: 'success' });
    } catch (err) {
      setToast({ message: 'فشل استعادة الصلاحيات', type: 'error' });
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
      setToast({ message: 'تم إنشاء المهنة المخصصة بنجاح', type: 'success' });
      setShowCreateRole(false);
      setNewRoleName('');
      setNewRoleDesc('');
      await fetchRoles();
    } catch (err) {
      setToast({ message: 'فشل إنشاء المهنة', type: 'error' });
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
      
      setToast({ message: 'تم تحديث المهنة بنجاح', type: 'success' });
      setEditingRole(null);
      setNewRoleName('');
      setNewRoleDesc('');
      await fetchRoles();
    } catch (err) {
      setToast({ message: 'فشل تحديث المهنة', type: 'error' });
    } finally {
      setIsSavingPermissions(false);
      setTimeout(() => setToast(null), 3000);
    }
  };

  const confirmDeleteRole = (role: Role) => {
    if (role.roleKey === 'owner' || role.roleKey === 'manager') {
      setToast({ message: 'لا يمكن حذف المهن الأساسية', type: 'error' });
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
      setToast({ message: 'تم حذف المهنة بنجاح', type: 'success' });
      await fetchRoles();
      setRoleToDelete(null);
    } catch (err: any) {
      console.warn("Error deleting role:", err);
      setToast({ message: err?.message || 'فشل حذف المهنة', type: 'error' });
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

  const filteredPermissions = SYSTEM_PERMISSIONS.filter(p => 
    p.name.includes(searchTerm) || p.category.includes(searchTerm)
  );

  const categories = Array.from(new Set(filteredPermissions.map(p => p.category)));

  return (
    <div className="p-4 sm:p-6 space-y-6 sm:space-y-8 text-right" dir="rtl">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 min-w-0">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-3xl font-black text-content flex items-center gap-2 sm:gap-3">
            <Shield className="text-brand shrink-0" size={24} />
            إدارة فريق العمل
          </h1>
          <p className="text-content-muted font-medium mt-1 text-sm sm:text-base">تتبع أداء الخياطين والموظفين</p>
        </div>
        {/* The view switcher holds up to 5 tabs; it scrolls horizontally on
            narrow screens instead of being clipped by the Settings shell. */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full md:w-auto min-w-0">
          <div className="bg-surface-muted p-1 rounded-2xl flex w-full md:w-auto overflow-x-auto scrollbar-hide">
            <button 
              onClick={() => setViewMode('list')}
              className={`px-3 sm:px-4 py-2 rounded-xl text-xs font-black transition-all shrink-0 whitespace-nowrap ${viewMode === 'list' ? 'bg-surface text-brand shadow-sm' : 'text-content-muted'}`}
            >
              القائمة
            </button>
            <button 
              onClick={() => setViewMode('performance')}
              className={`px-3 sm:px-4 py-2 rounded-xl text-xs font-black transition-all shrink-0 whitespace-nowrap ${viewMode === 'performance' ? 'bg-surface text-brand shadow-sm' : 'text-content-muted'}`}
            >
              الأداء
            </button>
            <button 
              onClick={() => setViewMode('permissions')}
              className={`px-3 sm:px-4 py-2 rounded-xl text-xs font-black transition-all shrink-0 whitespace-nowrap ${viewMode === 'permissions' ? 'bg-surface text-brand shadow-sm' : 'text-content-muted'}`}
            >
              الصلاحيات
            </button>
            {(hasPermission('reports.view') || currentStaff?.role === 'manager' || currentStaff?.role === 'owner') && (
              <button 
                onClick={() => setViewMode('employee_activity')}
                className={`px-3 sm:px-4 py-2 rounded-xl text-xs font-black transition-all shrink-0 whitespace-nowrap ${viewMode === 'employee_activity' ? 'bg-surface text-brand shadow-sm' : 'text-content-muted'}`}
              >
                نشاط الموظفين
              </button>
            )}
            {(hasPermission('staff.edit') || currentStaff?.role === 'manager' || currentStaff?.role === 'owner') && (
              <button 
                onClick={() => setViewMode('tailor_commissions')}
                className={`px-3 sm:px-4 py-2 rounded-xl text-xs font-black transition-all shrink-0 whitespace-nowrap ${viewMode === 'tailor_commissions' ? 'bg-surface text-brand shadow-sm' : 'text-content-muted'}`}
              >
                عمولات الخياطين
              </button>
            )}
          </div>
          {canCreate && viewMode !== 'permissions' && viewMode !== 'employee_activity' && viewMode !== 'tailor_commissions' && (
            <button 
              onClick={() => {
                setIsAddModalOpen(true);
              }}
              className="bg-brand text-white px-5 sm:px-6 py-3 rounded-2xl flex items-center justify-center gap-2 hover:bg-brand/90 transition-all shadow-lg shadow-brand/10 font-bold shrink-0 whitespace-nowrap w-full sm:w-auto"
            >
              <Plus size={20} />
              <span>إضافة موظف</span>
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
                  <span>{isSeeding ? 'جاري الإضافة...' : 'إضافة المهن الافتراضية'}</span>
                </button>
              )}
              <button 
                onClick={() => setShowCreateRole(true)}
                className="bg-brand text-white px-6 py-3 rounded-2xl flex items-center gap-2 hover:bg-brand/90 transition-all shadow-lg shadow-brand/10 font-bold"
              >
                <Plus size={20} />
                <span>إضافة مهنة مخصصة</span>
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
              "fixed top-6 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 rounded-2xl shadow-2xl font-bold text-sm flex items-center gap-2 border",
              toast.type === 'success' ? "bg-success/5 text-success border-success/10" : "bg-danger/5 text-danger border-danger/10"
            )}
          >
            {toast.type === 'success' ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>

      {viewMode !== 'permissions' && viewMode !== 'employee_activity' && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="relative">
            <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-content-muted" size={20} />
            <input 
              type="text"
              placeholder="بحث في الموظفين..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-surface-muted border-2 border-transparent focus:border-brand rounded-2xl py-3 pr-12 pl-4 font-bold transition-all outline-none"
            />
          </div>
          
          <SmartSelect 
            value={roleFilter}
            onChange={(val) => setRoleFilter(val)}
            className="w-full md:w-auto"
            options={[
              { value: 'all', label: 'جميع الأدوار' },
              ...roles.map(role => ({ value: role.roleKey, label: role.name }))
            ]}
          />

          <SmartSelect 
            value={branchFilter}
            onChange={(val) => setBranchFilter(val)}
            className="w-full md:w-auto"
            options={[
              { value: 'all', label: 'جميع الفروع' },
              ...branches.map(branch => ({ value: branch.id, label: branch.name }))
            ]}
          />

          <SmartSelect 
            value={statusFilter}
            onChange={(val) => setStatusFilter(val)}
            className="w-full md:w-auto"
            options={[
              { value: 'all', label: 'جميع الحالات' },
              { value: 'active', label: 'نشط' },
              { value: 'inactive', label: 'غير نشط' }
            ]}
          />
        </div>
      )}

      {viewMode === 'employee_activity' && (
        <EmployeeActivityLogTab tenantId={tenantId} />
      )}

      {viewMode === 'tailor_commissions' && (
        <AdminTailorCommissions tenantId={tenantId} />
      )}

      {viewMode === 'list' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredStaff.map((member) => (
            <motion.div 
              key={member.id}
              layout
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-surface p-6 rounded-3xl border border-border shadow-sm hover:shadow-xl transition-all group relative overflow-hidden space-y-6"
            >
              <div className={`absolute top-0 right-0 w-2 h-full ${
                member.status === 'active' ? 'bg-success' : 'bg-surface-muted'
              }`} />
              
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-4">
                  <div className={`p-4 rounded-2xl transition-transform group-hover:scale-110 ${
                    member.role === 'manager' || member.role === 'owner' ? 'bg-brand/10 text-brand' :
                    member.role === 'cashier' ? 'bg-info/10 text-info' : 'bg-warning/10 text-warning'
                  }`}>
                    {member.role === 'manager' || member.role === 'owner' ? <Shield size={28} /> : <User size={28} />}
                  </div>
                  <div>
                    <h3 className="font-black text-lg text-content flex items-center gap-2">
                      {member.name}
                      {member.isTest && (
                        <span className="text-[10px] bg-danger/10 text-danger px-2 py-0.5 rounded-full font-black uppercase tracking-widest flex items-center gap-1">
                          <Zap size={10} />
                          تجريبي
                        </span>
                      )}
                    </h3>
                    <span className="text-[10px] font-black text-content-muted uppercase tracking-widest bg-surface-muted px-2 py-0.5 rounded-full flex items-center gap-2">
                      {roles.find(r => r.roleKey === member.role)?.name || member.role}
                      <button 
                        onClick={() => setShowPermissionsModal(roles.find(r => r.roleKey === member.role) || null)}
                        className="p-1 hover:bg-brand/10 rounded text-brand transition-colors"
                        title="عرض الصلاحيات"
                      >
                        <Shield size={10} />
                      </button>
                    </span>
                  </div>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {canEdit && (
                    <div className="flex gap-1">
                      <button 
                        onClick={() => {
                          setEditingStaff(member);
                          setIsModalOpen(true);
                        }}
                        className="p-2 text-content-muted hover:text-brand hover:bg-brand/10 rounded-xl transition-colors"
                        title="تعديل البيانات"
                      >
                        <Edit2 size={18} />
                      </button>
                      <button 
                        onClick={() => {
                          setSelectedStaffForPermissions(member);
                          setViewMode('permissions');
                          setPermissionTabMode('staff');
                        }}
                        className="p-2 text-content-muted hover:text-brand hover:bg-brand/10 rounded-xl transition-colors"
                        title="إدارة الصلاحيات الخاصة"
                      >
                        <Settings size={18} />
                      </button>
                    </div>
                  )}
                  {canDelete && (
                    <button 
                      onClick={() => handleDelete(member.id)}
                      className="p-2 text-content-muted hover:text-danger hover:bg-danger/10 rounded-xl transition-colors"
                    >
                      <Trash2 size={18} />
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-3 text-sm text-content-muted font-medium">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-surface-muted rounded-lg"><Mail size={14} className="text-content-muted" /></div>
                  <span>{member.email}</span>
                </div>
                {member.phone && (
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-surface-muted rounded-lg"><Smartphone size={14} className="text-content-muted" /></div>
                    <span>{member.phone}</span>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-surface-muted rounded-lg"><Building2 size={14} className="text-content-muted" /></div>
                  <span className="font-bold text-brand">
                    {branches.find(b => b.id === member.branchId)?.name || 'غير محدد'}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-surface-muted rounded-lg"><Shield size={14} className="text-content-muted" /></div>
                  <span className="font-mono tracking-widest text-brand font-black">****</span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-4 border-t border-border">
                <div className="text-center p-2 bg-surface-muted rounded-2xl">
                  <p className="text-[10px] text-content-muted font-bold uppercase">الطلبات</p>
                  <p className="text-lg font-black text-content">{member.performance?.totalHandled || 0}</p>
                </div>
                <div className="text-center p-2 bg-brand/5 rounded-2xl">
                  <p className="text-[10px] text-brand font-bold uppercase">نشط</p>
                  <p className="text-lg font-black text-brand">{member.performance?.active || 0}</p>
                </div>
                <div className="text-center p-2 bg-success/5 rounded-2xl">
                  <p className="text-[10px] text-success font-bold uppercase">منجز</p>
                  <p className="text-lg font-black text-success">{member.performance?.completed || 0}</p>
                </div>
              </div>

              {member.performance?.totalHandled ? (
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] font-black">
                    <span className="text-content-muted uppercase">معدل الإنجاز</span>
                    <span className="text-brand">
                      {Math.round((member.performance.completed / member.performance.totalHandled) * 100)}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-surface-muted rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${(member.performance.completed / member.performance.totalHandled) * 100}%` }}
                      className="h-full bg-brand"
                    />
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap justify-between items-center gap-2 pt-4">
                <div className="flex items-center gap-2">
                  {member.status === 'active' ? (
                    <CheckCircle size={16} className="text-success" />
                  ) : (
                    <XCircle size={16} className="text-content-muted" />
                  )}
                  <span className={`text-xs font-black ${
                    member.status === 'active' ? 'text-success' : 'text-content-muted'
                  }`}>
                    {member.status === 'active' ? 'نشط' : 'غير نشط'}
                  </span>
                </div>
                <button 
                  onClick={() => toggleStatus(member)}
                  className={`text-[10px] font-black px-4 py-2 rounded-xl transition-all ${
                    member.status === 'active' 
                    ? 'text-danger bg-danger/10 hover:bg-danger/20' 
                    : 'text-success bg-success/10 hover:bg-success/20'
                  }`}
                >
                  {member.status === 'active' ? 'تعطيل' : 'تفعيل'}
                </button>
                <div className="flex items-center gap-1.5">
                  <button 
                    onClick={() => {
                      setViewMode('permissions');
                      setPermissionTabMode('staff');
                      setSelectedStaffForPermissions(member);
                    }}
                    className="text-[10px] font-black px-3 py-2 rounded-xl bg-brand/10 text-brand hover:bg-brand hover:text-white transition-all flex items-center gap-1"
                    title="إدارة صلاحيات الموظف"
                  >
                    <Shield size={12} />
                    <span>الصلاحيات</span>
                  </button>
                  <button 
                    onClick={() => setSelectedStaffForDetails(member)}
                    className="text-[10px] font-black px-3 py-2 rounded-xl bg-surface-muted text-content hover:bg-surface-muted/80 transition-all"
                  >
                    التفاصيل
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {viewMode === 'performance' && (
        <div className="bg-surface rounded-2xl sm:rounded-[2.5rem] border border-border overflow-x-auto whitespace-nowrap shadow-sm">
          <table className="w-full text-right min-w-max">
            <thead>
              <tr className="bg-surface-muted border-b border-border">
                <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-widest">الموظف</th>
                <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-widest">الدور</th>
                <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-widest">إجمالي المهام</th>
                <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-widest">قيد العمل</th>
                <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-widest">المنجزة</th>
                <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-widest">معدل الإنجاز</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {staffWithPerformance.map((member) => {
                const rate = member.performance?.totalHandled 
                  ? Math.round((member.performance.completed / member.performance.totalHandled) * 100) 
                  : 0;
                return (
                  <tr key={member.id} className="hover:bg-surface-muted/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-brand/10 flex items-center justify-center text-brand font-black">
                          {member.name.charAt(0)}
                        </div>
                        <span className="font-bold text-content">{member.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-xs font-bold text-content-muted">
                        {roles.find(r => r.roleKey === member.role)?.name || member.role}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-black text-content">{member.performance?.totalHandled}</td>
                    <td className="px-6 py-4 font-black text-brand">{member.performance?.active}</td>
                    <td className="px-6 py-4 font-black text-success">{member.performance?.completed}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-surface-muted rounded-full overflow-hidden">
                          <div className="h-full bg-brand" style={{ width: `${rate}%` }} />
                        </div>
                        <span className="text-xs font-black text-brand">{rate}%</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => setSelectedStaffForDetails(member)}
                          className="p-2 text-brand hover:bg-brand/10 rounded-xl transition-all"
                          title="الأداء"
                        >
                          <TrendingUp size={18} />
                        </button>
                        <button 
                          onClick={() => {
                            setSelectedStaffForPermissions(member);
                            setViewMode('permissions');
                            setPermissionTabMode('staff');
                          }}
                          className="p-2 text-brand hover:bg-brand/10 rounded-xl transition-all"
                          title="الصلاحيات"
                        >
                          <Settings size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {viewMode === 'permissions' && (
        <div className="space-y-8">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="bg-surface-muted p-1 rounded-2xl flex">
              <button 
                onClick={() => {
                  setPermissionTabMode('roles');
                  setSelectedStaffForPermissions(null);
                }}
                className={`px-6 py-2 rounded-xl text-xs font-black transition-all ${permissionTabMode === 'roles' ? 'bg-surface text-brand shadow-sm' : 'text-content-muted'}`}
              >
                حسب الدور الوظيفي
              </button>
              <button 
                onClick={() => setPermissionTabMode('staff')}
                className={`px-6 py-2 rounded-xl text-xs font-black transition-all ${permissionTabMode === 'staff' ? 'bg-surface text-brand shadow-sm' : 'text-content-muted'}`}
              >
                حسب الموظف
              </button>
            </div>

            {permissionTabMode === 'roles' && (
              <div className="flex items-center gap-2">
                <button 
                  onClick={toggleAllCategories}
                  className="px-4 py-2 rounded-xl text-[10px] font-black bg-surface border border-border text-content-muted hover:bg-surface-muted transition-all"
                >
                  {expandedCategories.length === categories.length ? 'طي الكل' : 'توسيع الكل'}
                </button>
                <button 
                  onClick={() => setShowCreateRole(true)}
                  className="px-4 py-2 rounded-xl text-[10px] font-black bg-brand text-white hover:bg-brand/90 shadow-lg shadow-brand/10 transition-all flex items-center gap-2"
                >
                  <Plus size={14} />
                  إضافة مهنة مخصصة
                </button>
              </div>
            )}
          </div>

          {permissionTabMode === 'roles' ? (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              {/* Roles Sidebar */}
              <div className="lg:col-span-3 space-y-4">
                <div className="bg-surface rounded-2xl sm:rounded-[2.5rem] border border-border shadow-sm overflow-hidden">
                  <div className="p-6 bg-surface-muted/50 border-b border-border flex justify-between items-center">
                    <h4 className="text-xs font-black text-content-muted uppercase tracking-widest">الأدوار الوظيفية</h4>
                    <button 
                      onClick={() => setShowCreateRole(true)}
                      className="p-2 bg-brand text-white rounded-xl hover:bg-brand/90 transition-all shadow-lg shadow-brand/10"
                      title="إضافة مهنة مخصصة"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                  <div className="p-3 border-b border-border bg-surface-muted/20">
                    <div className="relative">
                      <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-content-muted" size={14} />
                      <input 
                        type="text" 
                        placeholder="بحث في المهن..." 
                        value={sidebarSearchTerm} 
                        onChange={e => setSidebarSearchTerm(e.target.value)} 
                        className="w-full bg-surface border border-border rounded-xl py-2 pr-9 pl-3 text-xs font-bold outline-none text-content focus:border-brand" 
                      />
                    </div>
                  </div>
                  <div className="max-h-[600px] overflow-y-auto">
                    {activeRoles.filter(r => r.name.toLowerCase().includes(sidebarSearchTerm.toLowerCase())).map(role => (
                      <div
                        key={role.id}
                        onClick={() => setSelectedRoleForPermissions(role)}
                        className={cn(
                          "w-full p-5 flex items-center justify-between hover:bg-surface-muted transition-all text-right border-b border-border last:border-0 relative group cursor-pointer",
                          selectedRoleForPermissions?.id === role.id ? "bg-brand/5 border-r-4 border-r-brand" : ""
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "w-10 h-10 rounded-xl flex items-center justify-center",
                            role.roleKey === 'owner' ? "bg-warning/10 text-warning" : 
                            role.roleKey === 'manager' ? "bg-success/10 text-success" :
                            "bg-info/10 text-info"
                          )}>
                            <Shield size={18} />
                          </div>
                          <div>
                            <p className="text-sm font-black text-content">{role.name}</p>
                            {(!role.tenantId || role.tenantId === 'system') && (
                              <span className="text-[8px] font-black text-content-muted uppercase tracking-tighter">قالب نظام</span>
                            )}
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {role.roleKey !== 'owner' && (
                            <>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingRole(role);
                                  setNewRoleName(role.name);
                                  setNewRoleDesc(role.description || '');
                                }}
                                className="p-1.5 text-content-muted hover:text-brand"
                              >
                                <Edit2 size={14} />
                              </button>
                              {role.roleKey !== 'manager' && role.tenantId && role.tenantId !== 'system' && (
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    confirmDeleteRole(role);
                                  }}
                                  className="p-1.5 text-content-muted hover:text-danger"
                                >
                                  <Trash2 size={14} />
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
              <div className="lg:col-span-9 space-y-8">
                {selectedRoleForPermissions && (
                  <>
                    <div className="bg-surface p-4 sm:p-8 rounded-2xl sm:rounded-[2.5rem] border border-border shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4 sm:gap-6">
                      <div className="flex items-start sm:items-center gap-3 sm:gap-4 min-w-0">
                        <div className={cn(
                          "p-3 sm:p-4 rounded-2xl shadow-lg shrink-0",
                          selectedRoleForPermissions.roleKey === 'owner' ? "bg-warning text-white shadow-warning/20" :
                          selectedRoleForPermissions.roleKey === 'manager' ? "bg-success text-white shadow-success/20" :
                          "bg-brand text-white shadow-brand/20"
                        )}>
                          <Shield size={24} />
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-lg sm:text-2xl font-black text-content">صلاحيات {selectedRoleForPermissions.name}</h3>
                          <p className="text-xs sm:text-sm text-content-muted font-bold mt-1">{selectedRoleForPermissions.description}</p>
                          {(() => {
                            const roleStaffMembers = staff.filter(s => s.role === selectedRoleForPermissions.roleKey);
                            return roleStaffMembers.length > 0 ? (
                              <div className="flex items-center gap-2 flex-wrap pt-2.5 mt-2 border-t border-border/50">
                                <span className="text-xs font-black text-content-muted">الموظفون في هذا الدور ({roleStaffMembers.length}):</span>
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
                                      title="عرض وتعديل استثناءات صلاحيات هذا الموظف"
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
                      </div>
                      
                      <div className="flex flex-col md:flex-row items-center gap-4 w-full md:w-auto">
                        <button
                          onClick={toggleAllCategories}
                          className="w-full md:w-auto px-6 py-3 bg-surface-muted hover:bg-border rounded-2xl text-xs font-black text-content-muted transition-all border border-border"
                        >
                          {expandedCategories.length === categories.length ? 'طي الكل' : 'توسيع الكل'}
                        </button>
                        <div className="relative w-full md:w-64">
                          <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-content-muted" size={18} />
                          <input 
                            type="text"
                            placeholder="بحث في الصلاحيات..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full bg-surface-muted border border-border rounded-2xl py-3 pr-12 pl-4 text-sm font-bold focus:border-brand outline-none transition-all text-content"
                          />
                        </div>
                      </div>
                    </div>

                    {!isSuperAdmin && (!selectedRoleForPermissions.tenantId || selectedRoleForPermissions.tenantId === 'system' || DEFAULT_ROLES[selectedRoleForPermissions.roleKey] || selectedRoleForPermissions.isDefault) && (
                      <div className="p-5 bg-amber-500/10 rounded-2xl border border-amber-500/30 text-right flex items-center justify-between flex-wrap gap-3 shadow-sm">
                        <div className="flex items-center gap-2.5 text-amber-700 dark:text-amber-400 font-black text-xs">
                          <Lock size={18} />
                          <span>مهنة افتراضية محمية. تعديل المهن الافتراضية متاح فقط من السوبر أدمن.</span>
                        </div>
                        <button
                          onClick={() => {
                            setNewRoleName(`${selectedRoleForPermissions.name} مخصص`);
                            setNewRoleDesc(`نسخة مخصصة من ${selectedRoleForPermissions.name}`);
                            setShowCreateRole(true);
                          }}
                          className="px-4 py-2 bg-brand text-white font-black text-xs rounded-xl shadow-sm hover:bg-brand/90 transition-all flex items-center gap-1.5 cursor-pointer"
                        >
                          <Plus size={14} />
                          <span>إنشاء مهنة مخصصة</span>
                        </button>
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {categories.map(category => {
                        const categoryPerms = SYSTEM_PERMISSIONS.filter(p => 
                          p.category === category && 
                          (p.name.toLowerCase().includes(searchTerm.toLowerCase()) || p.description.toLowerCase().includes(searchTerm.toLowerCase()))
                        );
                        
                        if (categoryPerms.length === 0) return null;
                        const isExpanded = expandedCategories.includes(category);

                        return (
                          <div key={category} className="bg-surface rounded-2xl sm:rounded-[2.5rem] border border-border shadow-sm overflow-hidden flex flex-col h-fit">
                            <button 
                              onClick={() => toggleCategory(category)}
                              className="w-full p-6 bg-surface-muted/30 border-b border-border flex items-center justify-between group transition-colors hover:bg-surface-muted/50"
                            >
                              <div className="flex items-center gap-3">
                                <div className="w-2 h-6 bg-brand rounded-full" />
                                <h4 className="text-sm font-black text-brand uppercase tracking-widest">{category}</h4>
                                <span className="bg-brand/10 text-brand text-[10px] px-2 py-0.5 rounded-full font-black">
                                  {categoryPerms.length}
                                </span>
                              </div>
                              <div className={cn(
                                "p-2 rounded-xl bg-surface border border-border text-content-muted transition-all",
                                isExpanded ? "rotate-180 text-brand border-brand/20" : ""
                              )}>
                                <ChevronDown size={16} />
                              </div>
                            </button>
                            
                            <AnimatePresence>
                              {isExpanded && (
                                <motion.div 
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: 'auto', opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  transition={{ duration: 0.3, ease: "easeInOut" }}
                                  className="overflow-hidden"
                                >
                                  <div className="p-6 space-y-4">
                                    {categoryPerms.map(perm => {
                                      const isEnabled = selectedRoleForPermissions.permissions[perm.id as PermissionKey];
                                      const isDefaultRole = Boolean(!selectedRoleForPermissions.tenantId || selectedRoleForPermissions.tenantId === 'system' || DEFAULT_ROLES[selectedRoleForPermissions.roleKey] || selectedRoleForPermissions.isDefault);
                                      const isReadOnlyRole = selectedRoleForPermissions.roleKey === 'owner' || (!isSuperAdmin && isDefaultRole);
                                      
                                      return (
                                        <div key={perm.id} className={cn("flex items-center justify-between p-4 bg-surface-muted/50 rounded-2xl border border-border/50 transition-all group", isReadOnlyRole ? "opacity-70 cursor-not-allowed" : "hover:border-brand/30")}>
                                          <div className="flex flex-col gap-1">
                                            <span className="text-sm font-bold text-content group-hover:text-brand transition-colors">{perm.name}</span>
                                            <span className="text-[10px] text-content-muted font-medium leading-relaxed">{perm.description}</span>
                                          </div>
                                          <button
                                            onClick={() => !isReadOnlyRole && handleTogglePermission(selectedRoleForPermissions.id, perm.id as PermissionKey)}
                                            disabled={isReadOnlyRole}
                                            className={cn(
                                              "w-12 h-6 rounded-full relative transition-all duration-300",
                                              isEnabled ? (isReadOnlyRole ? "bg-brand/50" : "bg-brand") : "bg-border",
                                              isReadOnlyRole && "opacity-50 cursor-not-allowed"
                                            )}
                                          >
                                            <div className={cn(
                                              "absolute top-1 w-4 h-4 bg-surface rounded-full shadow-sm transition-all duration-300",
                                              isEnabled ? "right-1" : "right-7"
                                            )} />
                                          </button>
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
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
              {/* Staff List Sidebar */}
              <div className="lg:col-span-1 space-y-4">
                <div className="bg-surface rounded-2xl sm:rounded-[2rem] border border-border shadow-sm overflow-hidden">
                  <div className="p-4 bg-surface-muted border-b border-border">
                    <h4 className="text-xs font-black text-content-muted uppercase tracking-widest">اختر الموظف</h4>
                  </div>
                  <div className="p-3 border-b border-border bg-surface-muted/20">
                    <div className="relative">
                      <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-content-muted" size={14} />
                      <input 
                        type="text" 
                        placeholder="بحث في الموظفين..." 
                        value={sidebarSearchTerm} 
                        onChange={e => setSidebarSearchTerm(e.target.value)} 
                        className="w-full bg-surface border border-border rounded-xl py-2 pr-9 pl-3 text-xs font-bold outline-none text-content focus:border-brand" 
                      />
                    </div>
                  </div>
                  <div className="max-h-[600px] overflow-y-auto">
                    {staff.filter(m => m.name.toLowerCase().includes(sidebarSearchTerm.toLowerCase()) || m.role.toLowerCase().includes(sidebarSearchTerm.toLowerCase())).map(member => (
                      <button
                        key={member.id}
                        onClick={() => setSelectedStaffForPermissions(member)}
                        className={cn(
                          "w-full p-4 flex items-center gap-3 hover:bg-surface-muted transition-all text-right border-b border-border last:border-0",
                          selectedStaffForPermissions?.id === member.id ? "bg-brand/5 border-r-4 border-r-brand" : ""
                        )}
                      >
                        <div className={cn(
                          "w-10 h-10 rounded-xl flex items-center justify-center font-black",
                          member.role === 'manager' || member.role === 'owner' ? "bg-brand/10 text-brand" : "bg-surface-muted text-content-muted"
                        )}>
                          {member.name.charAt(0)}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-content">{member.name}</p>
                          <p className="text-[10px] text-content-muted font-bold uppercase">
                            {roles.find(r => r.roleKey === member.role)?.name || member.role}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Permission Matrix for Selected Staff */}
              <div className="lg:col-span-3">
                {selectedStaffForPermissions ? (
                  <div className="bg-surface rounded-2xl sm:rounded-[2.5rem] border border-border shadow-sm overflow-hidden">
                    <div className="p-4 sm:p-8 border-b border-border flex flex-col md:flex-row justify-between items-start md:items-center bg-surface-muted/50 gap-4 sm:gap-6">
                      <div className="flex items-start sm:items-center gap-3 sm:gap-4 min-w-0">
                        <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-2xl bg-surface shadow-sm flex items-center justify-center text-brand font-black text-xl sm:text-2xl border border-border shrink-0">
                          {selectedStaffForPermissions.name.charAt(0)}
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-base sm:text-xl font-black text-content">صلاحيات {selectedStaffForPermissions.name}</h3>
                          <p className="text-xs text-content-muted font-bold mt-1">
                            تعديل استثناءات الصلاحيات لهذا الموظف بشكل خاص
                          </p>
                          {(() => {
                            const staffRoleObj = roles.find(r => r.roleKey === selectedStaffForPermissions.role);
                            const staffOverrideCount = Object.keys(overrides[selectedStaffForPermissions.id] || {}).length;
                            return (
                              <div className="flex items-center gap-2 flex-wrap mt-2">
                                <button
                                  onClick={() => {
                                    setPermissionTabMode('roles');
                                    if (staffRoleObj) setSelectedRoleForPermissions(staffRoleObj);
                                    setSelectedStaffForPermissions(null);
                                  }}
                                  className="px-3 py-1 bg-brand/10 hover:bg-brand text-brand hover:text-white rounded-xl text-xs font-black flex items-center gap-1.5 transition-all border border-brand/20 cursor-pointer"
                                  title="الانتقال لتعديل صلاحيات هذا الدور الوظيفي"
                                >
                                  <Shield size={14} />
                                  <span>الدور الأساسي: {staffRoleObj?.name || selectedStaffForPermissions.role}</span>
                                  <span className="text-[10px] underline">(تعديل صلاحيات الدور)</span>
                                </button>
                                {staffOverrideCount > 0 ? (
                                  <span className="bg-amber-500/10 text-amber-600 border border-amber-500/20 px-3 py-1 rounded-xl text-xs font-black flex items-center gap-1">
                                    <Zap size={12} />
                                    <span>يوجد {staffOverrideCount} استثناء مخصص</span>
                                  </span>
                                ) : (
                                  <span className="bg-surface-muted text-content-muted px-3 py-1 rounded-xl text-xs font-bold border border-border">
                                    يتبع صلاحيات الدور تماماً
                                  </span>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                      
                      <div className="flex flex-col md:flex-row items-center gap-4 w-full md:w-auto">
                        <button
                          onClick={() => handleResetOverrides(selectedStaffForPermissions.id)}
                          disabled={isSavingPermissions || !overrides[selectedStaffForPermissions.id] || Object.keys(overrides[selectedStaffForPermissions.id]).length === 0}
                          className="w-full md:w-auto px-6 py-3 bg-danger/10 hover:bg-danger/20 text-danger rounded-2xl text-xs font-black transition-all border border-danger/20 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <TrendingUp className="rotate-180 shrink-0" size={16} />
                          استعادة الافتراضي
                        </button>
                        <button
                          onClick={toggleAllCategories}
                          className="w-full md:w-auto px-6 py-3 bg-surface hover:bg-border rounded-2xl text-xs font-black text-content-muted transition-all border border-border"
                        >
                          {expandedCategories.length === categories.length ? 'طي الكل' : 'توسيع الكل'}
                        </button>
                        <div className="relative w-full md:w-64">
                          <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-content-muted" size={18} />
                          <input 
                            type="text"
                            placeholder="بحث..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full bg-surface border border-border rounded-2xl py-2.5 pr-10 pl-4 text-xs font-bold outline-none text-content focus:border-brand"
                          />
                        </div>
                      </div>
                    </div>

                    {/*
                      No `whitespace-nowrap` here: it was inherited by every cell,
                      and the permission descriptions are full Arabic sentences —
                      so the table stretched past 900px and one row took several
                      screens of horizontal scrolling to read. A fixed min-width
                      keeps the columns readable and lets long text wrap.
                    */}
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse min-w-[560px]">
                        <thead>
                          <tr className="bg-surface-muted/30">
                            <th className="p-3 sm:p-6 text-right border-b border-border">
                              <span className="text-xs font-black text-content-muted uppercase tracking-widest">الصلاحية</span>
                            </th>
                            <th className="p-3 sm:p-6 text-center border-b border-border w-24 sm:w-32">
                              <span className="text-xs font-black text-content-muted uppercase tracking-widest">الحالة</span>
                            </th>
                            <th className="p-3 sm:p-6 text-center border-b border-border w-32 sm:w-48">
                              <span className="text-xs font-black text-content-muted uppercase tracking-widest">المصدر</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {categories.map(category => {
                            const isExpanded = expandedCategories.includes(category);
                            return (
                              <React.Fragment key={category}>
                                <tr 
                                  className="bg-surface-muted/50 cursor-pointer hover:bg-surface-muted transition-colors"
                                  onClick={() => toggleCategory(category)}
                                >
                                  <td colSpan={3} className="p-3 pr-4 sm:p-4 sm:pr-8 border-y border-border">
                                    <div className="flex items-center gap-2">
                                      {isExpanded ? <ChevronUp size={14} className="text-brand" /> : <ChevronDown size={14} className="text-brand" />}
                                      <span className="text-xs font-black text-brand uppercase tracking-widest">{category}</span>
                                    </div>
                                  </td>
                                </tr>
                                {isExpanded && filteredPermissions.filter(p => p.category === category).map(perm => {
                                  const role = roles.find(r => r.roleKey === selectedStaffForPermissions.role);
                                  const baseValue = role?.permissions[perm.id as PermissionKey] ?? false;
                                  const overrideValue = overrides[selectedStaffForPermissions.id]?.[perm.id as PermissionKey];
                                  const effectiveValue = overrideValue !== undefined ? overrideValue : baseValue;
                                  const isOverridden = overrideValue !== undefined;
                                  const isOwner = selectedStaffForPermissions.role === 'owner';

                                  return (
                                    <tr key={perm.id} className="hover:bg-surface-muted/50 transition-all border-b border-border">
                                      <td className="p-3 pr-4 sm:p-6 sm:pr-12">
                                        <div className="flex flex-col">
                                          <span className="text-xs sm:text-sm font-bold text-content">{perm.name}</span>
                                          <span className="text-[10px] text-content-muted font-medium mt-0.5 leading-relaxed">{perm.description}</span>
                                        </div>
                                      </td>
                                      <td className="p-3 sm:p-6 text-center">
                                        <button
                                          onClick={() => !isOwner && handleToggleStaffOverride(selectedStaffForPermissions.id, perm.id as PermissionKey)}
                                          disabled={isOwner}
                                          className={cn(
                                            "w-12 h-6 rounded-full relative transition-all duration-300 mx-auto",
                                            effectiveValue ? "bg-success" : "bg-surface-muted",
                                            isOwner && "opacity-50 cursor-not-allowed"
                                          )}
                                        >
                                          <div className={cn(
                                            "absolute top-1 w-4 h-4 bg-surface rounded-full shadow-sm transition-all duration-300",
                                            effectiveValue ? "right-1" : "right-7"
                                          )} />
                                        </button>
                                      </td>
                                      <td className="p-3 sm:p-6 text-center">
                                        <div className="flex flex-col items-center gap-1">
                                          <span className={cn(
                                            "text-[9px] font-black px-2 py-0.5 rounded-full uppercase",
                                            isOverridden ? "bg-info/10 text-info" : "bg-surface-muted text-content-muted"
                                          )}>
                                            {isOverridden ? 'استثناء خاص' : 'من الدور الوظيفي'}
                                          </span>
                                          {isOverridden && (
                                            <button 
                                              onClick={() => handleToggleStaffOverride(selectedStaffForPermissions.id, perm.id as PermissionKey)}
                                              className="text-[8px] text-content-muted hover:text-rose-500 font-bold underline"
                                            >
                                              استعادة الافتراضي
                                            </button>
                                          )}
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="h-full min-h-[400px] bg-surface rounded-[2.5rem] border border-dashed border-border flex flex-col items-center justify-center text-center p-12">
                    <div className="w-20 h-20 bg-surface-muted rounded-full flex items-center justify-center text-content-muted mb-6">
                      <User size={40} />
                    </div>
                    <h3 className="text-lg font-black text-content-muted">يرجى اختيار موظف للبدء</h3>
                    <p className="text-sm text-content-muted font-bold mt-2 max-w-xs">
                      اختر موظفاً من القائمة الجانبية لتعديل صلاحياته الفردية بشكل مستقل عن دوره الوظيفي
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
              <h4 className="text-sm font-black text-content">كيف تعمل مصفوفة الصلاحيات؟</h4>
              <p className="text-xs text-content-muted font-medium leading-relaxed">
                تتيح لك هذه المصفوفة التحكم الكامل في ما يمكن لكل دور وظيفي القيام به. التغييرات هنا تنطبق فوراً على جميع الموظفين المرتبطين بهذا الدور. 
                <br />
                <span className="font-black text-content">ملاحظة:</span> دور "المالك" يمتلك دائماً كافة الصلاحيات ولا يمكن تعديله لضمان عدم انقطاع الوصول للنظام.
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
                      {editingRole ? 'تعديل المهنة' : 'إضافة مهنة مخصصة'}
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
                      <label className="text-xs font-black text-content-muted uppercase tracking-widest mr-2">اسم المهنة</label>
                      <input 
                        type="text"
                        value={newRoleName}
                        onChange={(e) => setNewRoleName(e.target.value)}
                        className="w-full bg-surface-muted border-2 border-transparent focus:border-brand rounded-2xl p-4 font-bold outline-none transition-all text-content"
                        placeholder="مثال: مشرف مبيعات"
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-black text-content-muted uppercase tracking-widest mr-2">وصف المهنة</label>
                      <textarea 
                        value={newRoleDesc}
                        onChange={(e) => setNewRoleDesc(e.target.value)}
                        className="w-full bg-surface-muted border-2 border-transparent focus:border-brand rounded-2xl p-4 font-bold outline-none transition-all h-24 resize-none text-content"
                        placeholder="وصف مختصر للمهام..."
                      />
                    </div>

                    <button 
                      type="submit"
                      disabled={isSavingPermissions || !newRoleName}
                      className="w-full bg-brand text-white py-4 rounded-2xl font-black hover:bg-brand/90 shadow-xl shadow-brand/10 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {isSavingPermissions ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Plus size={20} />}
                      <span>{editingRole ? 'حفظ التعديلات' : 'إنشاء المهنة'}</span>
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
                  
                  <h3 className="text-xl font-black text-content text-center mb-2">حذف المهنة</h3>
                  <p className="text-sm font-bold text-content-muted text-center mb-8 leading-relaxed">
                    هل أنت متأكد من حذف مهنة "{roleToDelete.name}"؟ 
                    <br />
                    <span className="text-danger">سيتم فقدان كافة الصلاحيات المرتبطة بها نهائياً.</span>
                  </p>

                  <div className="flex gap-3">
                    <button
                      onClick={() => setRoleToDelete(null)}
                      disabled={isSavingPermissions}
                      className="flex-1 px-4 py-3 rounded-2xl font-black text-sm text-content-muted bg-surface-muted hover:bg-border transition-all disabled:opacity-50"
                    >
                      إلغاء
                    </button>
                    <button
                      onClick={executeDeleteRole}
                      disabled={isSavingPermissions}
                      className="flex-1 px-4 py-3 rounded-2xl font-black text-sm text-white bg-danger hover:bg-danger/90 transition-all shadow-xl shadow-danger/20 disabled:opacity-50 flex items-center justify-center"
                    >
                      {isSavingPermissions ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'تأكيد الحذف'}
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
                    <p className="text-[10px] text-content-muted font-black uppercase mb-1">إجمالي المهام</p>
                    <p className="text-2xl font-black text-content">{selectedStaffForDetails.performance?.totalHandled}</p>
                  </div>
                  <div className="bg-brand/10 p-4 rounded-2xl text-center">
                    <p className="text-[10px] text-brand font-black uppercase mb-1">قيد العمل</p>
                    <p className="text-2xl font-black text-brand">{selectedStaffForDetails.performance?.active}</p>
                  </div>
                  <div className="bg-success/5 p-4 rounded-2xl text-center">
                    <p className="text-[10px] text-success font-black uppercase mb-1">المنجزة</p>
                    <p className="text-2xl font-black text-success">{selectedStaffForDetails.performance?.completed}</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="font-black text-content flex items-center gap-2">
                    <Clock size={18} className="text-brand" />
                    آخر الطلبات التي تم التعامل معها
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
                              <p className="font-bold text-content">طلب #{order.orderNumber}</p>
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
                  تعديل بيانات موظف
                </h2>
                <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-surface rounded-full transition-colors shadow-sm">
                  <X size={24} className="text-content-muted" />
                </button>
              </div>
              <form onSubmit={handleSubmit(onSubmit)} className="p-8 space-y-6">
                <div className="space-y-2">
                  <label className="text-xs font-black text-content-muted uppercase tracking-widest">الاسم الكامل</label>
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
                  <label className="text-xs font-black text-content-muted uppercase tracking-widest">الدور الوظيفي</label>
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
                  <label className="text-xs font-black text-content-muted uppercase tracking-widest">الفرع</label>
                  <Controller
                    name="branchId"
                    control={control}
                    render={({ field }) => (
                      <SmartSelect 
                        {...field}
                        className={cn("w-full", errors.branchId && "ring-2 ring-red-500")}
                        options={[
                          { value: '', label: 'اختر الفرع...' },
                          ...branches.map(branch => ({ value: branch.id, label: branch.name }))
                        ]}
                      />
                    )}
                  />
                  {errors.branchId && <p className="text-xs text-red-500 font-bold">{errors.branchId.message}</p>}
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-content-muted uppercase tracking-widest">البريد الإلكتروني</label>
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
                  <label className="text-xs font-black text-content-muted uppercase tracking-widest">رقم الهاتف</label>
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
                      تفعيل رمز الموظف
                    </label>
                    <p className="text-xs text-content-muted">السماح للموظف بتسجيل الدخول باستخدام رمز سري</p>
                  </div>
                </div>

                {enablePin && (
                  <div className="space-y-2">
                    <label className="text-xs font-black text-content-muted uppercase tracking-widest">رمز الدخول (4 أرقام)</label>
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
                    <p className="text-xs text-brand font-bold mt-2">اتركه فارغاً لإنشاء رمز عشوائي للموظف</p>
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
                    بيانات تجريبية (Test Data)
                  </label>
                </div>

                <button 
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-brand text-white py-4 rounded-2xl font-black hover:bg-brand/90 shadow-xl shadow-brand/10 transition-all hover:scale-105 active:scale-95 mt-4 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? 'جاري الحفظ...' : 'حفظ التعديلات'}
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
  const categories = Array.from(new Set(SYSTEM_PERMISSIONS.map(p => p.category)));
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
              <h2 className="text-2xl font-black text-content">صلاحيات {role.name}</h2>
              <p className="text-xs text-content-muted font-bold uppercase tracking-widest">عرض مصفوفة الصلاحيات لهذا الدور</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={toggleAll}
              className="text-xs font-bold text-brand hover:text-brand/80 transition-colors"
            >
              {expandedCategories.length === categories.length ? 'طي الكل' : 'توسيع الكل'}
            </button>
            <button onClick={onClose} className="p-2 hover:bg-surface rounded-full transition-colors shadow-sm bg-surface">
              <X size={24} className="text-content-muted" />
            </button>
          </div>
        </div>

        <div className="p-8 overflow-y-auto space-y-4">
          {categories.map(category => {
            const isExpanded = expandedCategories.includes(category);
            const categoryPerms = SYSTEM_PERMISSIONS.filter(p => p.category === category);
            
            return (
              <div key={category} className="bg-surface rounded-[2rem] border border-border overflow-hidden">
                <button 
                  onClick={() => toggleCategory(category)}
                  className="w-full p-4 bg-surface-muted/30 flex items-center justify-between group transition-colors hover:bg-surface-muted/50"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-1.5 h-5 bg-brand rounded-full" />
                    <h3 className="text-sm font-black text-brand uppercase tracking-widest">{category}</h3>
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
                                  <span className="text-sm font-bold text-content">{perm.name}</span>
                                  <span className="text-[10px] text-content-muted font-medium">{perm.description}</span>
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
            إغلاق
          </button>
        </div>
      </motion.div>
    </div>
  );
};
