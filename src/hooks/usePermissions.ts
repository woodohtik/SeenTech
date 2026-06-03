import { useState, useEffect } from 'react';
import { Staff, PermissionsMap, PermissionKey } from '../types';
import { getEffectivePermissions, logUnauthorizedAccess } from '../services/permissionService';
import { useToast } from '../contexts/ToastContext';

export function usePermissions(staff: Staff | null) {
  const [permissions, setPermissions] = useState<PermissionsMap | null>(null);
  const [loading, setLoading] = useState(true);
  const { warning } = useToast();

  useEffect(() => {
    if (!staff) {
      setPermissions(null);
      setLoading(false);
      return;
    }

    const fetchPermissions = async () => {
      try {
        const effective = await getEffectivePermissions(staff);
        setPermissions(effective);
      } catch (err) {
        console.error('Error fetching permissions:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchPermissions();
  }, [staff]);

  const hasPermission = (key: PermissionKey): boolean => {
    if (!staff) return false;
    if (staff.role === 'owner' || staff.role === 'super_admin') return true;
    if (!permissions) return false;
    return permissions[key] === true;
  };

  const checkPermission = async (key: PermissionKey, moduleName: string): Promise<boolean> => {
    const allowed = hasPermission(key);
    if (!allowed && staff) {
      await logUnauthorizedAccess(staff, key, moduleName);
      warning('تنبيه الصلاحيات', 'عذراً، لا تملك الصلاحية الكافية لتنفيذ هذا الإجراء، يرجى التواصل مع المدير');
    }
    return allowed;
  };

  return { permissions, hasPermission, checkPermission, loading };
}
