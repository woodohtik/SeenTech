import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { SaasUserRole } from '../types/supabase';
import { ShieldAlert } from 'lucide-react';
import { motion } from 'motion/react';

interface RoleGuardProps {
  children: React.ReactNode;
  allowedRoles: SaasUserRole[];
}

export default function RoleGuard({ children, allowedRoles }: RoleGuardProps) {
  const { dbUser, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand"></div>
      </div>
    );
  }

  const userRole = dbUser?.role;
  const isOwnerEquivalent = userRole === 'owner' || userRole === 'super_admin';

  const hasAllowedRole = allowedRoles.includes(userRole as SaasUserRole) || 
                         (isOwnerEquivalent && allowedRoles.includes('super_admin'));

  if (!userRole || !hasAllowedRole) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="w-32 h-32 bg-danger/10 text-danger rounded-full flex items-center justify-center mb-8"
        >
          <ShieldAlert size={64} />
        </motion.div>
        <h2 className="text-4xl font-black text-content mb-4">عفواً، لا تملك الصلاحية</h2>
        <p className="text-xl text-content-muted max-w-md mx-auto leading-relaxed">
          حسابك الحالي لا يمتلك الصلاحيات الإدارية الكافية لعرض أو تعديل هذه الصفحة.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
