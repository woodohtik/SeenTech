import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle, Clock as ClockIcon, RefreshCw, LogOut, AlertCircle } from 'lucide-react';
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
import { onIdTokenChanged, User, signOut } from 'firebase/auth';
import { auth } from './lib/firebase';
import { logError } from './lib/logger';
import { supabase, setSupabaseAuthToken } from './lib/supabase/client';
import { setGlobalCurrencySymbol } from './lib/utils';
import Layout from './components/Layout';
import LockScreen from './components/LockScreen';
import Dashboard from './components/Dashboard';
import Customers from './components/Customers';
import Orders from './components/Orders';
import Settings from './components/Settings';
import Sales from './components/Sales';
import PublicInvoice from './pages/PublicInvoice';
import Login from './components/Login';
import { PermissionGuard } from './components/PermissionGuard';
import AdminTailors from './components/AdminTailors';

const InventoryManager = React.lazy(() => import('./components/Inventory/InventoryManager'));
const Reports = React.lazy(() => import('./components/Reports'));
import Onboarding from './components/Onboarding';
import SuperAdminDashboard from './components/SuperAdminDashboard';
import PinLogin from './components/PinLogin';
import ForcePinSetup from './components/ForcePinSetup';
import StaffPinSetup from './components/StaffPinSetup';
import MainSkeleton from './components/MainSkeleton';
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

import SaaSLogin from './components/SaaSLogin';
import SaaSLayout from './components/SaaSLayout';
import SaaSReports from './components/SaaSReports';
import SaaSAuditLogs from './components/SaaSAuditLogs';
import SaaSSystemSettings from './components/SaaSSystemSettings';
import SaaSWithdrawals from './components/SaaSWithdrawals';
import SaaSTeamManagement from './components/SaaSTeamManagement';
import TenantAnalyticsDashboard from './components/TenantAnalyticsDashboard';
import RoleGuard from './components/RoleGuard';

import Suppliers from './components/Suppliers';

import { AuthProvider, useAuth } from './contexts/AuthContext';

