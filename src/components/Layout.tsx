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
import { usePermissions } from '../hooks/usePermissions';
import Branding from './Branding';
import UserPreferencesMenu from './UserPreferencesMenu';

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
  }, [tenantId, t, currentStaff?.id, role]);

  const toggleLayoutMode = () => {
    const newMode = layoutMode === 'sidebar' ? 'grid' : 'sidebar';
    setLayoutMode(newMode);
    if (tenantId) {
      localStorage.setItem(`layoutMode_${tenantId}_${currentStaff?.id || role}`, newMode);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    navigate('/login');
  };

  const isSuperAdmin = role === 'super_admin';
  const isSupportTech = role === 'support_tech';
  const isBillingAdmin = role === 'billing_admin';
  const isSaaSStaff = isSuperAdmin || isSupportTech || isBillingAdmin;
  const isOwner = role === 'owner';
  const isCashier = role === 'cashier';
  const isTailor = role === 'tailor';

  const effectiveRole = currentStaff?.role || role;

  const { hasPermission } = usePermissions(currentStaff);

  const navItems = [
    // SaaS Level Navigation
    ...(isSaaSStaff ? [
      { to: '/admin/dashboard', icon: LayoutDashboard, label: t('sidebar.saas_dashboard'), roles: ['super_admin', 'support_tech', 'billing_admin'] },
      { to: '/admin/tailors', icon: Users, label: t('sidebar.manage_subscribers'), roles: ['super_admin', 'support_tech'] }
    ] : []),
    
    // Tenant Level Navigation
    ...(!isSaaSStaff ? [
      { to: '/dashboard', icon: Home, label: t('common.dashboard'), permission: 'dashboard.view' },
      { to: '/sales', icon: Monitor, label: t('common.sales', 'المبيعات'), permissions: ['orders.view', 'shifts.manage', 'orders.create'] },
      { to: '/customers', icon: UserCircle, label: t('common.customers'), permission: 'customers.view' },
      { to: '/orders', icon: ShoppingBag, label: t('common.orders'), permission: 'orders.view' },
      { to: '/inventory', icon: Package, label: t('common.inventory'), permission: 'inventory.view' },
      { to: '/suppliers', icon: Briefcase, label: t('common.suppliers', 'الموردين والمشتريات'), permission: 'suppliers.manage' },
      { to: '/reports', icon: BarChart3, label: t('common.reports'), permission: 'reports.view' },
    ] : []),
    
    { to: '/settings', icon: Settings, label: t('common.settings'), permission: 'settings.view' },
  ].filter(item => {
    if (isSaaSStaff) return !item.roles || item.roles.includes(effectiveRole as string);
    if (isOwner) return true;
    if (effectiveRole === 'admin' || effectiveRole === 'manager') return true; // Manager has full access to tenant items
    if (item.roles) return item.roles.includes(effectiveRole as string);
    if (item.permissions) return item.permissions.some(p => hasPermission(p as PermissionKey));
    if (item.permission) return hasPermission(item.permission as PermissionKey);
    return true;
  });

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
              onClick={() => {
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
            <div className="flex items-center gap-3 w-full">
              <img src={tenantLogo} alt="Logo" className="h-10 md:h-12 lg:h-14 w-auto rounded-xl object-cover shrink-0 shadow-sm" />
              {(!isCollapsed || isMobileMenuOpen) && <h1 className="text-xl font-bold text-content truncate">{tenantName}</h1>}
            </div>
          ) : (
            <div className="flex justify-center items-center py-1 w-full overflow-hidden">
              <img 
                src="/Logo.svg" 
                alt="Seen Logo" 
                className={cn(
                  "w-auto object-contain shrink-0 transition-all duration-300",
                  (isCollapsed && !isMobileMenuOpen) ? "h-5 max-w-[24px]" : "h-7 lg:h-8"
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
          <div className={cn(
            "px-4 py-4 border-b border-border",
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
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
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
          ))}
        </nav>

        <div className="p-4 border-t border-border mt-auto">
          <div className="lg:hidden mb-4">
            <UserPreferencesMenu
              currentStaff={currentStaff}
              role={effectiveRole || null}
              onLock={() => {
                if (onLock) onLock();
              }}
              onLogout={handleLogout}
              layoutMode={layoutMode}
              isCollapsed={false}
              dropdownPosition="top"
              onToggleLayout={toggleLayoutMode}
            />
          </div>
          <Branding 
            collapsed={isCollapsed && !isMobileMenuOpen} 
            className={cn("mt-2", (isCollapsed && !isMobileMenuOpen) ? "" : "justify-start px-4")} 
          />
        </div>
      </aside>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {/* Mobile Header (Fixed Top Bar) */}
        {layoutMode === 'sidebar' && (
          <header className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-[#1e1e2d] flex items-center justify-between px-4 shrink-0 z-40 shadow-lg" dir="ltr">
            <div className="flex items-center gap-3">
              <button 
                onClick={() => setIsMobileMenuOpen(true)}
                className="p-2 text-white hover:bg-white/10 rounded-xl transition-all active:scale-95"
              >
                <Menu size={24} />
              </button>
              <div className="flex flex-col">
                <span className="font-black text-white truncate max-w-[150px] text-sm leading-tight">{tenantName}</span>
                <span className="text-[9px] text-emerald-400 font-bold uppercase tracking-widest leading-none mt-0.5">POS System</span>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-end mr-1">
                <span className="text-[10px] font-black text-white/90 leading-none">{currentStaff?.name || 'User'}</span>
                <span className="text-[8px] font-bold text-white/50 uppercase tracking-tighter">Online</span>
              </div>
              <div className="w-10 h-10 rounded-full bg-white/11 border border-white/10 flex items-center justify-center text-xs font-black text-white shadow-sm overflow-hidden ring-2 ring-brand/20">
                {currentStaff?.name?.charAt(0).toUpperCase() || 'U'}
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
          </header>
        )}

        <main className={cn(
          "flex-1 overflow-x-hidden flex flex-col",
          "mt-16 lg:mt-0", // Add margin for fixed mobile header
          layoutMode === 'grid' && location.pathname === '/' ? "p-4 md:p-8" : "p-4 md:p-8"
        )}>
          {layoutMode === 'grid' && location.pathname === '/' ? (
            <div className="max-w-5xl mx-auto space-y-12 py-8 flex-1">
              <div className="text-center space-y-2">
                <h2 className="text-4xl font-black text-content">
                  {t('dashboard.welcome_to', `مرحباً بك في ${tenantName}`, { name: tenantName })}
                </h2>
                <p className="text-content-muted font-medium text-lg">
                  {t('dashboard.select_system', 'اختر النظام الذي تود إدارته')}
                </p>
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {navItems.filter(i => i.to !== '/' && i.to !== '/settings').map(item => (
                  <button
                    key={item.to}
                    onClick={() => navigate(item.to)}
                    className="bg-surface p-8 rounded-3xl shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] hover:shadow-2xl hover:shadow-brand/10 hover:-translate-y-1 active:scale-95 active:translate-y-0 active:shadow-sm transition-all duration-300 flex flex-col items-center justify-center gap-5 group border border-border"
                  >
                    <div className="w-20 h-20 rounded-2xl bg-brand/5 flex items-center justify-center text-brand transition-transform duration-300 group-hover:scale-110">
                      <item.icon size={40} strokeWidth={1.5} />
                    </div>
                    <span className="text-xl font-bold text-content">{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex-1">
              {children}
            </div>
          )}
          
          {/* Global Footer Branding */}
          <Branding className="mt-auto pt-8 pb-4 shrink-0 transition-opacity hover:opacity-100 opacity-90" />
        </main>
      </div>
    </div>
  );
}
