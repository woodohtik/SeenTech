import React from 'react';
import DashboardOwner from './DashboardOwner';
import PageSkeleton from './PageSkeleton';

interface DashboardProps {
  tenantId: string;
}

/**
 * Main Dynamic Dashboard Component
 * Renders the unified DashboardOwner component with strict role-based data filtering:
 * - Administrative & Financial data (Total Revenue, Receivables, Net Profits, Financial Charts)
 *   are restricted to tenant_admin, owner, admin, manager, accountant, super_admin or users with dashboard.revenue permission.
 * - Operational data (Active Orders, Tailor Workshop Stages, Inventory Items, Customer Queue)
 *   are visible for operational roles (cashier, tailor) with zero financial data leakage.
 */
export default function Dashboard({ tenantId }: DashboardProps) {
  return (
    <React.Suspense fallback={<PageSkeleton />}>
      <DashboardOwner tenantId={tenantId} />
    </React.Suspense>
  );
}
