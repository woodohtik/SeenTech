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
import { seedGlobalRoles } from '../services/permissionService';

const ALL_PERMISSIONS: { key: PermissionKey; label: string; category: string }[] = [
  // Customers
  { key: 'customers.view', label: 'عرض العملاء', category: 'العملاء' },
  { key: 'customers.create', label: 'إضافة عميل', category: 'العملاء' },
  { key: 'customers.edit', label: 'تعديل عميل', category: 'العملاء' },
  { key: 'customers.delete', label: 'حذف عميل', category: 'العملاء' },
  // Orders
  { key: 'orders.view', label: 'عرض الطلبات', category: 'الطلبات' },
  { key: 'orders.create', label: 'إنشاء طلب', category: 'الطلبات' },
  { key: 'orders.edit', label: 'تعديل طلب', category: 'الطلبات' },
  { key: 'orders.delete', label: 'حذف طلب', category: 'الطلبات' },
  // Inventory
  { key: 'inventory.view', label: 'عرض المخزون', category: 'المخزون' },
  { key: 'inventory.create', label: 'إضافة صنف', category: 'المخزون' },
  { key: 'inventory.edit', label: 'تعديل صنف', category: 'المخزون' },
  { key: 'inventory.delete', label: 'حذف صنف', category: 'المخزون' },
  { key: 'inventory.reconcile', label: 'تسوية المخزون', category: 'المخزون' },
  // Staff
  { key: 'staff.view', label: 'عرض الموظفين', category: 'الموظفين' },
  { key: 'staff.create', label: 'إضافة موظف', category: 'الموظفين' },
  { key: 'staff.edit', label: 'تعديل موظف', category: 'الموظفين' },
  { key: 'staff.delete', label: 'حذف موظف', category: 'الموظفين' },
  // Reports
  { key: 'reports.view', label: 'عرض التقارير', category: 'التقارير' },
  { key: 'reports.export', label: 'تصدير التقارير', category: 'التقارير' },
  // Settings
  { key: 'settings.view', label: 'عرض الإعدادات', category: 'الإعدادات' },
  { key: 'settings.edit', label: 'تعديل الإعدادات', category: 'الإعدادات' },
  { key: 'settings.whatsapp', label: 'إعدادات واتساب', category: 'الإعدادات' },
  { key: 'settings.billing', label: 'إعدادات الفوترة', category: 'الإعدادات' },
  { key: 'settings.notifications', label: 'إعدادات التنبيهات', category: 'الإعدادات' },
  // Dashboard
  { key: 'dashboard.view', label: 'عرض لوحة التحكم', category: 'لوحة التحكم' },
  { key: 'dashboard.revenue', label: 'عرض الإيرادات', category: 'لوحة التحكم' },
  { key: 'dashboard.orders', label: 'عرض إحصائيات الطلبات', category: 'لوحة التحكم' },
  { key: 'dashboard.inventory', label: 'عرض إحصائيات المخزون', category: 'لوحة التحكم' },
  { key: 'dashboard.customers', label: 'عرض إحصائيات العملاء', category: 'لوحة التحكم' },
  // Actions
  { key: 'action.refund', label: 'إجراء مرتجع', category: 'عمليات خاصة' },
  { key: 'action.discount', label: 'منح خصم', category: 'عمليات خاصة' },
  { key: 'suppliers.manage', label: 'إدارة الموردين', category: 'الموردين' },
];

const CATEGORIES = Array.from(new Set(ALL_PERMISSIONS.map(p => p.category)));

