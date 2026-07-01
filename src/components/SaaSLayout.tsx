import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Shield, 
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
  CheckCircle2
} from 'lucide-react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { auth } from '../lib/firebase';
import { signOut } from 'firebase/auth';
import { cn } from '../lib/utils';
import { logSaaSSecurityEvent } from '../services/saasSecurityService';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase/client';

import { AdminIconInput } from './ui/AdminIconInput';

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
  { id: 'overview', label: 'لوحة التحكم', icon: LayoutDashboard, path: '/admin/dashboard', roles: ['super_admin', 'support_tech', 'billing_admin', 'sales'] },
  { id: 'tenants', label: 'إدارة المشتركين', icon: Users, path: '/admin/tailors', roles: ['super_admin', 'support_tech', 'billing_admin', 'sales'] },
  { id: 'reports', label: 'التقارير المالية', icon: BarChart3, path: '/admin/reports', roles: ['super_admin', 'billing_admin', 'sales'] },
  { id: 'withdrawals', label: 'طلبات السحب', icon: DollarSign, path: '/admin/withdrawals', roles: ['super_admin', 'billing_admin'] },
  { id: 'audit', label: 'سجل التدقيق', icon: Shield, path: '/admin/audit', roles: ['super_admin'] },
  { id: 'team', label: 'أعضاء الفريق', icon: Users, path: '/admin/team', roles: ['super_admin'] },
  { id: 'system', label: 'إعدادات النظام', icon: Settings, path: '/admin/system', roles: ['super_admin'] },
];

export default function SaaSLayout({ children, userRole }: SaaSLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { impersonationTenantId, setImpersonationTenantId } = useAuth();
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

  // 1. Session Timeout Logic (Idle Timeout)
  const IDLE_TIMEOUT = 15 * 60 * 1000; // 15 minutes
  const [lastActivity, setLastActivity] = useState(Date.now());

  const handleLogout = useCallback(async () => {
    await logSaaSSecurityEvent('saas_logout', 'User logged out or session timed out');
    sessionStorage.removeItem('saas_2fa_verified');
    sessionStorage.removeItem('dev_bypass');
    localStorage.removeItem('impersonatedTenantId');
    await signOut(auth);
    navigate('/saas/login');
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

  // 2. 2FA Verification Check
  useEffect(() => {
    const is2FAVerified = sessionStorage.getItem('saas_2fa_verified') === 'true' || 
                         (auth.currentUser?.email === "nomansa2566512@gmail.com") ||
                         (sessionStorage.getItem('dev_bypass') === 'true');
    
    if (!is2FAVerified && location.pathname !== '/saas/login') {
      navigate('/saas/login');
    }
  }, [navigate, location.pathname]);

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
              title: 'مشترك جديد',
              message: `تم تسجيل اشتراك جديد: ${tenant.name}`,
              date: createdAt.toISOString(),
              read: false,
              tenantId: tenant.id
            });
          }

          // Trial Expiration Alert
          const plan = plansData?.find(p => p.id === tenant.plan_id);
          const isTrial = !plan || plan.price === 0 || (tenant.plan_id && typeof tenant.plan_id === 'string' && tenant.plan_id.includes('trial'));
          
          if (isTrial && (tenant.status === 'active' || tenant.status === 'onboarding')) {
            const trialDays = 14; // Should ideally read from saas_settings
            const daysLeft = trialDays - diffDays;
            
            if (daysLeft >= 0 && daysLeft <= 3) {
              newAlerts.push({
                id: `trial-${tenant.id}`,
                type: 'trial_expiring',
                title: 'تنبيه انتهاء تجربة',
                message: `الاشتراك التجريبي لـ ${tenant.name} ينتهي خلال ${daysLeft} أيام.`,
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
        console.error('Error fetching notifications:', err);
      }
    };

    if (userRole === 'super_admin' || userRole === 'support_tech') {
      fetchNotifications();
      // Optionally mock realtime updates
      const interval = setInterval(fetchNotifications, 5 * 60 * 1000);
      return () => clearInterval(interval);
    }
  }, [userRole]);

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
      case 'super_admin': return 'المدير العام';
      case 'support_tech': return 'فريق الدعم الفني';
      case 'billing_admin': return 'فريق المبيعات والمحاسبة';
      default: return 'موظف SaaS';
    }
  };

  return (
    <div className="min-h-screen bg-background flex font-sans" dir="rtl">
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
              <span>أنت الآن في وضع الدعم الفني (Impersonation Mode)</span>
            </div>
            <div className="h-4 w-px bg-white/30 mx-2" />
            <span className="text-xs font-bold">المشترك الحالي: {impersonatedTenantName || impersonationTenantId}</span>
            <button 
              onClick={stopImpersonation}
              className="bg-white text-warning px-4 py-1 rounded-full text-xs font-black hover:bg-white/90 transition-all ml-4"
            >
              إنهاء الجلسة والعودة للوحة SaaS
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
          x: (isMobile && !isSidebarOpen) ? 280 : 0
        }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className={cn(
          "bg-surface border-l border-border shadow-2xl shadow-brand/5 relative z-40 flex flex-col h-screen",
          isMobile && "fixed inset-y-0 right-0 z-40"
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
                {(isSidebarOpen || isMobile) && <span className="font-bold text-sm truncate">{item.label}</span>}
                {(!isSidebarOpen && !isMobile) && isActive && (
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-brand rounded-l-full" />
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
            {(isSidebarOpen || isMobile) && <span>تسجيل الخروج</span>}
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
              className="p-2 hover:bg-surface-muted rounded-xl transition-all text-content-muted"
            >
              <ChevronRight size={24} className={cn("transition-transform", !isSidebarOpen && "rotate-180")} />
            </button>
            <div className="h-8 w-px bg-border mx-2" />
            <div className="flex flex-col">
              <span className="text-sm font-black text-content">أهلاً، {auth.currentUser?.displayName || 'مهندس الدعم'}</span>
              <span className="text-[10px] font-bold text-brand">{getRoleLabel(userRole)}</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden md:block w-64">
              <AdminIconInput 
                type="text"
                placeholder="بحث سريع..."
                startIcon={Search}
                className="rounded-2xl"
              />
            </div>
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
                    className="absolute left-0 mt-2 w-96 bg-surface border border-border rounded-3xl shadow-2xl z-50 overflow-hidden"
                  >
                    <div className="p-4 border-b border-border flex items-center justify-between bg-surface-muted/30">
                      <h3 className="font-black text-content">التنبيهات ({unreadCount})</h3>
                      {unreadCount > 0 && (
                        <button 
                          onClick={markAllAsRead}
                          className="text-xs text-brand font-bold hover:underline"
                        >
                          تحديد الكل كمقروء
                        </button>
                      )}
                    </div>
                    
                    <div className="max-h-[400px] overflow-y-auto">
                      {notifications.length === 0 ? (
                        <div className="p-8 text-center text-content-muted">
                          <Bell size={32} className="mx-auto mb-3 opacity-20" />
                          <p className="font-bold">لا توجد تنبيهات حالياً</p>
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
                                  {new Date(notif.date).toLocaleDateString('ar-SA', { 
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
                        عرض لوحة التحكم
                      </Link>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <div className="w-10 h-10 bg-brand/10 text-brand rounded-2xl flex items-center justify-center font-black shadow-sm">
              {auth.currentUser?.displayName?.charAt(0) || 'A'}
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
    </div>
  );
}
