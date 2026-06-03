import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle, Clock as ClockIcon, RefreshCw, LogOut } from 'lucide-react';
import { 
  BrowserRouter as Router, 
  Routes, 
  Route, 
  Navigate 
} from 'react-router-dom';
import { onIdTokenChanged, User } from 'firebase/auth';
import { auth, OperationType, db } from './lib/firebase';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
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
import Login from './components/Login';
import InventoryManager from './components/Inventory/InventoryManager';
import { PermissionGuard } from './components/PermissionGuard';
import Reports from './components/Reports';
import AdminTailors from './components/AdminTailors';
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

import Suppliers from './components/Suppliers';

import { AuthProvider, useAuth } from './contexts/AuthContext';

function AppContent() {
  const { t, i18n } = useTranslation();
  const { currentStaff, setCurrentStaff } = useStaff();
  const { impersonationTenantId } = useAuth();
  const SUPER_ADMIN_EMAIL = "nomansa2566512@gmail.com";

  // State sync trigger for seamless boarding
  const [syncTrigger, setSyncTrigger] = useState(0);

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
          if (staffData.tenant?.status === 'onboarding') {
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
  const isSaaSStaff = userRole === 'super_admin' || userRole === 'support_tech' || userRole === 'billing_admin';
  const effectiveTenantId = (isSaaSStaff && impersonationTenantId) ? impersonationTenantId : tenantId;
  
  const is2FAVerified = sessionStorage.getItem('saas_2fa_verified') === 'true' || 
                        (user?.email?.toLowerCase().trim() === SUPER_ADMIN_EMAIL.toLowerCase()) || 
                        sessionStorage.getItem('dev_bypass') === 'true';

  // PIN Access Logic
  const needsPinSetup = user && isApproved && !needsOnboarding && authState.userRole === 'owner' && hasStaffWithPin === false && !isSaaSStaff && !!tenantId && tenantId !== 'null';
  const showPinLogin = user && isApproved && !isSaaSStaff && !currentStaff && hasStaffWithPin && !needsPinSetup;
  const showForcePinSetup = false; // Retired in favor of automatic setup

  if (loading) {
    return <MainSkeleton />;
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
          {/* SaaS Admin Portal */}
          <Route 
            path="/admin/*" 
            element={
              (isSaaSStaff && is2FAVerified) ? (
                <SaaSLayout userRole={userRole}>
                  <Routes>
                    <Route path="/dashboard" element={<SuperAdminDashboard />} />
                    <Route path="/tailors" element={<AdminTailors />} />
                    <Route path="/reports" element={<SaaSReports />} />
                    <Route path="/audit" element={<SaaSAuditLogs />} />
                    <Route path="/system" element={<SaaSSystemSettings />} />
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
                            onClick={() => { auth.signOut(); window.location.href = '/login'; }}
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
                        <Route path="/inventory" element={<InventoryManager tenantId={effectiveTenantId!} />} />
                        <Route path="/suppliers" element={<Suppliers tenantId={effectiveTenantId!} />} />
                        <Route path="/reports" element={<Reports tenantId={effectiveTenantId!} />} />
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