function AppContent() {
  const { t, i18n } = useTranslation();
  const { currentStaff, setCurrentStaff } = useStaff();
  const { impersonationTenantId } = useAuth();
  const SUPER_ADMIN_EMAIL = "nomansa2566512@gmail.com";

  // State sync trigger for seamless boarding
  const [syncTrigger, setSyncTrigger] = useState(0);

  // Inject mock staff for impersonation to prevent null crashes
  useEffect(() => {
    if (impersonationTenantId && !currentStaff) {
      setCurrentStaff({
        id: 'super_admin_mock_id',
        name: 'الدعم الفني',
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

  // Consolidated Auth State to prevent partial state flashes
  const [authState, setAuthState] = useState<{
    user: User | null;
    isApproved: boolean;
    userRole: UserRole | null;
    tenantId: string | null;
    onboardingStep: number;
    hasStaffWithPin: boolean | null;
    currentUserStaff: StaffType | null;
    loading: boolean;
  }>({
    user: null,
    isApproved: localStorage.getItem('setup_complete') === 'true',
    userRole: localStorage.getItem('user_role') as UserRole || null,
    tenantId: localStorage.getItem('tenant_id') && localStorage.getItem('tenant_id') !== 'null' ? localStorage.getItem('tenant_id') : null,
    onboardingStep: 0,
    hasStaffWithPin: null,
    currentUserStaff: null,
    loading: true
  });

  const { user, isApproved, userRole, tenantId, onboardingStep, hasStaffWithPin, currentUserStaff, loading } = authState;

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
          setGlobalCurrencySymbol(tenant.currency || 'ر.س');
        }
      } catch (err) {
        console.warn("Failed to fetch tenant settings from Supabase:", err);
      }
    };

    fetchTenantSettings();
  }, [tenantId, syncTrigger]);

  useEffect(() => {
    if (!auth) {
      setAuthState(prev => ({ ...prev, loading: false }));
      return;
    }
    const unsubscribe = onIdTokenChanged(auth, async (firebaseUser) => {
      console.log("[DEBUG] Auth State/Token Changed:", firebaseUser?.email);
      
      if (localStorage.getItem('is_registering') === 'true') {
        console.log("[DEBUG] Registration in progress, skipping auth update.");
        return;
      }
      
      if (!firebaseUser) {
        setSupabaseAuthToken(null);
        localStorage.removeItem('setup_complete');
        localStorage.removeItem('user_role');
        localStorage.removeItem('tenant_id');
        setAuthState({
          user: null,
          isApproved: false,
          userRole: null,
          tenantId: null,
          onboardingStep: 0,
          hasStaffWithPin: null,
          currentUserStaff: null,
          loading: false
        });
        return;
      }

      try {
        const token = await firebaseUser.getIdToken();
        const email = firebaseUser.email?.toLowerCase().trim() || '';
        const uid = firebaseUser.uid;
        setSupabaseAuthToken(token);
        
        // 1. Super Admin Detection
        if (email === SUPER_ADMIN_EMAIL.toLowerCase()) {
          // Self-heal/provision Super Admin in Supabase saas_users to clear RLS blocks
          supabase.from('saas_users').upsert({
            uid,
            email,
            name: firebaseUser.displayName || 'Super Admin',
            role: 'super_admin',
            is_active: true
          }, {
            onConflict: 'uid'
          }).then(({ error }) => {
            if (error) {
              console.error("[Supabase Auth Sync] Error auto-provisioning super admin:", error);
            } else {
              console.log("[Supabase Auth Sync] Super Admin auto-provisioned successfully in Supabase DB!");
            }
          });

          const saState = {
            user: firebaseUser,
            isApproved: true,
            userRole: 'super_admin' as UserRole,
            tenantId: 'super_admin',
            onboardingStep: 4,
            hasStaffWithPin: true,
            currentUserStaff: null,
            loading: false
          };
          setAuthState(saState);
          localStorage.setItem('user_role', 'super_admin');
          localStorage.setItem('setup_complete', 'true');
          return;
        }

        // 2. Resolve Profile
        const [staffRes, requestRes] = await Promise.all([
          supabase.from('staff').select('*, tenant:tenants(*)').eq('uid', uid).maybeSingle(),
          supabase.from('tailor_requests').select('*').eq('uid', uid).maybeSingle()
        ]);

        let staffData = staffRes.data;
        if (!staffData && email) {
          const { data: staffByEmail } = await supabase.from('staff').select('*, tenant:tenants(*)').eq('email', email).maybeSingle();
          staffData = staffByEmail;
          if (staffData && !staffData.uid) {
            await supabase.from('staff').update({ uid }).eq('id', staffData.id);
          }
        }

        if (staffData) {
          const role = staffData.role as UserRole;
          const approved = staffData.tenant?.status === 'active' || staffData.tenant?.status === 'approved' || staffData.tenant?.status === 'onboarding';
          const isPending = staffData.tenant?.status === 'pending';
          
          let staffPinCount = false;
          try {
            const { count } = await supabase
              .from('staff')
              .select('*', { count: 'exact', head: true })
              .eq('tenant_id', staffData.tenant_id)
              .not('pin_hash', 'is', null);
            staffPinCount = !!count;
          } catch (e) { console.error("Error checking staff pins:", e); }

          const mappedStaff = {
            ...staffData,
            tenantId: staffData.tenant_id,
            branchId: staffData.branch_id,
            pin: staffData.pin_hash,
            mustChangePin: staffData.must_change_pin
          };

          // If tenant and approved, let's see if onboarding is completed
          let step = 4;
          if (requestRes.data && (!requestRes.data.onboarding_step || requestRes.data.onboarding_step < 4)) {
            step = requestRes.data.onboarding_step || 1;
          } else if (staffData.tenant?.status === 'onboarding') {
            step = requestRes.data?.onboarding_step || 1;
          } else if (isPending && requestRes.data) {
             step = requestRes.data.onboarding_step || 1;
             // Temporarily mark as approved if request is approved so onboarding can proceed
             if (requestRes.data.status === 'approved') {
                 setAuthState({
                   user: firebaseUser,
                   isApproved: true,
                   userRole: role,
                   tenantId: staffData.tenant_id,
                   onboardingStep: step,
                   hasStaffWithPin: staffPinCount,
                   currentUserStaff: mappedStaff as any,
                   loading: false
                 });
                 localStorage.removeItem('tenant_id');
                 return;
             }
          }

          setAuthState({
            user: firebaseUser,
            isApproved: approved,
            userRole: role,
            tenantId: staffData.tenant_id,
            onboardingStep: step,
            hasStaffWithPin: staffPinCount,
            currentUserStaff: mappedStaff as any,
            loading: false
          });

          if (staffData.tenant_id && approved) {
            localStorage.setItem('tenant_id', staffData.tenant_id);
          } else {
            localStorage.removeItem('tenant_id');
          }
          localStorage.setItem('user_role', role);
          if (approved) localStorage.setItem('setup_complete', 'true');
          return;
        }

        // 3. SaaS Staff
        const { data: saasUser } = await supabase.from('saas_users').select('role').eq('uid', uid).maybeSingle();
        if (saasUser) {
          setAuthState({
            user: firebaseUser,
            isApproved: true,
            userRole: saasUser.role as UserRole,
            tenantId: 'saas',
            onboardingStep: 4,
            hasStaffWithPin: true,
            currentUserStaff: null,
            loading: false
          });
          localStorage.setItem('user_role', saasUser.role);
          localStorage.setItem('setup_complete', 'true');
          return;
        }

        // 4. Onboarding Request
        let request = requestRes.data;
        if (!request && email) {
          const { data: reqByEmail } = await supabase.from('tailor_requests').select('*').eq('email', email).maybeSingle();
          request = reqByEmail;
          if (request && !request.uid) {
            await supabase.from('tailor_requests').update({ uid }).eq('id', request.id);
          }
        }

        if (request) {
          const approved = request.status === 'approved';
          setAuthState({
            user: firebaseUser,
            isApproved: approved,
            userRole: 'owner',
            tenantId: null,
            onboardingStep: request.onboarding_step || 1,
            hasStaffWithPin: false,
            currentUserStaff: null,
            loading: false
          });
          if (approved) localStorage.setItem('setup_complete', 'true');
        } else {
          setAuthState({
            user: firebaseUser,
            isApproved: false,
            userRole: 'owner',
            tenantId: null,
            onboardingStep: 1,
            hasStaffWithPin: false,
            currentUserStaff: null,
            loading: false
          });
        }
      } catch (error) {
        console.error('[CRITICAL] Auth verification failed:', error);
        setAuthState(prev => ({ ...prev, loading: false }));
      }
    });
    return () => unsubscribe();
  }, [syncTrigger]);

  useEffect(() => {
    (window as any).refreshAuthData = () => setSyncTrigger(prev => prev + 1);
    return () => { delete (window as any).refreshAuthData; };
  }, []);

  const onboardingCompletedLocal = localStorage.getItem('onboarding_completed') === 'true';
  const needsOnboarding = (user && isApproved && onboardingStep > 0 && onboardingStep < 4);
  const isTenantOwner = userRole === 'owner' || userRole === 'admin';
  
  // Security Checks
  const isSaaSStaff = userRole === 'super_admin' || 
                      (userRole === 'owner' && (tenantId === 'saas' || tenantId === 'super_admin')) || 
                      userRole === 'support_tech' || 
                      userRole === 'billing_admin' || 
                      userRole === 'sales';
  const effectiveTenantId = (isSaaSStaff && impersonationTenantId) ? impersonationTenantId : tenantId;
  
  const is2FAVerified = sessionStorage.getItem('saas_2fa_verified') === 'true' || 
                        (user?.email?.toLowerCase().trim() === SUPER_ADMIN_EMAIL.toLowerCase()) || 
                        sessionStorage.getItem('dev_bypass') === 'true';

  // Trial Period Check (14 Days)
  const tenantCreatedAt = (authState.currentUserStaff as any)?.tenant?.created_at;
  let isTrialExpired = false;
  if (user && !isSaaSStaff && tenantCreatedAt) {
    const createdDate = new Date(tenantCreatedAt);
    const now = new Date();
    const diffTime = now.getTime() - createdDate.getTime();
    const diffDays = diffTime / (1000 * 60 * 60 * 24);
    if (diffDays > 14) {
      isTrialExpired = true;
    }
  }

  // PIN Access Logic
  const needsPinSetup = user && isApproved && !needsOnboarding && authState.userRole === 'owner' && hasStaffWithPin === false && !isSaaSStaff && !!tenantId && tenantId !== 'null';
  const showPinLogin = user && isApproved && !isSaaSStaff && !currentStaff && hasStaffWithPin && !needsPinSetup;
  const showForcePinSetup = false; // Retired in favor of automatic setup

  if (loading) {
    return <MainSkeleton />;
  }

  // Trial expiration lock interception
  if (isTrialExpired && user && !isSaaSStaff) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950 text-right p-6 font-sans select-none" dir="rtl">
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
          
          <h2 className="text-3xl font-black text-white text-center mb-4 tracking-tight leading-tight">انتهت الفترة التجريبية للحساب</h2>
          <p className="text-slate-400 text-center font-medium leading-relaxed mb-10 px-4 text-sm md:text-base">
            لقد انتهت فترة الـ 14 يوماً التجريبية المجانية المخصصة لمساحة العمل الخاصة بك. 
            يرجى التواصل مع إدارة النظام لتفعيل الاشتراك ومتابعة أعمالك بسلاسة.
          </p>
          
          <div className="bg-slate-950/50 rounded-2xl p-5 border border-slate-800/65 mb-10 text-sm space-y-2.5">
            <div className="flex justify-between items-center text-slate-300">
              <span className="text-slate-400 font-medium">اسم الحساب:</span>
              <span className="font-bold text-white">{(authState.currentUserStaff as any)?.tenant?.name || 'مساحة العمل'}</span>
            </div>
            <div className="flex justify-between items-center text-slate-300">
              <span className="text-slate-400 font-medium">البريد الإلكتروني للقرصنة:</span>
              <span className="font-mono text-white text-[12px]">{user.email}</span>
            </div>
            <div className="flex justify-between items-center text-slate-300 mb-0.5">
              <span className="text-slate-400 font-medium">تاريخ البداية:</span>
              <span className="font-mono text-white">
                {tenantCreatedAt ? new Date(tenantCreatedAt).toLocaleDateString('ar-SA', { dateStyle: 'long' }) : '-'}
              </span>
            </div>
          </div>
          
          <div className="space-y-4">
            <a 
              href="mailto:nomansa2566512@gmail.com?subject=تفعيل حساب سين الذكي"
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-4 rounded-2xl font-bold transition-all shadow-lg shadow-indigo-900/20 flex items-center justify-center gap-3 text-center"
            >
              طلب التفعيل والدفع الآن
            </a>
            
            <button 
              onClick={() => { signOut(auth); window.location.href = '/login'; }}
              className="w-full bg-slate-850 hover:bg-slate-800 text-slate-200 py-4 rounded-2xl font-bold transition-all border border-slate-700/30 flex items-center justify-center gap-2"
            >
              <LogOut size={18} />
              تسجيل الخروج من الحساب
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
        onSuccess={() => setAuthState(prev => ({ ...prev, hasStaffWithPin: true }))} 
      />
    );
  }

  if (showPinLogin) {
    return (
      <PinLogin 
        tenantId={tenantId!} 
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
          <Route path="/p/inv/:id" element={<PublicInvoice />} />
          <Route path="/track/:token" element={<TrackRoute />} />
          {/* SaaS Admin Portal */}
          <Route 
            path="/admin/*" 
            element={
              (isSaaSStaff && is2FAVerified) ? (
                <SaaSLayout userRole={userRole}>
                  <Routes>
                    <Route path="/dashboard" element={<SuperAdminDashboard />} />
                    <Route path="/tailors" element={<AdminTailors />} />
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
                </SaaSLayout>
              ) : <Navigate to="/saas/login" />
            } 
          />
          <Route path="/saas/login" element={<SaaSLogin />} />

          {/* User Onboarding */}
          <Route 
            path="/onboarding" 
            element={
              needsOnboarding ? (
                <Onboarding onComplete={() => setSyncTrigger(p => p + 1)} />
              ) : <Navigate to="/" />
            } 
          />

          {/* Authentication */}
          <Route 
            path="/login" 
            element={
              (user && isApproved) ? <Navigate to="/" /> : (
                needsOnboarding ? <Navigate to="/onboarding" /> : (
                  (user && !isApproved) ? (
                    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6" dir="rtl">
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="max-w-md w-full bg-white rounded-[3.5rem] shadow-2xl p-12 text-center border border-amber-100 relative overflow-hidden"
                      >
                        <div className="absolute top-0 right-0 w-32 h-32 bg-amber-50 rounded-full blur-3xl opacity-50 -mr-16 -mt-16" />
                        <div className="absolute bottom-0 left-0 w-32 h-32 bg-indigo-50 rounded-full blur-3xl opacity-50 -ml-16 -mb-16" />
                        
                        <div className="w-24 h-24 bg-amber-50 text-amber-600 rounded-[2rem] flex items-center justify-center mx-auto mb-8 shadow-sm border border-amber-100/50 rotate-3 animate-pulse">
                          <ClockIcon size={48} strokeWidth={2.5} />
                        </div>
                        
                        <h2 className="text-3xl font-black text-gray-900 mb-4 tracking-tight">طلبك قيد المراجعة</h2>
                        <p className="text-gray-500 font-medium leading-relaxed mb-10 px-2">
                          نسعد بانضمامك إلينا! طلبك حالياً في مرحلة المراجعة من قبل فريقنا الفني. 
                          <span className="block mt-2 font-bold text-amber-700">سيتم تفعيل حسابك ونقلك للتهيئة قريباً جداً.</span>
                        </p>
                        
                        <div className="space-y-4">
                          <button 
                            onClick={() => window.location.reload()}
                            className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 flex items-center justify-center gap-3"
                          >
                            <RefreshCw size={20} />
                            تحديث الحالة
                          </button>
                          
                          <button 
                            onClick={() => { signOut(auth); window.location.href = '/login'; }}
                            className="w-full bg-gray-50 text-gray-600 py-4 rounded-2xl font-bold hover:bg-gray-100 transition-all border border-gray-100 flex items-center justify-center gap-2"
                          >
                            <LogOut size={18} />
                            خروج من الحساب
                          </button>
                        </div>
                      </motion.div>
                    </div>
                  ) : <Login />
                )
              )
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
                    <Navigate to="/dashboard" />
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
                      <Routes>
                        <Route path="/" element={userRole === 'super_admin' && !impersonationTenantId ? <Navigate to="/admin/dashboard" /> : <Dashboard tenantId={effectiveTenantId!} />} />
                        <Route path="/dashboard" element={userRole === 'super_admin' && !impersonationTenantId ? <Navigate to="/admin/dashboard" /> : <Dashboard tenantId={effectiveTenantId!} />} />
                        <Route path="/sales" element={<Sales tenantId={effectiveTenantId!} />} />
                        <Route path="/orders" element={<Orders tenantId={effectiveTenantId!} />} />
                        <Route path="/customers" element={<Customers tenantId={effectiveTenantId!} />} />
                        <Route path="/inventory" element={
                          <React.Suspense fallback={<div className="flex items-center justify-center h-full min-h-[400px]"><RefreshCw className="animate-spin text-indigo-500 w-8 h-8" /></div>}>
                            <InventoryManager tenantId={effectiveTenantId!} />
                          </React.Suspense>
                        } />
                        <Route path="/suppliers" element={<Suppliers tenantId={effectiveTenantId!} />} />
                        <Route path="/reports" element={
                          <React.Suspense fallback={<div className="flex items-center justify-center h-full min-h-[400px]"><RefreshCw className="animate-spin text-indigo-500 w-8 h-8" /></div>}>
                            <Reports tenantId={effectiveTenantId!} />
                          </React.Suspense>
                        } />
                        <Route path="/settings" element={<Settings tenantId={effectiveTenantId!} />} />
                        <Route path="*" element={<Navigate to="/" />} />
                      </Routes>
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

export default function App() {
  return (
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
  );
}
