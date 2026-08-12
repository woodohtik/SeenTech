import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Shield, 
  ShieldCheck,
  Users, 
  BarChart3, 
  Settings, 
  LogOut, 
  ChevronRight, 
  Search, 
  Bell, 
  User,
  LayoutDashboard,
  Database,
  Zap,
  Globe,
  AlertCircle,
  DollarSign,
  X,
  ExternalLink,
  Clock,
  CheckCircle2,
  Lock,
  Eye,
  EyeOff,
  Loader2
} from 'lucide-react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { auth } from '../lib/firebase';
import { signOut, updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { cn } from '../lib/utils';
import { logSaaSSecurityEvent } from '../services/saasSecurityService';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase/client';
import { useTranslation } from 'react-i18next';
import UserPreferencesMenu from './UserPreferencesMenu';

import { AdminIconInput } from './ui/AdminIconInput';

import { isRtlLang, localeOf } from '../lib/direction';

interface SaaSLayoutProps {
  children: React.ReactNode;
  userRole: string | null;
}

interface SaaSNotification {
  id: string;
  type: 'new_tenant' | 'trial_expiring';
  title: string;
  message: string;
  date: string;
  read: boolean;
  tenantId: string;
}

const SAAS_MENU_ITEMS = [
  { id: 'overview', labelKey: 'saas.menu_overview', icon: LayoutDashboard, path: '/admin/dashboard', roles: ['super_admin', 'support_tech', 'billing_admin', 'sales'] },
  { id: 'tenants', labelKey: 'saas.menu_tenants', icon: Users, path: '/admin/tailors', roles: ['super_admin', 'support_tech', 'billing_admin', 'sales'] },
  { id: 'roles', labelKey: 'saas.menu_roles', icon: ShieldCheck, path: '/admin/roles', roles: ['super_admin'] },
  { id: 'reports', labelKey: 'saas.menu_reports', icon: BarChart3, path: '/admin/reports', roles: ['super_admin', 'billing_admin', 'sales'] },
  { id: 'withdrawals', labelKey: 'saas.menu_withdrawals', icon: DollarSign, path: '/admin/withdrawals', roles: ['super_admin', 'billing_admin'] },
  { id: 'audit', labelKey: 'saas.menu_audit', icon: Shield, path: '/admin/audit', roles: ['super_admin'] },
  { id: 'team', labelKey: 'saas.menu_team', icon: Users, path: '/admin/team', roles: ['super_admin'] },
  { id: 'system', labelKey: 'saas.menu_system', icon: Settings, path: '/admin/system', roles: ['super_admin'] },
];

export default function SaaSLayout({ children, userRole }: SaaSLayoutProps) {
  const { t, i18n } = useTranslation();
  const isRtl = isRtlLang(i18n.language);

  const navigate = useNavigate();
  const location = useLocation();
  const { impersonationTenantId, setImpersonationTenantId, dbUser } = useAuth();
  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth > 1024);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 1024);
  const [impersonatedTenantName, setImpersonatedTenantName] = useState<string | null>(null);

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 1024;
      setIsMobile(mobile);
      if (!mobile && !isSidebarOpen) {
        // Option: expand sidebar automatically on desktop, or let it stay collapsed.
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isSidebarOpen]);
  
  const [notifications, setNotifications] = useState<SaaSNotification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const notificationsRef = useRef<HTMLDivElement>(null);

  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [checkingTempPassword, setCheckingTempPassword] = useState(true);

  useEffect(() => {
    const checkTempPasswordStatus = async () => {
      if (!auth || !auth.currentUser) return;
      try {
        const { data } = await supabase
          .from('saas_settings')
          .select('*')
          .eq('key', 'temp_passwords')
          .maybeSingle();

        if (data && data.value && typeof data.value === 'object') {
          const tempPasswords = data.value as Record<string, boolean>;
          if (auth.currentUser && tempPasswords[auth.currentUser.uid]) {
            setMustChangePassword(true);
          }
        }
      } catch (err) {
        console.error('Error checking temp password status:', err);
      } finally {
        setCheckingTempPassword(false);
      }
    };
    checkTempPasswordStatus();
  }, [dbUser]);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passError, setPassError] = useState<string | null>(null);
  const [passSubmitting, setPassSubmitting] = useState(false);
  const [showCurrentPass, setShowCurrentPass] = useState(false);
  const [showPass1, setShowPass1] = useState(false);
  const [showPass2, setShowPass2] = useState(false);

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassError(null);

    if (!currentPassword) {
      setPassError(t('saas.current_password_required'));
      return;
    }

    if (newPassword.length < 6) {
      setPassError(t('saas.password_too_short'));
      return;
    }

    if (newPassword !== confirmPassword) {
      setPassError(t('saas.passwords_do_not_match'));
      return;
    }

    setPassSubmitting(true);
    try {
      if (!auth.currentUser) throw new Error("No user logged in");
      if (!auth.currentUser.email) throw new Error("User email is not available");

      // Re-authenticate user first using EmailAuthProvider to prevent auth/requires-recent-login
      const credential = EmailAuthProvider.credential(auth.currentUser.email, currentPassword);
      await reauthenticateWithCredential(auth.currentUser, credential);

      // Get token first before changing password (so it's valid)
      const token = await auth.currentUser.getIdToken(true);

      // Call server endpoint to remove from saas_settings temp_passwords list
      const response = await fetch('/api/saas/complete-temp-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to complete password setup');
      }

      // Update in Firebase Auth
      await updatePassword(auth.currentUser, newPassword);

      setMustChangePassword(false);
      // Log security event
      await logSaaSSecurityEvent('saas_password_changed', 'User successfully replaced temporary password');
    } catch (err: any) {
      console.error(err);
      let errorMsg = err.message || t('saas.error_updating_password');
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        errorMsg = t('saas.wrong_current_password');
      }
      setPassError(errorMsg);
    } finally {
      setPassSubmitting(false);
    }
  };

  // 1. Session Timeout Logic (Idle Timeout)
  const IDLE_TIMEOUT = 15 * 60 * 1000; // 15 minutes
  const [lastActivity, setLastActivity] = useState(Date.now());

  const handleLogout = useCallback(async () => {
    await logSaaSSecurityEvent('saas_logout', 'User logged out or session timed out');
    try {
      localStorage.clear();
      sessionStorage.clear();
      await signOut(auth);
    } catch (e) {
      console.error(e);
    }
    window.location.replace('/login');
  }, [navigate]);

  useEffect(() => {
    const handleActivity = () => setLastActivity(Date.now());
    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('keydown', handleActivity);
    window.addEventListener('scroll', handleActivity);

    const interval = setInterval(() => {
      if (Date.now() - lastActivity > IDLE_TIMEOUT) {
        handleLogout();
      }
    }, 60000); // Check every minute

    return () => {
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('scroll', handleActivity);
      clearInterval(interval);
    };
  }, [lastActivity, handleLogout]);

  // 2. 2FA Verification Check (Removed per user request)

  // 3. Impersonation Check (Fetch names)
  useEffect(() => {
    const fetchTenantName = async () => {
      if (impersonationTenantId) {
        try {
          const { data } = await supabase
            .from('tenants')
            .select('name')
            .eq('id', impersonationTenantId)
            .single();
          if (data) setImpersonatedTenantName(data.name);
        } catch (error) {
          console.error("Error fetching impersonated tenant name:", error);
          setImpersonatedTenantName('Tenant Profile');
        }
      } else {
        setImpersonatedTenantName(null);
      }
    };
    fetchTenantName();
  }, [impersonationTenantId]);

  // Notifications Fetching Logic
  useEffect(() => {
    const fetchNotifications = async () => {
      try {
        const { data: tenantsData, error: tenantsError } = await supabase
          .from('tenants')
          .select('*');

        if (tenantsError) throw tenantsError;

        const { data: plansData } = await supabase
          .from('plans')
          .select('*');

        const newAlerts: SaaSNotification[] = [];
        const now = new Date();

        tenantsData?.forEach(tenant => {
          const createdAt = new Date(tenant.created_at || new Date());
          const diffDays = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
          
          // New Tenant Alert (within last 3 days)
          if (diffDays <= 3) {
            newAlerts.push({
              id: `new-${tenant.id}`,
              type: 'new_tenant',
              title: t('saas.notif_new_tenant_title'),
              message: t('saas.notif_new_tenant_msg', { name: tenant.name }),
              date: createdAt.toISOString(),
              read: false,
              tenantId: tenant.id
            });
          }

          // Trial Expiration Alert
          const plan = plansData?.find(p => p.id === tenant.plan_id);
          const isTrial = tenant.plan_id === 'free' || 
                          (!plan && tenant.plan_id !== 'basic') || 
                          (plan && plan.price === 0) || 
                          (tenant.plan_id && typeof tenant.plan_id === 'string' && tenant.plan_id.includes('trial'));
          
          if (tenant.status === 'active' || tenant.status === 'onboarding') {
            const durationDays = isTrial ? 14 : 365;
            const daysLeft = durationDays - diffDays;
            
            if (daysLeft >= 0 && daysLeft <= (isTrial ? 3 : 7)) {
              newAlerts.push({
                id: `sub-${tenant.id}`,
                type: 'trial_expiring',
                title: isTrial ? t('saas.notif_trial_expiring_title') : t('saas.notif_subscription_expiring_title'),
                message: isTrial
                  ? t('saas.notif_trial_expiring_msg', { name: tenant.name, days: daysLeft })
                  : t('saas.notif_subscription_expiring_msg', { plan: plan?.name || t('saas.plan_basic_default'), name: tenant.name, days: daysLeft }),
                date: new Date(now.getTime() - Math.random() * 86400000).toISOString(),
                read: false,
                tenantId: tenant.id
              });
            }
          }
        });

        // Sort by date DESC
        newAlerts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        
        // Mock checking "read" status from a local storage for simple MVP
        const readNotifs = JSON.parse(localStorage.getItem('saas_read_notifications') || '[]');
        const updatedAlerts = newAlerts.map(alert => ({
          ...alert,
          read: readNotifs.includes(alert.id)
        }));

        setNotifications(updatedAlerts);
        setUnreadCount(updatedAlerts.filter(n => !n.read).length);

      } catch (err) {
        console.warn('Error fetching notifications:', err);
      }
    };

    if (userRole === 'super_admin' || userRole === 'support_tech') {
      fetchNotifications();
      // Optionally mock realtime updates
      const interval = setInterval(fetchNotifications, 5 * 60 * 1000);
      return () => clearInterval(interval);
    }
  }, [userRole, i18n.language]);

  // Click outside to close notifications
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (notificationsRef.current && !notificationsRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const markAllAsRead = () => {
    const allIds = notifications.map(n => n.id);
    localStorage.setItem('saas_read_notifications', JSON.stringify(allIds));
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    setUnreadCount(0);
  };

  const markAsRead = (id: string) => {
    const readNotifs = JSON.parse(localStorage.getItem('saas_read_notifications') || '[]');
    if (!readNotifs.includes(id)) {
      readNotifs.push(id);
      localStorage.setItem('saas_read_notifications', JSON.stringify(readNotifs));
    }
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    setUnreadCount(prev => Math.max(0, prev - 1));
  };

  const stopImpersonation = () => {
    setImpersonationTenantId(null);
    window.location.href = '/admin/dashboard';
  };

  const getRoleLabel = (role: string | null) => {
    switch (role) {
      case 'super_admin': return t('saas.role_super_admin', 'المدير العام');
      case 'support_tech': return t('saas.role_support_tech', 'فريق الدعم الفني');
      case 'billing_admin': return t('saas.role_billing_admin', 'فريق المبيعات والمحاسبة');
      default: return 'SaaS Staff';
    }
  };

  return (
    <div className="h-screen w-full overflow-hidden bg-background flex font-sans" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Impersonation Banner */}
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
              <span>{t('common.support_mode_desc')}</span>
            </div>
            <div className="h-4 w-px bg-white/30 mx-2" />
            <span className="text-xs font-bold">{t('common.current_subscriber')}: {impersonatedTenantName || impersonationTenantId}</span>
            <button 
              onClick={stopImpersonation}
              className="bg-white text-warning px-4 py-1 rounded-full text-xs font-black hover:bg-white/90 transition-all ml-4"
            >
              {t('common.end_impersonation')}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sidebar Overlay for mobile */}
      <AnimatePresence>
        {isSidebarOpen && isMobile && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-30 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <motion.aside 
        initial={false}
        animate={{ 
          width: (isMobile || isSidebarOpen) ? 280 : 80,
          x: (isMobile && !isSidebarOpen) ? (isRtl ? 280 : -280) : 0
        }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className={cn(
          "bg-surface border-l rtl:border-l ltr:border-r border-border shadow-2xl shadow-brand/5 relative z-40 flex flex-col h-screen sticky top-0",
          isMobile && cn("fixed inset-y-0 z-40", isRtl ? "right-0" : "left-0")
        )}
      >
        {/* Sidebar Header */}
        <div className={cn("p-6 flex items-center", (isSidebarOpen || isMobile) ? "gap-4" : "justify-center px-0")}>
          <div className="w-10 h-10 bg-brand rounded-xl flex items-center justify-center shadow-lg shadow-brand/20 shrink-0">
            <Shield className="text-white" size={24} />
          </div>
          {(isSidebarOpen || isMobile) && (
            <div className="overflow-hidden whitespace-nowrap">
              <h1 className="text-lg font-black text-content">Seen</h1>
              <p className="text-[10px] text-content-muted font-black uppercase tracking-widest">SaaS Management</p>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto">
          {SAAS_MENU_ITEMS.filter(item => {
            if (!userRole) return false;
            const isOwnerEquivalent = userRole === 'owner' || userRole === 'super_admin';
            return item.roles.includes(userRole) || (isOwnerEquivalent && item.roles.includes('super_admin'));
          }).map((item) => {
            const isActive = location.pathname === item.path;
            
            return (
              <Link 
                key={item.id}
                to={item.path}
                onClick={() => isMobile && setIsSidebarOpen(false)}
                className={cn(
                  "flex items-center rounded-2xl transition-all group relative",
                  (isSidebarOpen || isMobile) ? "gap-4 p-4" : "justify-center p-4",
                  isActive ? "bg-brand text-white shadow-xl shadow-brand/20" : "text-content-muted hover:bg-surface-muted hover:text-brand"
                )}
              >
                <item.icon size={24} className={cn("shrink-0", isActive ? "text-white" : "group-hover:scale-110 transition-transform")} />
                {(isSidebarOpen || isMobile) && <span className="font-bold text-sm truncate">{t(item.labelKey)}</span>}
                {(!isSidebarOpen && !isMobile) && isActive && (
                  <div className="absolute right-0 ltr:right-auto ltr:left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-brand rounded-l-full ltr:rounded-r-full" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Sidebar Footer */}
        <div className="p-4 border-t border-border">
          <button 
            onClick={handleLogout}
            className={cn(
              "w-full flex items-center rounded-2xl text-danger hover:bg-danger/10 transition-all font-bold text-sm",
              (isSidebarOpen || isMobile) ? "gap-4 p-4" : "justify-center p-4"
            )}
          >
            <LogOut size={24} className="shrink-0" />
            {(isSidebarOpen || isMobile) && <span>{t('saas.logout', 'تسجيل الخروج')}</span>}
          </button>
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Header */}
        <header className="h-20 bg-surface border-b border-border px-8 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 hover:bg-surface-muted rounded-xl transition-all text-content-muted animate-none"
            >
              <ChevronRight size={24} className={cn("transition-transform", (!isSidebarOpen ? isRtl : !isRtl) && "rotate-180")} />
            </button>
            <div className="h-8 w-px bg-border mx-2" />
            <div className="flex flex-col">
              <span className="text-sm font-black text-content">{t('common.welcome_user', { name: dbUser?.display_name || auth?.currentUser?.displayName || t('common.support_engineer') })}</span>
              <span className="text-[10px] font-bold text-brand">{getRoleLabel(userRole)}</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden md:block w-64">
              <AdminIconInput 
                type="text"
                placeholder={t('saas.quick_search', 'بحث سريع...')}
                startIcon={Search}
                className="rounded-2xl"
              />
            </div>

            {/* Language Preferences */}
            <UserPreferencesMenu role={userRole} dropdownPosition="bottom" />

            <div className="relative" ref={notificationsRef}>
              <button 
                onClick={() => setShowNotifications(!showNotifications)}
                className="p-3 bg-surface-muted text-content-muted rounded-2xl hover:bg-surface transition-all relative"
              >
                <Bell size={20} />
                {unreadCount > 0 && (
                  <span className="absolute top-2 left-2 w-4 h-4 bg-danger text-white text-[10px] font-black rounded-full border-2 border-surface flex items-center justify-center">
                    {unreadCount > 9 ? '+9' : unreadCount}
                  </span>
                )}
              </button>

              <AnimatePresence>
                {showNotifications && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    transition={{ duration: 0.2 }}
                    className={cn(
                      "absolute mt-2 w-96 bg-surface border border-border rounded-3xl shadow-2xl z-50 overflow-hidden",
                      isRtl ? "left-0" : "right-0"
                    )}
                  >
                    <div className="p-4 border-b border-border flex items-center justify-between bg-surface-muted/30">
                      <h3 className="font-black text-content">{t('saas.notifications', 'التنبيهات')} ({unreadCount})</h3>
                      {unreadCount > 0 && (
                        <button 
                          onClick={markAllAsRead}
                          className="text-xs text-brand font-bold hover:underline"
                        >
                          {t('saas.mark_all_read', 'تحديد الكل كمقروء')}
                        </button>
                      )}
                    </div>
                    
                    <div className="max-h-[400px] overflow-y-auto">
                      {notifications.length === 0 ? (
                        <div className="p-8 text-center text-content-muted">
                          <Bell size={32} className="mx-auto mb-3 opacity-20" />
                          <p className="font-bold">{t('saas.no_notifications', 'لا توجد تنبيهات حالياً')}</p>
                        </div>
                      ) : (
                        <div className="divide-y divide-border">
                          {notifications.map((notif) => (
                            <div 
                              key={notif.id}
                              onClick={() => markAsRead(notif.id)}
                              className={cn(
                                "p-4 hover:bg-surface-muted/50 transition-colors cursor-pointer flex gap-4",
                                !notif.read && "bg-brand/5"
                              )}
                            >
                              <div className={cn(
                                "w-10 h-10 rounded-full flex items-center justify-center shrink-0 shadow-sm",
                                notif.type === 'new_tenant' ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
                              )}>
                                {notif.type === 'new_tenant' ? <User size={18} /> : <Clock size={18} />}
                              </div>
                              <div className="flex-1 space-y-1">
                                <h4 className={cn("font-bold text-sm", notif.read ? "text-content" : "text-brand")}>
                                  {notif.title}
                                </h4>
                                <p className="text-xs text-content-muted font-medium line-clamp-2 leading-relaxed">
                                  {notif.message}
                                </p>
                                <span className="text-[10px] text-content-muted font-bold pt-1 block opacity-75">
                                  {new Date(notif.date).toLocaleDateString(localeOf(i18n.language), { 
                                    month: 'short', 
                                    day: 'numeric', 
                                    hour: '2-digit', 
                                    minute: '2-digit' 
                                  })}
                                </span>
                              </div>
                              {!notif.read && (
                                <div className="shrink-0 flex items-center justify-center">
                                  <div className="w-2 h-2 rounded-full bg-brand" />
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="p-3 border-t border-border bg-surface-muted/30 text-center">
                      <Link to="/admin/dashboard" onClick={() => setShowNotifications(false)} className="text-xs font-black text-content hover:text-brand transition-colors">
                        {t('saas.view_dashboard', 'عرض لوحة التحكم')}
                      </Link>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <div className="w-10 h-10 bg-brand/10 text-brand rounded-2xl flex items-center justify-center font-black shadow-sm">
              {auth?.currentUser?.displayName?.charAt(0) || 'A'}
            </div>
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 overflow-y-auto p-8">
          <div className={cn("max-w-7xl mx-auto", impersonationTenantId && "mt-12")}>
            {children}
          </div>
        </div>
      </main>

      <AnimatePresence>
        {mustChangePassword && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" dir={isRtl ? 'rtl' : 'ltr'}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className={cn("w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden border border-gray-100", isRtl ? "text-right" : "text-left")}
            >
              <div className="p-8 text-center bg-brand/5 border-b border-brand/10">
                <div className="w-16 h-16 bg-brand/10 text-brand rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Lock size={32} />
                </div>
                <h2 className="text-2xl font-black text-gray-900 tracking-tight">{t('saas.set_new_password_title')}</h2>
                <p className="text-sm text-gray-500 font-medium mt-1 leading-relaxed">
                  {t('saas.set_new_password_desc')}
                </p>
              </div>

              <form onSubmit={handleUpdatePassword} className="p-8 space-y-6">
                {passError && (
                  <div className="p-4 bg-red-50 border border-red-100 rounded-2xl flex gap-3 text-red-600 text-sm font-medium">
                    <AlertCircle className="shrink-0" size={20} />
                    <span>{passError}</span>
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-xs font-black text-gray-700 block">{t('saas.current_temp_password')}</label>
                  <div className="relative">
                    <input
                      type={showCurrentPass ? "text" : "password"}
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      required
                      className="w-full h-12 px-4 pr-10 rounded-2xl border border-gray-200 focus:border-brand focus:ring-2 focus:ring-brand/10 outline-none transition-all font-bold text-gray-900"
                      placeholder="••••••••"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                      <Lock size={18} />
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowCurrentPass(!showCurrentPass)}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showCurrentPass ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-black text-gray-700 block">{t('saas.new_password')}</label>
                  <div className="relative">
                    <input
                      type={showPass1 ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                      className="w-full h-12 px-4 pr-10 rounded-2xl border border-gray-200 focus:border-brand focus:ring-2 focus:ring-brand/10 outline-none transition-all font-bold text-gray-900"
                      placeholder="••••••••"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                      <Lock size={18} />
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowPass1(!showPass1)}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showPass1 ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-black text-gray-700 block">{t('saas.confirm_new_password')}</label>
                  <div className="relative">
                    <input
                      type={showPass2 ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      className="w-full h-12 px-4 pr-10 rounded-2xl border border-gray-200 focus:border-brand focus:ring-2 focus:ring-brand/10 outline-none transition-all font-bold text-gray-900"
                      placeholder="••••••••"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                      <Lock size={18} />
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowPass2(!showPass2)}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showPass2 ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={passSubmitting}
                  className="w-full h-12 bg-brand text-white font-bold rounded-2xl hover:bg-brand/95 transition-all flex items-center justify-center gap-2 shadow-lg shadow-brand/10 disabled:opacity-50 cursor-pointer"
                >
                  {passSubmitting ? (
                    <>
                      <Loader2 className="animate-spin" size={20} />
                      <span>{t('common.saving')}</span>
                    </>
                  ) : (
                    <span>{t('saas.save_password_and_login')}</span>
                  )}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
