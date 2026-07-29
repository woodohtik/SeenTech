import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Users, 
  ShoppingBag, 
  Settings, 
  LogOut,
  Shield,
  Scissors,
  ChevronLeft,
  Home,
  UserCircle,
  Package,
  Briefcase,
  BarChart3,
  Lock,
  Building2,
  ArrowRightLeft,
  Globe,
  Sun,
  Moon,
  LayoutGrid,
  List,
  Monitor,
  Menu,
  X as XIcon
} from 'lucide-react';
import { auth } from '../lib/firebase';
import { signOut } from 'firebase/auth';
import { supabase } from '../lib/supabase/client';
import { cn } from '../lib/utils';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../contexts/ThemeContext';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { motion, AnimatePresence } from 'motion/react';
import { AlertCircle } from 'lucide-react';

import { UserRole, Staff as StaffType, PermissionKey } from '../types';
import { getFilteredNavItems } from '../config/navigation';
import { usePermissions } from '../hooks/usePermissions';
import UserPreferencesMenu from './UserPreferencesMenu';
import SupportConsentModal from './SupportConsentModal';
import StaffTutorialModal from './StaffTutorialModal';
import SeenAIFab from './SeenAIFab';
import OnboardingTour from './OnboardingTour';




interface LayoutProps {
  children: React.ReactNode;
  role?: UserRole | null;
  tenantId?: string | null;
  currentStaff?: StaffType | null;
  onLock?: () => void;
  isLocked?: boolean;
}

