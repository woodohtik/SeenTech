/**
 * Dashboard — موجّه حسب الرول.
 * خياط/كاشير → شاشة «اليوم» التشغيلية. مالك/مدير/محاسب/super_admin → لوحة التحليلات.
 * المحتوى داخل كلٍّ يُفصَّل بالصلاحيات (hasPermission).
 */
import { useStaff } from '../contexts/StaffContext';
import DashboardOwner from './DashboardOwner';
import DashboardToday from './DashboardToday';

const OPERATIONAL_ROLES = ['tailor', 'cashier'];

export default function Dashboard({ tenantId }: { tenantId: string }) {
  const { currentStaff } = useStaff();
  const role = currentStaff?.role || 'tailor';
  if (OPERATIONAL_ROLES.includes(role)) return <DashboardToday tenantId={tenantId} />;
  return <DashboardOwner tenantId={tenantId} />;
}
