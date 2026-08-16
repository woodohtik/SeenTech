import React, { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle, LogOut, AlertCircle, RefreshCw } from 'lucide-react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useParams
} from 'react-router-dom';
import OrderTracking from './components/public/OrderTracking';
import LandingPage from './components/LandingPage';

// صفحة تتبّع الطلب العامة للعميل النهائي (بلا مصادقة) — /track/:token
const TrackRoute = () => {
  const { token } = useParams();
  return <OrderTracking token={token || ''} />;
};

// توجيه تلقائي لصفحة الهبوط للزوار غير المسجلين
const LandingRedirect = () => {
  return <LandingPage />;
};
import { logError } from './lib/logger';
import { supabase } from './lib/supabase/client';
import { setGlobalCurrencySymbol } from './lib/utils';
import Layout from './components/Layout';
import LockScreen from './components/LockScreen';
import Login from './components/Login';
import { PermissionGuard } from './components/PermissionGuard';

// Helper for implementing React.lazy pre-fetching capability
const lazyWithPreload = <T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>
) => {
  const Component = React.lazy(factory);
  (Component as any).preload = factory;
  return Component as React.LazyExoticComponent<T> & { preload: () => Promise<{ default: T }> };
};

// Lazy loaded core tenant components with pre-fetching capability
const Dashboard = lazyWithPreload(() => import('./components/Dashboard'));
const Customers = lazyWithPreload(() => import('./components/Customers'));
const Orders = lazyWithPreload(() => import('./components/Orders'));

const Settings = React.lazy(() => import('./components/Settings'));
const Sales = React.lazy(() => import('./components/Sales'));
const Suppliers = React.lazy(() => import('./components/Suppliers'));
const InventoryManager = React.lazy(() => import('./components/Inventory/InventoryManager'));
const Reports = React.lazy(() => import('./components/Reports'));
const Onboarding = React.lazy(() => import('./components/Onboarding'));
const ResetPassword = React.lazy(() => import('./components/ResetPassword'));
const PublicInvoice = React.lazy(() => import('./pages/PublicInvoice'));

import PinLogin from './components/PinLogin';
import ForcePinSetup from './components/ForcePinSetup';
import StaffPinSetup from './components/StaffPinSetup';
import MainSkeleton from './components/MainSkeleton';
import PageSkeleton from './components/PageSkeleton';
import ErrorBoundary from './components/ErrorBoundary';
import { UserRole, Staff as StaffType } from './types';
import { autoSeed } from './services/seedService';
import { seedGlobalRoles } from './services/permissionService';
import { Tailor } from './types';
import { StaffProvider, useStaff } from './contexts/StaffContext';
import { BrandingProvider } from './contexts/BrandingContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { ToastProvider } from './contexts/ToastContext';
import { analytics, AnalyticsEvent } from './services/analyticsService';
import { useTranslation } from 'react-i18next';
import { useDirection, localeOf } from './lib/direction';

import SaaSLayout from './components/SaaSLayout';
import RoleGuard from './components/RoleGuard';
import ProtectedRoute from './components/ProtectedRoute';
import AccessDenied from './components/AccessDenied';

// Lazy loaded SaaS Super Admin components
const SuperAdminDashboard = React.lazy(() => import('./components/SuperAdminDashboard'));
const AdminTailors = React.lazy(() => import('./components/AdminTailors'));
const SaaSReports = React.lazy(() => import('./components/SaaSReports'));
const SaaSAuditLogs = React.lazy(() => import('./components/SaaSAuditLogs'));
const SaaSSystemSettings = React.lazy(() => import('./components/SaaSSystemSettings'));
const SaaSWithdrawals = React.lazy(() => import('./components/SaaSWithdrawals'));
import SaaSTeamManagement from './components/SaaSTeamManagement';
import TenantAnalyticsDashboard from './components/TenantAnalyticsDashboard';
import { RolePermissionsSettings } from './components/RolePermissionsSettings';

import { AuthProvider, useAuth } from './contexts/AuthContext';

type AccountIssueVariant = 'no_profile' | 'not_approved' | 'error';

/**
 * Every "authenticated but can't route you anywhere" case used to funnel
 * into a silent sign-out (StaleAccountRedirect, now removed): the user saw
 * a spinner, then landed back on /login with zero explanation. That made a
 * transient network blip indistinguishable from "your account is broken"
 * and a broken registration indistinguishable from "login doesn't work".
 * This always shows *something* concrete instead, with a retry path that
 * costs nothing when the cause was transient.
 */
