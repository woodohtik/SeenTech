import React, { useState, useEffect, useRef } from 'react';
import { NavLink, useLocation, useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getFilteredMenuItems, MenuItemConfig } from '../config/menuConfig';
import { usePermissions } from '../hooks/usePermissions';
import { Staff, PermissionKey } from '../types/index';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ChevronDown, 
  ChevronUp, 
  Store, 
  FileText, 
  MapPin, 
  Palette, 
  Printer, 
  Bell, 
  MessageSquare, 
  Shield, 
  CreditCard, 
  Database 
} from 'lucide-react';

interface SidebarProps {
  currentRole: string;
  currentStaff: Staff | null;
  isActingAsSaaS?: boolean;
  isImpersonatingSaaS?: boolean;
  onCloseMobile?: () => void;
}

type TabType = 'profile' | 'appearance' | 'invoice' | 'printer' | 'tax' | 'branches' | 'staff' | 'whatsapp' | 'billing' | 'support' | 'notifications' | 'data';

export const Sidebar: React.FC<SidebarProps> = ({
  currentRole,
  currentStaff,
  isActingAsSaaS = false,
  isImpersonatingSaaS = false,
  onCloseMobile
}) => {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions(currentStaff);
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const isOwner = currentRole === 'owner' || currentRole === 'tenant_admin' || isImpersonatingSaaS;

  // State to control settings sub-menu expansion
  const [isSettingsExpanded, setIsSettingsExpanded] = useState(location.pathname === '/settings');
  const settingsContainerRef = useRef<HTMLDivElement>(null);

  // Sync settings expansion state with route
  useEffect(() => {
    if (location.pathname === '/settings') {
      setIsSettingsExpanded(true);
    }
  }, [location.pathname]);

  // Smooth scroll to settings container when it expands
  useEffect(() => {
    if (isSettingsExpanded) {
      const timer = setTimeout(() => {
        settingsContainerRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isSettingsExpanded]);

  // Secondary fine-grained permission checks for settings sub-tabs
  const canEdit = hasPermission('settings.edit');
  const canViewWhatsApp = hasPermission('settings.whatsapp');
  const canViewBilling = hasPermission('settings.billing');
  const canViewNotifications = hasPermission('settings.notifications');

  // Define settings sub-tabs with their permissions & icons
  const settingsTabs: { id: TabType; label: string; icon: any; visible: boolean }[] = [
    { id: 'profile', label: 'الملف الشخصي', icon: Store, visible: true },
    { id: 'tax', label: 'الإعدادات الضريبية', icon: FileText, visible: canEdit },
    { id: 'branches', label: 'الفروع والمواقع', icon: MapPin, visible: hasPermission('branches.manage') },
    { id: 'appearance', label: 'المظهر والسمات', icon: Palette, visible: true },
    { id: 'invoice', label: 'تخطيط الفاتورة', icon: FileText, visible: true },
    { id: 'printer', label: 'إعدادات الطابعة', icon: Printer, visible: true },
    { id: 'notifications', label: 'التنبيهات', icon: Bell, visible: canViewNotifications },
    { id: 'whatsapp', label: 'تكامل واتساب', icon: MessageSquare, visible: canViewWhatsApp },
    { id: 'staff', label: 'طاقم الموظفين', icon: Shield, visible: hasPermission('staff.manage') },
    { id: 'billing', label: 'الاشتراك والمدفوعات', icon: CreditCard, visible: canViewBilling },
    { id: 'data', label: 'إدارة البيانات', icon: Database, visible: currentStaff?.role === 'owner' || currentStaff?.role === 'super_admin' },
  ];

  const visibleSettingsTabs = settingsTabs.filter(tab => tab.visible);

  // Filter main menu items using menuConfig according to user role
  const allowedMenuItems: MenuItemConfig[] = getFilteredMenuItems(
    currentRole,
    isActingAsSaaS,
    isImpersonatingSaaS
  ).filter(item => {
    if (isImpersonatingSaaS || isOwner || currentRole === 'super_admin') return true;
    if (item.permissions) return item.permissions.some(p => hasPermission(p as PermissionKey));
    if (item.permission) return hasPermission(item.permission as PermissionKey);
    return true;
  });

  return (
    <aside dir="rtl" className="w-64 bg-surface border-l border-border h-full flex flex-col justify-between p-4 select-none overflow-y-auto custom-scrollbar">
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

            // Special handling for Settings item to make it a collapsible accordion
            if (item.id === 'settings') {
               const isSettingsActive = location.pathname === '/settings';
               return (
                 <div key={item.id} ref={settingsContainerRef} className="space-y-1">
                   <button
                     onClick={() => {
                       setIsSettingsExpanded(!isSettingsExpanded);
                       if (location.pathname !== '/settings') {
                         navigate('/settings');
                       }
                       // Dispatch custom event to notify Settings page
                       window.dispatchEvent(new CustomEvent('sidebar_settings_clicked'));
                     }}
                     className={`
                       w-full flex items-center justify-between px-4 py-3 rounded-2xl font-bold text-sm transition-all duration-200
                       ${isSettingsActive 
                         ? 'bg-brand/10 text-brand font-black' 
                         : 'text-content-muted hover:bg-surface-muted hover:text-content'
                       }
                     `}
                   >
                     <div className="flex items-center gap-3">
                       <Icon size={20} className="shrink-0" />
                       <span className="truncate">{translatedLabel}</span>
                     </div>
                     {isSettingsExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                   </button>

                   {/* Collapsible Sub-menu using Framer Motion */}
                   <AnimatePresence initial={false}>
                     {isSettingsExpanded && (
                       <motion.div
                         initial={{ height: 0, opacity: 0 }}
                         animate={{ height: 'auto', opacity: 1 }}
                         exit={{ height: 0, opacity: 0 }}
                         transition={{ duration: 0.25, ease: 'easeInOut' }}
                         className="overflow-hidden pr-4 mr-2 border-r-2 border-border/60 space-y-1 flex flex-col mt-1"
                       >
                         {visibleSettingsTabs.map(tab => {
                           const TabIcon = tab.icon;
                           const isTabActive = isSettingsActive && (searchParams.get('tab') || 'profile') === tab.id;

                           return (
                             <NavLink
                               key={tab.id}
                               to={`/settings?tab=${tab.id}`}
                               onClick={() => {
                                 onCloseMobile?.();
                                 // Dispatch custom event to notify Settings page
                                 window.dispatchEvent(new CustomEvent('sidebar_settings_clicked', { detail: { tab: tab.id } }));
                               }}
                               className={`
                                 flex items-center gap-2.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all duration-200
                                 ${isTabActive
                                   ? 'bg-brand text-white shadow-md shadow-brand/15 font-black translate-x-1'
                                   : 'text-content-muted hover:bg-surface-muted hover:text-content'
                                 }
                               `}
                             >
                               <TabIcon size={15} className="shrink-0" />
                               <span className="truncate">{tab.label}</span>
                             </NavLink>
                           );
                         })}
                       </motion.div>
                     )}
                   </AnimatePresence>
                 </div>
               );
             }

            return (
              <NavLink
                key={item.id}
                to={item.to}
                onClick={onCloseMobile}
                onMouseEnter={() => {
                  if (item.id === 'orders') {
                    import('./Orders').catch(() => {});
                  } else if (item.id === 'customers') {
                    import('./Customers').catch(() => {});
                  } else if (item.id === 'dashboard') {
                    import('./Dashboard').catch(() => {});
                  }
                }}
                onFocus={() => {
                  if (item.id === 'orders') {
                    import('./Orders').catch(() => {});
                  } else if (item.id === 'customers') {
                    import('./Customers').catch(() => {});
                  } else if (item.id === 'dashboard') {
                    import('./Dashboard').catch(() => {});
                  }
                }}
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
      <div className="p-3 bg-surface-muted rounded-2xl border border-border flex items-center gap-3 mt-4">
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