export default function Layout({ children, role, tenantId, currentStaff, onLock, isLocked = false }: LayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar' || i18n.language === 'ur';
  const { theme, setTheme } = useTheme();
  const { impersonationTenantId, setImpersonationTenantId } = useAuth();
  const [isCollapsed, setIsCollapsed] = React.useState(false);
  const [isHovered, setIsHovered] = React.useState(false);
  const [tenantLogo, setTenantLogo] = React.useState<string | null>(null);
  const [tenantName, setTenantName] = React.useState<string>(t('common.tailor_system'));
  const [isLangOpen, setIsLangOpen] = React.useState(false);
  const [layoutMode, setLayoutMode] = React.useState<'sidebar' | 'grid'>('sidebar');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);

  React.useEffect(() => {
    const fetchTenant = async () => {
      if (tenantId && tenantId !== 'saas_management') {
        try {
          const { data, error } = await supabase
            .from('tenants')
            .select('*')
            .eq('id', tenantId)
            .maybeSingle();

          if (data && !error) {
            setTenantLogo(data.logo_url || null);
            setTenantName(data.name || t('common.tailor_system'));
            
            // Load layout preference
            const savedMode = localStorage.getItem(`layoutMode_${tenantId}_${currentStaff?.id || role}`);
            if (savedMode) {
              setLayoutMode(savedMode as 'sidebar' | 'grid');
            } else if (data.defaultLayout) {
              setLayoutMode(data.defaultLayout);
            }
          }
        } catch (error) {
          console.error('Error fetching tenant logo:', error);
        }
      }
    };
    fetchTenant();
    window.addEventListener('tenant_settings_updated', fetchTenant);
    return () => {
      window.removeEventListener('tenant_settings_updated', fetchTenant);
    };
  }, [tenantId, t, currentStaff?.id, role]);

  React.useEffect(() => {
    const handleLayoutSync = () => {
      const savedMode = localStorage.getItem(`layoutMode_${tenantId}_${currentStaff?.id || role}`);
      if (savedMode) {
        setLayoutMode(savedMode as 'sidebar' | 'grid');
      }
    };
    window.addEventListener('layout_mode_changed', handleLayoutSync);
    return () => {
      window.removeEventListener('layout_mode_changed', handleLayoutSync);
    };
  }, [tenantId, currentStaff?.id, role]);

  const toggleLayoutMode = () => {
    const newMode = layoutMode === 'sidebar' ? 'grid' : 'sidebar';
    setLayoutMode(newMode);
    const storageKey = `layoutMode_${tenantId}_${currentStaff?.id || role}`;
    localStorage.setItem(storageKey, newMode);
    window.dispatchEvent(new CustomEvent('layout_mode_changed'));

    if (newMode === 'grid') {
      navigate('/');
    } else {
      navigate('/dashboard');
    }
  };

  const handleLogout = async () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
      await signOut(auth);
    } catch (e) {
      console.error(e);
    }
    window.location.replace('/login');
  };

  const isSuperAdmin = role === 'super_admin';
  const isSupportTech = role === 'support_tech';
  const isBillingAdmin = role === 'billing_admin';
  const isSaaSStaff = isSuperAdmin || isSupportTech || isBillingAdmin;

  // When impersonating, they want to see the tenant UI
  const isActingAsSaaS = isSaaSStaff && !impersonationTenantId;
  const isImpersonatingSaaS = isSaaSStaff && !!impersonationTenantId;
  
  const isOwner = role === 'owner' || isImpersonatingSaaS;
  const isCashier = role === 'cashier';
  const isTailor = role === 'tailor';

  const effectiveRole = currentStaff?.role || role;

  const { hasPermission, loading: permissionsLoading } = usePermissions(currentStaff);

  // Dynamic RBAC Menu Configuration
  const navItems = getFilteredNavItems(effectiveRole, isActingAsSaaS, isImpersonatingSaaS).map(item => ({
    ...item,
    label: t(item.labelKey, item.defaultLabel)
  })).filter(item => {
    // Secondary check for fine-grained permissions if explicitly required
    if (isImpersonatingSaaS || isOwner || effectiveRole === 'super_admin') return true;
    if (item.permissions) return item.permissions.some(p => hasPermission(p as PermissionKey));
    if (item.permission) return hasPermission(item.permission as PermissionKey);
    return true;
  });

  // Stable identities for the guided tour, so its internal memoization holds
  // instead of rebuilding the step list on every Layout render.
  const tourNavRoutes = React.useMemo(
    () => navItems.map(item => item.to),
    [navItems.map(item => item.to).join('|')] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const tourHasPermission = React.useCallback(
    (key: string) => hasPermission(key as PermissionKey),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [permissionsLoading, currentStaff?.id, currentStaff?.role]
  );

  return (
    <div className={cn("flex min-h-[100dvh] h-[100dvh] bg-surface-muted font-sans overflow-hidden w-full transition-all duration-300", isLocked && "blur-xl select-none pointer-events-none scale-98")}>
      {/* Global Impersonation Banner */}
      <AnimatePresence>
        {impersonationTenantId && (
          <motion.div 
            initial={{ y: -100 }}
            animate={{ y: 0 }}
            exit={{ y: -100 }}
            className="fixed top-0 left-0 right-0 z-[200] bg-warning text-white py-2 px-4 flex items-center justify-center gap-4 shadow-xl"
          >
            <div className="flex items-center gap-2 font-black text-sm">
              <AlertCircle size={18} />
              <span>أنت الآن في وضع الدعم الفني (Impersonation Mode)</span>
            </div>
            <div className="h-4 w-px bg-white/30 mx-2" />
            <span className="text-xs font-bold">المشترك الحالي: {tenantName}</span>
            <button 
              onClick={async () => {
                try {
                  const { data } = await supabase
                    .from('support_sessions')
                    .select('id, started_at')
                    .eq('tenant_id', impersonationTenantId!)
                    .is('ended_at', null)
                    .order('started_at', { ascending: false })
                    .limit(1)
                    .single();
                  
                  if (data) {
                    const started = new Date(data.started_at);
                    const ended = new Date();
                    const durationMins = Math.ceil((ended.getTime() - started.getTime()) / 60000);
                    
                    await supabase
                      .from('support_sessions')
                      .update({ ended_at: ended.toISOString(), duration_minutes: durationMins })
                      .eq('id', data.id);
                  }
                } catch (e) {
                  console.error('Error ending support session', e);
                }
                setImpersonationTenantId(null);
                window.location.href = '/admin/dashboard';
              }}
              className="bg-white text-warning px-4 py-1 rounded-full text-xs font-black hover:bg-white/90 transition-all ml-4"
            >
              إنهاء الجلسة والعودة للوحة SaaS
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Mobile Drawer Overlay */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-30 lg:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      {layoutMode === 'sidebar' && (
        <aside 
          id="tour-sidebar"
          data-tour="sidebar"
          className={cn(
            "bg-surface flex flex-col transition-all duration-300 z-40",
            isRtl ? "border-l border-border" : "border-r border-border",
            // Desktop behavior
            isCollapsed ? "lg:w-20" : "lg:w-64",
            // Mobile behavior
            isRtl 
              ? "fixed inset-y-0 right-0 lg:sticky lg:inset-y-0 lg:right-0 lg:left-auto transform" 
              : "fixed inset-y-0 left-0 lg:sticky lg:inset-y-0 lg:left-0 lg:right-auto transform",
            isMobileMenuOpen 
              ? "translate-x-0 w-64 max-w-[80vw] shadow-2xl" 
              : (isRtl ? "translate-x-full lg:translate-x-0" : "-translate-x-full lg:translate-x-0")
          )}
        >
        {/* Collapse Toggle - Desktop only */}
        <button 
          onClick={() => setIsCollapsed(!isCollapsed)}
          className={cn(
            "hidden lg:flex absolute top-10 bg-surface border border-border rounded-full p-1 shadow-sm hover:bg-surface-muted transition-colors z-20",
            isRtl ? "-left-3" : "-right-3"
          )}
        >
          {/* Reverse the chevron rotation/direction visually since the layout flow is RTL / LTR:
              When expanded (!isCollapsed), collapse moves towards the screen edge on the right under RTL, so we visually rotate the arrow to point right.
              When collapsed (isCollapsed), opening expands it to the left, so arrow points left. */}
          <ChevronLeft 
            size={16} 
            className={cn(
              "transition-transform duration-300", 
              isRtl 
                ? (!isCollapsed ? "rotate-180" : "") 
                : (isCollapsed ? "rotate-180" : "")
            )} 
          />
        </button>

        <div className={cn(
          "p-4 flex items-center border-b border-border min-h-[5.5rem] relative",
          isCollapsed && !isMobileMenuOpen ? "justify-center" : "justify-center w-full"
        )}>
          {tenantLogo ? (
            <div className="flex items-center justify-center gap-3 w-full">
              <img src={tenantLogo} alt="Logo" className={cn(
                "rounded-xl object-cover shrink-0 shadow-sm transition-all duration-300",
                (isCollapsed && !isMobileMenuOpen) ? "w-10 h-10" : "w-[120px] h-[80px]"
              )} />
              {(!isCollapsed || isMobileMenuOpen) && <h1 className="text-xl font-bold text-content truncate hidden">{tenantName}</h1>}
            </div>
          ) : (
            <div className="flex justify-center items-center py-1 w-full overflow-hidden">
              <img 
                src="/Logo.svg" 
                alt="Seen Logo" 
                className={cn(
                  "object-contain shrink-0 transition-all duration-300",
                  (isCollapsed && !isMobileMenuOpen) ? "h-5 max-w-[24px] w-auto" : "w-[120px] h-[80px]"
                )} 
              />
            </div>
          )}
          
          {/* Close button for mobile */}
          <button 
            onClick={() => setIsMobileMenuOpen(false)}
            className="lg:hidden absolute left-4 top-1/2 -translate-y-1/2 p-2 hover:bg-surface-muted rounded-full"
          >
            <XIcon size={20} className="text-content-muted" />
          </button>
        </div>

        {currentStaff && (
          <div
            id="tour-user-menu"
            data-tour="user-menu"
            className={cn(
            "px-4 py-4 border-b border-border hidden lg:block",
            isCollapsed ? "lg:flex lg:justify-center" : ""
          )}>
            <UserPreferencesMenu
              currentStaff={currentStaff}
              role={effectiveRole || null}
              onLock={() => {
                if (onLock) onLock();
              }}
              onLogout={handleLogout}
              layoutMode={layoutMode}
              isCollapsed={isCollapsed}
              dropdownPosition="bottom"
              onToggleLayout={toggleLayoutMode}
            />
          </div>
        )}

        <nav className="flex-1 p-4 space-y-2 overflow-y-auto overflow-x-hidden">
          {navItems.map((item) => {
            let tourId: string | undefined = undefined;
            if (item.to === '/dashboard') tourId = 'tour-dashboard-nav';
            else if (item.to === '/sales') tourId = 'tour-pos-nav';
            else if (item.to === '/orders') tourId = 'tour-orders-nav';
            else if (item.to === '/customers') tourId = 'tour-customers-nav';
            else if (item.to === '/inventory') tourId = 'tour-inventory-nav';
            else if (item.to === '/suppliers') tourId = 'tour-suppliers-nav';
            else if (item.to === '/reports') tourId = 'tour-reports-nav';
            else if (item.to === '/settings') tourId = 'tour-settings-nav';

            return (
              <NavLink
                key={item.to}
                to={item.to}
                id={tourId}
                data-tour={tourId ? tourId.replace('tour-', '') : undefined}
                onClick={() => setIsMobileMenuOpen(false)}
                className={({ isActive }) => cn(
                  "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group relative",
                  (isActive || (item.to === '/dashboard' && location.pathname === '/'))
                    ? "bg-brand/10 text-brand font-medium" 
                    : "text-content-muted hover:bg-surface-muted hover:text-content",
                  isCollapsed && "lg:justify-center lg:px-0"
                )}
              >
                {({ isActive }) => (
                  <>
                    <item.icon size={20} className={cn("shrink-0", !isActive && "group-hover:scale-110 transition-transform")} />
                    {(!isCollapsed || isMobileMenuOpen) && <span className="truncate">{item.label}</span>}
                    
                    {/* Tooltip for collapsed state */}
                    {isCollapsed && (
                      <div className="hidden lg:block absolute right-full mr-2 px-2 py-1 bg-brand text-white text-[10px] rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50 shadow-lg">
                        {item.label}
                      </div>
                    )}
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border mt-auto hidden lg:block">
        </div>
      </aside>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {/* Mobile Header (Fixed Top Bar) */}
        {layoutMode === 'sidebar' && (
          <header className="lg:hidden fixed top-0 left-0 right-0 h-20 bg-surface/90 backdrop-blur-xl border-b border-border/60 flex items-center justify-between px-4 sm:px-6 shrink-0 z-40 shadow-[0_8px_30px_rgb(0,0,0,0.02)]" dir={isRtl ? 'rtl' : 'ltr'}>
            <div className="flex items-center gap-3">
              <button
                id="tour-mobile-menu-btn"
                data-tour="mobile-menu-btn"
                onClick={() => setIsMobileMenuOpen(true)}
                className="p-2.5 bg-surface-muted hover:bg-border/60 text-content rounded-2xl transition-all active:scale-95 border border-border/40 flex items-center justify-center shadow-sm cursor-pointer"
              >
                <Menu size={22} />
              </button>
              
              <div className="flex items-center gap-2.5">
                {tenantLogo ? (
                  <img src={tenantLogo} alt="Logo" className="w-10 h-10 rounded-2xl object-cover border border-border/60 shadow-sm shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded-2xl bg-brand/10 text-brand flex items-center justify-center font-black text-sm border border-brand/20 shadow-sm shrink-0">
                    {tenantName?.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="flex flex-col text-right rtl:text-right ltr:text-left">
                  <span className="font-black text-content truncate max-w-[150px] text-sm leading-tight">{tenantName}</span>
                  <div className="flex items-center gap-1.5 mt-0.5 justify-start rtl:justify-start ltr:justify-start">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_6px_rgba(16,185,129,0.5)]" />
                    <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-wider leading-none">
                      {t('common.active', 'نشط')}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <div className={cn("hidden sm:flex flex-col", isRtl ? "items-start ml-2" : "items-end mr-2")}>
                <span className="text-xs font-black text-content leading-none">{currentStaff?.name || 'User'}</span>
                <span className="text-[10px] font-bold text-content-muted uppercase tracking-tighter mt-1">
                  {currentStaff?.role === 'owner' 
                    ? t('common.roles.owner', 'مالك') 
                    : currentStaff?.role === 'cashier' 
                      ? t('common.roles.cashier', 'كاشير') 
                      : t('common.roles.tailor', 'خياط')}
                </span>
              </div>
              
              <div id="tour-user-menu-mobile" data-tour="user-menu-mobile">
                <UserPreferencesMenu
                  currentStaff={currentStaff}
                  role={effectiveRole || null}
                  onLock={() => {
                    if (onLock) onLock();
                  }}
                  onLogout={handleLogout}
                  layoutMode={layoutMode}
                  isCollapsed={true}
                  dropdownPosition="bottom"
                  align={isRtl ? 'left' : 'right'}
                  onToggleLayout={toggleLayoutMode}
                  className="shadow-sm"
                />
              </div>
            </div>
          </header>
        )}

        {/* Top Header for Grid Mode */}
        {layoutMode === 'grid' && (
          <header className="h-20 bg-surface border-b border-border flex items-center justify-between px-6 shrink-0">
            <div className="flex items-center gap-4">
              {tenantLogo ? (
                <>
                  <img src={tenantLogo} alt="Logo" className="h-10 md:h-12 lg:h-14 w-auto rounded-lg object-cover shadow-sm" />
                  <h1 className="text-lg font-bold text-content">{tenantName}</h1>
                </>
              ) : (
                <img src="/Logo.svg" alt="Seen Logo" className="h-6 md:h-7 lg:h-8 w-auto object-contain shrink-0 max-h-8" />
              )}
            </div>
            
            <div className="flex items-center gap-3">
              {location.pathname !== '/' && (
                <button
                  onClick={() => navigate('/')}
                  className="flex items-center gap-2 px-4 py-2 bg-surface-muted hover:bg-border text-content rounded-xl transition-all font-medium text-sm"
                >
                  <LayoutGrid size={18} />
                  {t('common.home', 'الرئيسية')}
                </button>
              )}
              
              <div id="tour-user-menu-grid" data-tour="user-menu-grid">
                <UserPreferencesMenu
                  currentStaff={currentStaff}
                  role={effectiveRole || null}
                  onLock={() => {
                    if (onLock) onLock();
                  }}
                  onLogout={handleLogout}
                  layoutMode={layoutMode}
                  onToggleLayout={toggleLayoutMode}
                />
              </div>
            </div>
          </header>
        )}

        <main 
          id="tour-dashboard-container"
          data-tour="dashboard-container"
          className={cn(
          "flex-1 overflow-x-hidden flex flex-col",
          layoutMode === 'sidebar' ? "mt-20 lg:mt-0" : "", // Add margin for fixed mobile header only in sidebar mode
          layoutMode === 'grid' && location.pathname === '/' ? "p-4 md:p-8" : "p-4 md:p-8"
        )}>
          {layoutMode === 'grid' && location.pathname === '/' ? (
            <div className="max-w-7xl mx-auto space-y-12 py-8 flex-1">
              <div className="text-center space-y-2">
                <h2 className="text-3xl sm:text-4xl font-black text-content">
                  {t('dashboard.welcome_to', `مرحباً بك في ${tenantName}`, { name: tenantName })}
                </h2>
                <p className="text-content-muted font-medium text-base sm:text-lg">
                  {t('dashboard.select_system', 'اختر النظام الذي تود إدارته')}
                </p>
              </div>
              
              <div id="tour-grid-launcher" data-tour="grid-launcher" className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-5 lg:gap-6">
                {navItems.filter(i => i.to !== '/').map(item => (
                  <button
                    key={item.to}
                    onClick={() => navigate(item.to)}
                    className="bg-surface p-4 sm:p-6 lg:p-8 rounded-2xl sm:rounded-3xl shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] hover:shadow-2xl hover:shadow-brand/10 hover:-translate-y-1 active:scale-95 active:translate-y-0 active:shadow-sm transition-all duration-300 flex flex-col items-center justify-center gap-3 sm:gap-4 lg:gap-5 group border border-border"
                  >
                    <div className="w-12 h-12 sm:w-16 sm:h-16 lg:w-20 lg:h-20 rounded-xl sm:rounded-2xl bg-brand/5 flex items-center justify-center text-brand transition-transform duration-300 group-hover:scale-110">
                      <item.icon className="w-6 h-6 sm:w-8 sm:h-8 lg:w-10 lg:h-10" strokeWidth={1.5} />
                    </div>
                    <span className="text-sm sm:text-base lg:text-xl font-bold text-content text-center">{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex-1">
              {children}
            </div>
          )}


        </main>
      </div>

      <SeenAIFab />

      <OnboardingTour
        role={effectiveRole}
        tenantId={tenantId}
        staffId={currentStaff?.id}
        staffName={currentStaff?.name}
        tenantName={tenantName}
        tenantLogo={tenantLogo}
        hasPermission={tourHasPermission}
        navRoutes={tourNavRoutes}
        ready={!permissionsLoading && !isActingAsSaaS}
      />

      {tenantId && <SupportConsentModal tenantId={tenantId} />}
    </div>
  );
}