function AccountIssueScreen({ variant, email, detail, onRetry, onLogout }: {
  variant: AccountIssueVariant;
  email: string | null | undefined;
  detail?: string | null;
  onRetry: () => void;
  onLogout: () => void;
}) {
  const { t } = useTranslation();
  const { dir, isRtl } = useDirection();
  const copy = {
    no_profile: { title: t('login.incomplete_account_title'), desc: t('login.incomplete_account_desc') },
    not_approved: { title: t('login.account_not_approved_title'), desc: t('login.account_not_approved_desc') },
    error: { title: t('login.account_check_failed_title'), desc: t('login.account_check_failed_desc') },
  }[variant];
  return (
    <div className={`min-h-screen flex items-center justify-center bg-gray-50 ${isRtl ? 'text-right' : 'text-left'} p-6 font-sans`} dir={dir}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-md w-full bg-white rounded-[2.5rem] shadow-2xl p-10 border border-amber-100 text-center relative overflow-hidden"
      >
        <div className="absolute top-0 right-0 w-32 h-32 bg-amber-50 rounded-full blur-3xl opacity-50 -mr-16 -mt-16" />
        <div className="w-20 h-20 bg-amber-50 text-amber-600 rounded-3xl flex items-center justify-center mx-auto mb-6 border border-amber-100">
          <AlertCircle size={40} />
        </div>
        <h2 className="text-2xl font-black text-gray-900 mb-3">{copy.title}</h2>
        <p className="text-gray-500 font-medium leading-relaxed mb-2 px-2 text-sm">
          {copy.desc}
        </p>
        {email && <p className="text-gray-400 font-mono text-xs mt-2">{email}</p>}
        {detail && <p className="text-gray-300 font-mono text-[10px] mt-1 break-all" dir="ltr">{detail}</p>}
        <div className="space-y-3 mt-8">
          <button
            onClick={onRetry}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-4 rounded-2xl font-bold transition-all shadow-lg shadow-indigo-600/10 flex items-center justify-center gap-2"
          >
            <RefreshCw size={18} />
            {t('common.retry')}
          </button>
          <button
            onClick={onLogout}
            className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 py-4 rounded-2xl font-bold transition-all flex items-center justify-center gap-2"
          >
            <LogOut size={18} />
            {t('common.logout_from_account')}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function AppContent() {
  const { t, i18n } = useTranslation();
  const { dir, isRtl } = useDirection();
  const { currentStaff, setCurrentStaff } = useStaff();
  const {
    user, isApproved, userRole, tenantId, onboardingStep, hasStaffWithPin, currentUserStaff, hasNoProfile, resolveError,
    loading, conflictUser, resolveConflict, rejectConflict, impersonationTenantId, logout, refreshDbUser,
  } = useAuth();

  // Desktop/Mobile viewport sync mode
  const [isDesktopView, setIsDesktopView] = useState<boolean>(() => {
    const saved = localStorage.getItem('desktop_view');
    if (saved === null) {
      return false; // Default to false so that mobile users get a beautifully adapted responsive layout by default
    }
    return saved === 'true';
  });

  useEffect(() => {
    const handleDesktopViewChange = (e: Event) => {
      const customEvent = e as CustomEvent;
      setIsDesktopView(customEvent.detail);
    };
    window.addEventListener('desktop-view-changed', handleDesktopViewChange);
    return () => window.removeEventListener('desktop-view-changed', handleDesktopViewChange);
  }, []);

  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    const root = document.documentElement;
    if (meta) {
      if (isDesktopView) {
        meta.setAttribute('content', 'width=1280, initial-scale=0.3, minimum-scale=0.1, maximum-scale=5.0, user-scalable=yes');
        root.classList.add('desktop-mode-active');
      } else {
        meta.setAttribute('content', 'width=device-width, initial-scale=1, viewport-fit=cover');
        root.classList.remove('desktop-mode-active');
      }
    }
  }, [isDesktopView]);

  useEffect(() => {
    if (impersonationTenantId && !currentStaff) {
      setCurrentStaff({
        id: 'super_admin_mock_id',
        name: t('saas.support_staff_name'),
        email: 'support@super.com',
        role: 'owner',
        tenantId: impersonationTenantId,
        permissions: {},
        branchId: 'all'
      } as any);
    } else if (!impersonationTenantId && currentStaff?.id === 'super_admin_mock_id') {
      setCurrentStaff(null);
    }
  }, [impersonationTenantId, currentStaff, setCurrentStaff]);

  const [isLocked, setIsLocked] = useState<boolean>(() => {
    return localStorage.getItem('pos_locked') === 'true';
  });

  useEffect(() => {
    localStorage.setItem('pos_locked', isLocked ? 'true' : 'false');
  }, [isLocked]);

  // Auto-login if the authenticated user has no PIN
  useEffect(() => {
    if (currentUserStaff && !currentStaff) {
      if (!currentUserStaff.pin) {
        setCurrentStaff(currentUserStaff as any);
      }
    }
  }, [currentUserStaff, currentStaff, setCurrentStaff]);

  // Prefetch core modules to reduce page transition latency when the user has completed login/auth setup
  useEffect(() => {
    if (user && isApproved) {
      // Run prefetching in the background 1500ms after user is verified & approved
      const timer = setTimeout(() => {
        console.log('[Prefetch] Pre-fetching core modules (Dashboard, Orders, Customers) in background...');
        Dashboard.preload().catch((err: any) => console.warn('[Prefetch] Dashboard prefetch failed:', err));
        Orders.preload().catch((err: any) => console.warn('[Prefetch] Orders prefetch failed:', err));
        Customers.preload().catch((err: any) => console.warn('[Prefetch] Customers prefetch failed:', err));
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [user, isApproved]);

  const handleResolveConflict = resolveConflict;
  const handleRejectConflict = rejectConflict;

  useEffect(() => {
    const dir = i18n.language === 'en' ? 'ltr' : 'rtl';
    document.documentElement.dir = dir;
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  useEffect(() => {
    if (!tenantId) return;
    
    const fetchTenantSettings = async () => {
      if (!tenantId) return;
      try {
        const { data: tenant, error } = await supabase
          .from('tenants')
          .select('currency')
          .eq('id', tenantId)
          .maybeSingle();

        if (tenant && !error) {
          setGlobalCurrencySymbol(tenant.currency || '﷼');
        }
      } catch (err) {
        console.warn("Failed to fetch tenant settings from Supabase:", err);
      }
    };

    fetchTenantSettings();
    // currentUserStaff gets a fresh reference every time AuthContext re-resolves
    // identity (including via window.refreshAuthData()), so it doubles as the
    // "re-fetch on auth refresh" trigger that a syncTrigger counter used to be.
  }, [tenantId, currentUserStaff]);

  // Auth-state resolution (device-session conflict, role, tenant, onboarding
  // step) is now entirely owned by AuthContext (see resolveIdentity there) —
  // this used to be a second, duplicate Firebase onIdTokenChanged listener.

  const onboardingCompletedLocal = localStorage.getItem('onboarding_completed') === 'true';
  const needsOnboarding = (user && isApproved && userRole === 'owner' && onboardingStep > 0 && onboardingStep < 4);
  const isTenantOwner = userRole === 'owner' || userRole === 'admin';
  
  // Security Checks
  const isSaaSStaff = userRole === 'super_admin' || 
                      (userRole === 'owner' && (tenantId === 'saas' || tenantId === 'super_admin')) || 
                      userRole === 'support_tech' || 
                      userRole === 'billing_admin' || 
                      userRole === 'sales';
  const effectiveTenantId = (isSaaSStaff && impersonationTenantId) ? impersonationTenantId : tenantId;
  
  const is2FAVerified = true;

  // Trial & Subscription Expiry Checks
  const tenant = (currentUserStaff as any)?.tenant;
  const tenantCreatedAt = tenant?.created_at;
  let isTrialExpired = false;
  let isSubscriptionExpired = false;

  if (user && !isSaaSStaff && tenant) {
    const now = new Date();
    
    // 1. Check if they have an active paid subscription (subscription_end_date is in the future)
    const subscriptionEndDate = tenant.subscription_end_date ? new Date(tenant.subscription_end_date) : null;
    const hasActiveSubscription = subscriptionEndDate ? (subscriptionEndDate > now) : false;

    // 2. Check if they are currently on an active trial (trial_ends_at is in the future)
    const trialEndsAt = tenant.trial_ends_at ? new Date(tenant.trial_ends_at) : null;
    const hasActiveTrial = trialEndsAt ? (trialEndsAt > now) : false;

    // 3. Determine if the plan is free or trial
    const planId = tenant.plan_id || '';
    const isFreePlan = !planId || planId === 'free' || planId.includes('trial');

    if (!hasActiveSubscription && !hasActiveTrial) {
      if (isFreePlan) {
        // Free plan: expired if trial_ends_at is past or 14-day limit from creation
        if (trialEndsAt) {
          if (trialEndsAt <= now) {
            isTrialExpired = true;
          }
        } else if (tenantCreatedAt) {
          const createdDate = new Date(tenantCreatedAt);
          const diffTime = now.getTime() - createdDate.getTime();
          const diffDays = diffTime / (1000 * 60 * 60 * 24);
          if (diffDays > 14) {
            isTrialExpired = true;
          }
        }
      } else {
        // Paid plan (like 'basic' or others): expired if subscription_end_date is past
        if (subscriptionEndDate && subscriptionEndDate <= now) {
          isSubscriptionExpired = true;
        } else if (!subscriptionEndDate) {
          // If they have a paid plan but no subscription_end_date is set, assume active unless status is inactive or suspended
          if (tenant.status === 'inactive' || tenant.status === 'suspended' || tenant.status === 'locked') {
            isSubscriptionExpired = true;
          }
        }
      }
    }
  }

  const effectiveRole = currentStaff?.role || userRole || 'tailor';
  const layoutModeKey = `layoutMode_${effectiveTenantId}_${currentStaff?.id || effectiveRole}`;

  const [savedLayoutMode, setSavedLayoutMode] = useState<'sidebar' | 'grid'>(() => {
    return (localStorage.getItem(layoutModeKey) as 'sidebar' | 'grid') || 'sidebar';
  });

  useEffect(() => {
    const handleLayoutChange = () => {
      const current = (localStorage.getItem(layoutModeKey) as 'sidebar' | 'grid') || 'sidebar';
      setSavedLayoutMode(current);
    };
    handleLayoutChange();
    window.addEventListener('layout_mode_changed', handleLayoutChange);
    window.addEventListener('storage', handleLayoutChange);
    return () => {
      window.removeEventListener('layout_mode_changed', handleLayoutChange);
      window.removeEventListener('storage', handleLayoutChange);
    };
  }, [layoutModeKey]);

  // PIN Access Logic
  const needsPinSetup = user && isApproved && !needsOnboarding && userRole === 'owner' && currentUserStaff?.mustChangePin === true && !isSaaSStaff && !!tenantId && tenantId !== 'null';
  const showPinLogin = user && isApproved && !isSaaSStaff && !currentStaff && hasStaffWithPin && !needsPinSetup;
  const showForcePinSetup = false; // Retired in favor of automatic setup

  if (conflictUser) {
    return (
      <div className={`min-h-screen flex items-center justify-center bg-slate-900/65 backdrop-blur-md ${isRtl ? 'text-right' : 'text-left'} p-6 font-sans select-none`} dir={dir}>
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full bg-white rounded-[2.5rem] shadow-2xl p-8 md:p-10 border border-slate-100 relative overflow-hidden"
        >
          {/* Decorative accents */}
          <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 rounded-full blur-3xl -mr-16 -mt-16" />
          <div className="absolute bottom-0 left-0 w-32 h-32 bg-indigo-500/5 rounded-full blur-3xl -ml-16 -mb-16" />
          
          <div className="w-20 h-20 bg-amber-50 text-amber-600 rounded-3xl flex items-center justify-center mx-auto mb-6 border border-amber-500/10 shadow-sm">
            <AlertCircle size={40} className="animate-pulse" />
          </div>
          
          <h2 className="text-2xl font-black text-slate-900 text-center mb-3 tracking-tight leading-tight">{t('login.multi_device_title')}</h2>
          <p className="text-slate-500 text-center font-medium leading-relaxed mb-8 px-2 text-sm">
            {t('login.multi_device_desc')}
          </p>
          
          <div className="flex flex-col gap-3">
            <button 
              onClick={handleResolveConflict}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-4 rounded-2xl font-bold transition-all shadow-lg shadow-indigo-600/10 flex items-center justify-center gap-2 text-base"
            >
              {t('login.multi_device_confirm')}
            </button>
            <button 
              onClick={handleRejectConflict}
              className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 py-4 rounded-2xl font-bold transition-all flex items-center justify-center gap-2 text-base"
            >
              {t('login.multi_device_reject')}
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  if (loading) {
    return <MainSkeleton />;
  }

  // Trial or Subscription expiration lock interception
  if ((isTrialExpired || isSubscriptionExpired) && user && !isSaaSStaff) {
    return (
      <div className={`min-h-screen flex items-center justify-center bg-gray-950 ${isRtl ? 'text-right' : 'text-left'} p-6 font-sans select-none`} dir={dir}>
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-xl w-full bg-slate-900 rounded-[3rem] shadow-2xl p-10 md:p-14 border border-red-500/15 relative overflow-hidden"
        >
          {/* Visual Accents */}
          <div className="absolute top-0 right-0 w-44 h-44 bg-red-500/5 rounded-full blur-3xl -mr-20 -mt-20" />
          <div className="absolute bottom-0 left-0 w-44 h-44 bg-indigo-500/5 rounded-full blur-3xl -ml-20 -mb-20" />
          
          <div className="w-24 h-24 bg-red-950/30 text-red-500 rounded-3xl flex items-center justify-center mx-auto mb-8 border border-red-500/10">
            <AlertCircle size={48} className="animate-pulse" />
          </div>
          
          <h2 className="text-3xl font-black text-white text-center mb-4 tracking-tight leading-tight">
            {isSubscriptionExpired ? t('subscription.expired_account_title') : t('subscription.trial_expired_account_title')}
          </h2>
          <p className="text-slate-400 text-center font-medium leading-relaxed mb-10 px-4 text-sm md:text-base">
            {isSubscriptionExpired 
              ? t('subscription.expired_account_desc')
              : t('subscription.trial_expired_account_desc')}
          </p>
          
          <div className="bg-slate-950/50 rounded-2xl p-5 border border-slate-800/65 mb-10 text-sm space-y-2.5">
            <div className="flex justify-between items-center text-slate-300">
              <span className="text-slate-400 font-medium">{t('billing.modal_bank_holder_label')}</span>
              <span className="font-bold text-white">{(currentUserStaff as any)?.tenant?.name || t('subscription.workspace_fallback_name')}</span>
            </div>
            <div className="flex justify-between items-center text-slate-300">
              <span className="text-slate-400 font-medium">{t('subscription.account_email_label')}</span>
              <span className="font-mono text-white text-[12px]">{user.email}</span>
            </div>
            <div className="flex justify-between items-center text-slate-300 mb-0.5">
              <span className="text-slate-400 font-medium">{t('subscription.start_date_label')}</span>
              <span className="font-mono text-white">
                {tenantCreatedAt ? new Date(tenantCreatedAt).toLocaleDateString(localeOf(i18n.language), { dateStyle: 'long' }) : '-'}
              </span>
            </div>
          </div>
          
          <div className="space-y-4">
            <a 
              href={`mailto:nomansa2566512@gmail.com?subject=${encodeURIComponent(t('subscription.activation_email_subject'))}`}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-4 rounded-2xl font-bold transition-all shadow-lg shadow-indigo-900/20 flex items-center justify-center gap-3 text-center"
            >
              {t('subscription.request_activation_now')}
            </a>
            
            <button
              onClick={() => logout()}
              className="w-full bg-slate-850 hover:bg-slate-800 text-slate-200 py-4 rounded-2xl font-bold transition-all border border-slate-700/30 flex items-center justify-center gap-2"
            >
              <LogOut size={18} />
              {t('common.logout_from_account')}
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  // Intercept for PIN setups
  if (needsPinSetup) {
    return (
      <ForcePinSetup
        tenantId={tenantId!}
        onSuccess={() => refreshDbUser()}
      />
    );
  }

  if (showPinLogin) {
    return (
      <PinLogin
        tenantId={tenantId!}
        currentUserStaff={currentUserStaff as any}
        onLogin={(staff) => setCurrentStaff(staff)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 font-sans" dir={i18n.language === 'en' ? 'ltr' : 'rtl'}>
      <AnimatePresence mode="wait">
        <Routes>
          {/* Public order tracking (no auth) */}
          {/* Public Digital Invoice Route */}
          <Route 
            path="/p/inv/:id" 
            element={
              <React.Suspense fallback={<PageSkeleton />}>
                <PublicInvoice />
              </React.Suspense>
            } 
          />
          <Route path="/track/:token" element={<TrackRoute />} />
          <Route
            path="/reset-password"
            element={
              <React.Suspense fallback={<MainSkeleton />}>
                <ResetPassword />
              </React.Suspense>
            }
          />
          {/* SaaS Admin Portal */}
          <Route 
            path="/admin/*" 
            element={
              (isSaaSStaff && is2FAVerified) ? (
                <SaaSLayout userRole={userRole}>
                  <React.Suspense fallback={<PageSkeleton />}>
                    <Routes>
                      <Route path="/dashboard" element={<SuperAdminDashboard />} />
                      <Route path="/tailors" element={<AdminTailors />} />
                      <Route path="/roles" element={
                        <RoleGuard allowedRoles={['super_admin']}>
                          <RolePermissionsSettings isSuperAdmin={true} />
                        </RoleGuard>
                      } />
                      <Route path="/tailors/:tenantId/analytics" element={
                        <RoleGuard allowedRoles={['super_admin', 'billing_admin', 'sales']}>
                          <TenantAnalyticsDashboard />
                        </RoleGuard>
                      } />
                      <Route path="/reports" element={
                        <RoleGuard allowedRoles={['super_admin', 'billing_admin', 'sales']}>
                          <SaaSReports />
                        </RoleGuard>
                      } />
                      <Route path="/withdrawals" element={
                        <RoleGuard allowedRoles={['super_admin', 'billing_admin']}>
                          <SaaSWithdrawals />
                        </RoleGuard>
                      } />
                      <Route path="/audit" element={
                        <RoleGuard allowedRoles={['super_admin']}>
                          <SaaSAuditLogs />
                        </RoleGuard>
                      } />
                      <Route path="/system" element={
                        <RoleGuard allowedRoles={['super_admin']}>
                          <SaaSSystemSettings />
                        </RoleGuard>
                      } />
                      <Route path="/team" element={
                        <RoleGuard allowedRoles={['super_admin']}>
                          <SaaSTeamManagement />
                        </RoleGuard>
                      } />
                      <Route path="*" element={<Navigate to="/admin/dashboard" />} />
                    </Routes>
                  </React.Suspense>
                </SaaSLayout>
              ) : <Navigate to="/login" />
            } 
          />
          <Route path="/invoice-test" element={<React.Suspense fallback={<div>Loading...</div>}>{React.createElement(React.lazy(() => import('./components/printing/InvoiceReceipt')))}</React.Suspense>} />

          {/* User Onboarding */}
          <Route 
            path="/onboarding" 
            element={
              needsOnboarding ? (
                <React.Suspense fallback={<MainSkeleton />}>
                  <Onboarding onComplete={() => refreshDbUser()} />
                </React.Suspense>
              ) : <Navigate to="/" />
            } 
          />

          {/* Authentication */}
          <Route 
            path="/login"
            element={
              localStorage.getItem('is_registering') === 'true' ? <Login /> : (
              (user && isApproved) ? <Navigate to="/" /> : (
                needsOnboarding ? <Navigate to="/onboarding" /> : (
                  (user && !isApproved) ? (
                    <AccountIssueScreen
                      variant={resolveError ? 'error' : hasNoProfile ? 'no_profile' : 'not_approved'}
                      email={user.email}
                      detail={resolveError}
                      onRetry={refreshDbUser}
                      onLogout={logout}
                    />
                  ) : <Login />
                )
              ))
            }
          />

          {/* Root Route — Landing page for visitors, Dashboard for logged-in tenants */}
          <Route 
            path="/" 
            element={
              (user && isApproved) ? (
                needsOnboarding ? (
                  <Navigate to="/onboarding" />
                ) : (
                  userRole === 'super_admin' && !impersonationTenantId ? (
                    <Navigate to="/admin/dashboard" />
                  ) : (
                    savedLayoutMode === 'grid' ? (
                      <>
                        <Layout 
                          role={userRole || 'tailor'} 
                          tenantId={effectiveTenantId!}
                          currentStaff={currentStaff}
                          onLock={() => setIsLocked(true)}
                          isLocked={isLocked}
                        >
                          <React.Suspense fallback={<PageSkeleton />}>
                            <Routes>
                              <Route path="/" element={
                                userRole === 'super_admin' && !impersonationTenantId ? <Navigate to="/admin/dashboard" /> : 
                                (effectiveRole === 'cashier' ? <Navigate to="/sales" /> :
                                 effectiveRole === 'tailor' ? <Navigate to="/orders" /> :
                                 <Dashboard tenantId={effectiveTenantId!} />)
                              } />
                              <Route path="/dashboard" element={
                                <ProtectedRoute allowedRoles={['super_admin', 'tenant_admin', 'owner', 'admin', 'manager']} permission="dashboard.view" userRole={effectiveRole} staff={currentStaff} isImpersonating={!!impersonationTenantId}>
                                  {userRole === 'super_admin' && !impersonationTenantId ? <Navigate to="/admin/dashboard" /> : <Dashboard tenantId={effectiveTenantId!} />}
                                </ProtectedRoute>
                              } />
                              <Route path="/sales" element={
                                <ProtectedRoute allowedRoles={['super_admin', 'tenant_admin', 'owner', 'admin', 'manager', 'cashier']} permission="sales.view" userRole={effectiveRole} staff={currentStaff} isImpersonating={!!impersonationTenantId}>
                                  <Sales tenantId={effectiveTenantId!} />
                                </ProtectedRoute>
                              } />
                              <Route path="/orders" element={
                                <ProtectedRoute allowedRoles={['super_admin', 'tenant_admin', 'owner', 'admin', 'manager', 'cashier', 'tailor']} permission="orders.view" userRole={effectiveRole} staff={currentStaff} isImpersonating={!!impersonationTenantId}>
                                  <Orders tenantId={effectiveTenantId!} />
                                </ProtectedRoute>
                              } />
                              <Route path="/customers" element={
                                <ProtectedRoute allowedRoles={['super_admin', 'tenant_admin', 'owner', 'admin', 'manager', 'cashier']} permission="customers.view" userRole={effectiveRole} staff={currentStaff} isImpersonating={!!impersonationTenantId}>
                                  <Customers tenantId={effectiveTenantId!} />
                                </ProtectedRoute>
                              } />
                              <Route path="/inventory" element={
                                <ProtectedRoute allowedRoles={['super_admin', 'tenant_admin', 'owner', 'admin', 'manager', 'warehouse_manager']} permission="inventory.view" userRole={effectiveRole} staff={currentStaff} isImpersonating={!!impersonationTenantId}>
                                  <InventoryManager tenantId={effectiveTenantId!} />
                                </ProtectedRoute>
                              } />
                              <Route path="/suppliers" element={
                                <ProtectedRoute allowedRoles={['super_admin', 'tenant_admin', 'owner', 'admin', 'manager', 'accountant']} permission="suppliers.manage" userRole={effectiveRole} staff={currentStaff} isImpersonating={!!impersonationTenantId}>
                                  <Suppliers tenantId={effectiveTenantId!} />
                                </ProtectedRoute>
                              } />
                              <Route path="/reports" element={
                                <ProtectedRoute allowedRoles={['super_admin', 'tenant_admin', 'owner', 'admin', 'manager', 'accountant']} permission="reports.view" userRole={effectiveRole} staff={currentStaff} isImpersonating={!!impersonationTenantId}>
                                  <Reports tenantId={effectiveTenantId!} />
                                </ProtectedRoute>
                              } />
                              <Route path="/settings" element={
                                <ProtectedRoute allowedRoles={['super_admin', 'tenant_admin', 'owner', 'admin']} permission="settings.view" userRole={effectiveRole} staff={currentStaff} isImpersonating={!!impersonationTenantId}>
                                  <Settings tenantId={effectiveTenantId!} />
                                </ProtectedRoute>
                              } />
                              <Route path="/403" element={<AccessDenied userRole={effectiveRole} />} />
                              <Route path="*" element={<Navigate to="/" />} />
                            </Routes>
                          </React.Suspense>
                        </Layout>
                        <AnimatePresence>
                          {isLocked && (
                            <LockScreen 
                              currentStaff={currentStaff} 
                              onUnlock={() => setIsLocked(false)} 
                              tenantId={effectiveTenantId || undefined}
                              onUnlockWithStaff={(staff) => {
                                setCurrentStaff(staff);
                                setIsLocked(false);
                              }}
                            />
                          )}
                        </AnimatePresence>
                      </>
                    ) : (
                      <Navigate to="/dashboard" />
                    )
                  )
                )
              ) : (
                <LandingRedirect />
              )
            } 
          />

          {/* Main Application Routes */}
          <Route 
            path="/*" 
            element={
              (user && isApproved) ? (
                needsOnboarding ? (
                  <Navigate to="/onboarding" />
                ) : (
                  <>
                    <Layout 
                      role={userRole || 'tailor'} 
                      tenantId={effectiveTenantId!}
                      currentStaff={currentStaff}
                      onLock={() => setIsLocked(true)}
                      isLocked={isLocked}
                    >
                      <React.Suspense fallback={<PageSkeleton />}>
                        <Routes>
                          <Route path="/" element={
                            userRole === 'super_admin' && !impersonationTenantId ? <Navigate to="/admin/dashboard" /> : 
                            (effectiveRole === 'cashier' ? <Navigate to="/sales" /> :
                             effectiveRole === 'tailor' ? <Navigate to="/orders" /> :
                             <Dashboard tenantId={effectiveTenantId!} />)
                          } />
                          <Route path="/dashboard" element={
                            <ProtectedRoute permission="dashboard.view" allowedRoles={['super_admin', 'tenant_admin', 'owner', 'admin', 'manager']} userRole={effectiveRole} staff={currentStaff} isImpersonating={!!impersonationTenantId}>
                              {userRole === 'super_admin' && !impersonationTenantId ? <Navigate to="/admin/dashboard" /> : <Dashboard tenantId={effectiveTenantId!} />}
                            </ProtectedRoute>
                          } />
                          <Route path="/sales" element={
                            <ProtectedRoute permission="sales.view" allowedRoles={['super_admin', 'tenant_admin', 'owner', 'admin', 'manager', 'cashier']} userRole={effectiveRole} staff={currentStaff} isImpersonating={!!impersonationTenantId}>
                              <Sales tenantId={effectiveTenantId!} />
                            </ProtectedRoute>
                          } />
                          <Route path="/orders" element={
                            <ProtectedRoute permission="orders.view" allowedRoles={['super_admin', 'tenant_admin', 'owner', 'admin', 'manager', 'cashier', 'tailor']} userRole={effectiveRole} staff={currentStaff} isImpersonating={!!impersonationTenantId}>
                              <Orders tenantId={effectiveTenantId!} />
                            </ProtectedRoute>
                          } />
                          <Route path="/customers" element={
                            <ProtectedRoute permission="customers.view" allowedRoles={['super_admin', 'tenant_admin', 'owner', 'admin', 'manager', 'cashier']} userRole={effectiveRole} staff={currentStaff} isImpersonating={!!impersonationTenantId}>
                              <Customers tenantId={effectiveTenantId!} />
                            </ProtectedRoute>
                          } />
                          <Route path="/inventory" element={
                            <ProtectedRoute permission="inventory.view" allowedRoles={['super_admin', 'tenant_admin', 'owner', 'admin', 'manager', 'warehouse_manager']} userRole={effectiveRole} staff={currentStaff} isImpersonating={!!impersonationTenantId}>
                              <InventoryManager tenantId={effectiveTenantId!} />
                            </ProtectedRoute>
                          } />
                          <Route path="/suppliers" element={
                            <ProtectedRoute permission="suppliers.manage" allowedRoles={['super_admin', 'tenant_admin', 'owner', 'admin', 'manager', 'accountant']} userRole={effectiveRole} staff={currentStaff} isImpersonating={!!impersonationTenantId}>
                              <Suppliers tenantId={effectiveTenantId!} />
                            </ProtectedRoute>
                          } />
                          <Route path="/reports" element={
                            <ProtectedRoute permission="reports.view" allowedRoles={['super_admin', 'tenant_admin', 'owner', 'admin', 'manager', 'accountant']} userRole={effectiveRole} staff={currentStaff} isImpersonating={!!impersonationTenantId}>
                              <Reports tenantId={effectiveTenantId!} />
                            </ProtectedRoute>
                          } />
                          <Route path="/settings" element={
                            <ProtectedRoute permission="settings.view" allowedRoles={['super_admin', 'tenant_admin', 'owner', 'admin']} userRole={effectiveRole} staff={currentStaff} isImpersonating={!!impersonationTenantId}>
                              <Settings tenantId={effectiveTenantId!} />
                            </ProtectedRoute>
                          } />
                          <Route path="/403" element={<AccessDenied userRole={effectiveRole} />} />
                          <Route path="*" element={<Navigate to="/" />} />
                        </Routes>
                      </React.Suspense>
                    </Layout>
                    <AnimatePresence>
                      {isLocked && (
                        <LockScreen 
                          currentStaff={currentStaff} 
                          onUnlock={() => setIsLocked(false)} 
                          tenantId={effectiveTenantId || undefined}
                          onUnlockWithStaff={(staff) => {
                            setCurrentStaff(staff);
                            setIsLocked(false);
                          }}
                        />
                      )}
                    </AnimatePresence>
                  </>
                )
              ) : <Navigate to="/login" />
            } 
          />
        </Routes>
      </AnimatePresence>
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <ToastProvider>
          <ThemeProvider>
            <Router>
              <AuthProvider>
                <BrandingProvider>
                  <StaffProvider>
                    <AppContent />
                  </StaffProvider>
                </BrandingProvider>
              </AuthProvider>
            </Router>
          </ThemeProvider>
        </ToastProvider>
      </ErrorBoundary>
    </QueryClientProvider>
  );
}
