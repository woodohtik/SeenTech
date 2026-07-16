/**
 * Dashboard — موجّه حسب الرول.
 * خياط/كاشير → شاشة «اليوم» التشغيلية. مالك/مدير/محاسب/super_admin → لوحة التحليلات.
 * المحتوى داخل كلٍّ يُفصَّل بالصلاحيات (hasPermission).
 */
import React from 'react';
import { useStaff } from '../contexts/StaffContext';
import PageSkeleton from './PageSkeleton';

const DashboardOwner = React.lazy(() => import('./DashboardOwner'));
const DashboardToday = React.lazy(() => import('./DashboardToday'));

const OPERATIONAL_ROLES = ['tailor', 'cashier'];

export default function Dashboard({ tenantId }: { tenantId: string }) {
  const { currentStaff } = useStaff();
  const role = currentStaff?.role || 'tailor';
  
  return (
    <React.Suspense fallback={<PageSkeleton />}>
      {OPERATIONAL_ROLES.includes(role) ? (
        <DashboardToday tenantId={tenantId} />
      ) : (
        <DashboardOwner tenantId={tenantId} />
      )}
    </React.Suspense>
  );
}