export default function GlobalRoleManager() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [newRole, setNewRole] = useState<Partial<Role>>({
    name: '',
    description: '',
    permissions: {} as PermissionsMap,
    tenantId: '',
    isDefault: true
  });
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
      console.error('Error fetching system roles:', error);
    } else if (data) {
      setRoles(data.map(d => ({
        id: d.id,
        name: d.name,
        description: d.description,
        permissions: d.permissions,
        tenantId: d.tenant_id,
        isDefault: d.is_default
      } as Role)));
    }
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
    const roleToSave = editingRole || newRole;
    if (!roleToSave.name) return;

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
        setToast({ message: 'تم تحديث المهنة بنجاح', type: 'success' });
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
        setToast({ message: 'تم إنشاء مهنة النظام بنجاح', type: 'success' });
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
      console.error('Error saving role:', error);
      setToast({ message: `فشل الحفظ: ${error.message || 'خطأ غير معروف'}`, type: 'error' });
    }
  };

  const handleDeleteRole = async (id: string) => {
    if (!window.confirm('هل أنت متأكد من حذف هذه المهنة؟ سيؤثر ذلك على جميع المشتركين الذين يستخدمونها.')) return;
    try {
      const { error } = await supabase
        .from('roles')
        .delete()
        .eq('id', id);
      if (error) throw error;
      setToast({ message: 'تم حذف المهنة بنجاح', type: 'success' });
      await fetchRoles();
    } catch (error: any) {
      console.error('Error deleting role:', error);
      setToast({ message: `فشل الحذف: ${error.message || 'خطأ غير معروف'}`, type: 'error' });
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
          <h2 className="text-2xl font-black text-gray-900">إدارة المهن الافتراضية</h2>
          <p className="text-gray-500 font-medium mt-1">تحديد المهن والصلاحيات الأساسية المتاحة لجميع المشتركين</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={async () => {
              if (window.confirm('هل تريد تهيئة المهن الافتراضية للنظام؟')) {
                const seeded = await seedGlobalRoles();
                if (seeded) alert('تمت تهيئة المهن بنجاح');
                else alert('المهن موجودة بالفعل');
              }
            }}
            className="flex items-center gap-2 px-6 py-3 bg-indigo-50 text-indigo-600 rounded-2xl font-black hover:bg-indigo-100 transition-all"
          >
            <Database size={20} />
            <span>تهيئة المهن الافتراضية</span>
          </button>
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-2xl font-black hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
          >
            <Plus size={20} />
            <span>إضافة مهنة نظام</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {roles.map((role) => (
          <motion.div
            key={role.id}
            layoutId={role.id}
            className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm hover:shadow-md transition-all group"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center">
                <Shield size={24} />
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setEditingRole(role)}
                  className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"
                >
                  <Edit2 size={18} />
                </button>
                <button
                  onClick={() => handleDeleteRole(role.id)}
                  className="p-2 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>

            <h3 className="text-lg font-black text-gray-900">{role.name}</h3>
            <p className="text-sm text-gray-500 font-medium mt-1 line-clamp-2 h-10">
              {role.description || 'لا يوجد وصف متاح'}
            </p>

            <div className="mt-6 pt-6 border-t border-gray-50">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400 font-bold">الصلاحيات الممنوحة</span>
                <span className="text-indigo-600 font-black">
                  {Object.values(role.permissions || {}).filter(Boolean).length} / {ALL_PERMISSIONS.length}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {CATEGORIES.slice(0, 3).map(cat => {
                  const count = ALL_PERMISSIONS.filter(p => p.category === cat && role.permissions?.[p.key]).length;
                  if (count === 0) return null;
                  return (
                    <span key={cat} className="px-2.5 py-1 bg-gray-50 text-gray-600 text-[10px] font-black rounded-lg">
                      {cat}: {count}
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
        ))}
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
                      {editingRole ? 'تعديل مهنة النظام' : 'إضافة مهنة نظام جديدة'}
                    </h3>
                    <p className="text-sm text-gray-500 font-bold">تحديد الصلاحيات الافتراضية للقالب</p>
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
                    <label className="block text-sm font-black text-gray-700">اسم المهنة</label>
                    <input
                      type="text"
                      value={editingRole?.name || newRole.name}
                      onChange={(e) => editingRole 
                        ? setEditingRole({ ...editingRole, name: e.target.value })
                        : setNewRole({ ...newRole, name: e.target.value })
                      }
                      placeholder="مثال: مدير المتجر، كاشير..."
                      className="w-full p-4 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-indigo-500 font-bold"
                    />
                  </div>
                  <div className="space-y-3">
                    <label className="block text-sm font-black text-gray-700">وصف المهنة</label>
                    <input
                      type="text"
                      value={editingRole?.description || newRole.description}
                      onChange={(e) => editingRole
                        ? setEditingRole({ ...editingRole, description: e.target.value })
                        : setNewRole({ ...newRole, description: e.target.value })
                      }
                      placeholder="وصف مختصر لمسؤوليات هذه المهنة"
                      className="w-full p-4 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-indigo-500 font-bold"
                    />
                  </div>
                </div>

                <div className="space-y-8">
                  <div className="flex items-center justify-between">
                    <h4 className="text-lg font-black text-gray-900 flex items-center gap-2">
                      <Lock className="text-indigo-600" size={20} />
                      مصفوفة الصلاحيات
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
                        تحديد الكل
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
                        إلغاء الكل
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                    {CATEGORIES.map(category => (
                      <div key={category} className="space-y-4">
                        <div className="flex items-center gap-2 pb-2 border-b border-gray-100">
                          <div className="w-1.5 h-6 bg-indigo-600 rounded-full" />
                          <h5 className="font-black text-gray-900">{category}</h5>
                        </div>
                        <div className="grid grid-cols-1 gap-3">
                          {ALL_PERMISSIONS.filter(p => p.category === category).map(permission => {
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
                                    {permission.label}
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
                  <span className="text-xs font-bold">تعديل هذه المهنة سيؤثر على جميع المشتركين الجدد.</span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      setIsAdding(false);
                      setEditingRole(null);
                    }}
                    className="px-8 py-4 text-gray-500 font-black hover:bg-white rounded-2xl transition-all"
                  >
                    إلغاء
                  </button>
                  <button
                    onClick={handleSaveRole}
                    className="px-12 py-4 bg-indigo-600 text-white rounded-2xl font-black hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 flex items-center gap-2"
                  >
                    <Check size={20} />
                    <span>حفظ المهنة</span>
                  </button>
                </div>
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
