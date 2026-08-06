import { useState, useEffect } from 'react';
import { Staff, PermissionsMap, PermissionKey } from '../types';
import { getEffectivePermissions, logUnauthorizedAccess } from '../services/permissionService';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';

export function usePermissions(staff: Staff | null) {
  const [permissions, setPermissions] = useState<PermissionsMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [prevStaffId, setPrevStaffId] = useState<string | null>(null);
  const { warning } = useToast();
  const { dbUser } = useAuth();

  // Sync state during render when staff changes to prevent flashes
  if (staff?.id !== prevStaffId) {
    setPrevStaffId(staff?.id || null);
    setPermissions(null);
    setLoading(staff ? true : false);
  }

  const isGlobalSuperAdmin = dbUser?.role === 'super_admin';

  const fetchPermissions = async () => {
    if (!staff) {
      setPermissions(null);
      setLoading(false);
      return;
    }

    try {
      const effective = await getEffectivePermissions(staff);
      setPermissions(effective);
    } catch (err) {
      console.error('Error fetching permissions:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPermissions();

    const handlePermissionsUpdated = () => {
      fetchPermissions();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('permissions_updated', handlePermissionsUpdated);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('permissions_updated', handlePermissionsUpdated);
      }
    };
  }, [staff]);

  const hasPermission = (key: PermissionKey): boolean => {
    if (isGlobalSuperAdmin) return true;
    if (!staff) return false;
    // Owners & Super Admins have absolute full system access
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
