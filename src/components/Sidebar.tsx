import React from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getFilteredMenuItems, MenuItemConfig } from '../config/menuConfig';
import { usePermissions } from '../hooks/usePermissions';
import { Staff, PermissionKey } from '../types/index';

interface SidebarProps {
  currentRole: string;
  currentStaff: Staff | null;
  isActingAsSaaS?: boolean;
  isImpersonatingSaaS?: boolean;
  onCloseMobile?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentRole,
  currentStaff,
  isActingAsSaaS = false,
  isImpersonatingSaaS = false,
  onCloseMobile
}) => {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions(currentStaff);

  const isOwner = currentRole === 'owner' || currentRole === 'tenant_admin' || isImpersonatingSaaS;

  // 1. Filter menu items using menuConfig according to user role
  const allowedMenuItems: MenuItemConfig[] = getFilteredMenuItems(
    currentRole,
    isActingAsSaaS,
    isImpersonatingSaaS
  ).filter(item => {
    // 2. Secondary fine-grained permission filter
    if (isImpersonatingSaaS || isOwner || currentRole === 'super_admin') return true;
    if (item.permissions) return item.permissions.some(p => hasPermission(p as PermissionKey));
    if (item.permission) return hasPermission(item.permission as PermissionKey);
    return true;
  });

  return (
    <aside dir="rtl" className="w-64 bg-surface border-l border-border h-full flex flex-col justify-between p-4 select-none">
      <div className="space-y-6">
        {/* Header Logo */}
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-10 h-10 rounded-2xl bg-brand text-white font-black flex items-center justify-center text-xl shadow-md shadow-brand/20">
            س
          </div>
          <div>
            <h2 className="text-lg font-black text-content leading-none">نظام سين</h2>
            <p className="text-[11px] font-bold text-content-muted mt-1">نظام نقاط البيع والخياطة</p>
          </div>
        </div>

        {/* Filtered Navigation Links */}
        <nav className="space-y-1.5" aria-label="Main Navigation">
          {allowedMenuItems.map(item => {
            const Icon = item.icon;
            const translatedLabel = t(item.labelKey, item.defaultLabel);

            return (
              <NavLink
                key={item.id}
                to={item.to}
                onClick={onCloseMobile}
                className={({ isActive }) => `
                  flex items-center gap-3 px-4 py-3 rounded-2xl font-bold text-sm transition-all duration-200
                  ${isActive 
                    ? 'bg-brand text-white shadow-lg shadow-brand/20 font-black translate-x-1' 
                    : 'text-content-muted hover:bg-surface-muted hover:text-content'
                  }
                `}
              >
                <Icon size={20} className="shrink-0" />
                <span className="truncate">{translatedLabel}</span>
              </NavLink>
            );
          })}
        </nav>
      </div>

      {/* Role Badge Footer */}
      <div className="p-3 bg-surface-muted rounded-2xl border border-border flex items-center gap-3">
        <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse shrink-0"></div>
        <div className="overflow-hidden">
          <div className="text-xs font-black text-content truncate">
            {currentStaff?.name || 'المستخدم الحالي'}
          </div>
          <div className="text-[10px] font-bold text-content-muted capitalize truncate">
            {currentRole}
          </div>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
