import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from 'react';
import type { Session, User as SupabaseUser } from '@supabase/supabase-js';

import { supabase } from '../lib/supabase/client';
import { setCurrentAuthSessionInfo } from '../lib/firebase';
import { getDeviceSessionId } from '../utils/session';
import type { Database } from '../types/supabase';
import type { UserRole, Staff as StaffType } from '../types';

type UserRow  = Database['public']['Tables']['users']['Row'];
type StaffRow = Database['public']['Tables']['staff']['Row'];

const SUPER_ADMIN_EMAIL = 'nomansa2566512@gmail.com';

/**
 * The combined user record surfaced to the UI.
 * - Base fields come from `users` (Supabase Auth user id = users.id).
 * - `role` and `tenant_id` are resolved from the user's active staff record.
 *   If the user has no staff row yet (e.g. fresh sign-up awaiting approval),
 *   both are null and the UI should route them to an onboarding state.
 */
export interface DbUser extends UserRow {
    role: StaffRow['role'] | null;
    tenant_id: StaffRow['tenant_id'] | null;
    staff_id: StaffRow['id'] | null;
}

interface ConflictState {
    uid: string;
    email: string;
    currentSessionId: string;
}

interface ResolvedAppState {
    isApproved: boolean;
    userRole: UserRole | null;
    tenantId: string | null;
    onboardingStep: number;
    hasStaffWithPin: boolean | null;
    currentUserStaff: StaffType | null;
}

const INITIAL_APP_STATE: ResolvedAppState = {
    isApproved: false,
    userRole: null,
    tenantId: null,
    onboardingStep: 0,
    hasStaffWithPin: null,
    currentUserStaff: null,
};

interface AuthContextValue extends ResolvedAppState {
    session: Session | null;
    user: SupabaseUser | null;
    dbUser: DbUser | null;
    loading: boolean;
    conflictUser: ConflictState | null;
    resolveConflict: () => Promise<void>;
    rejectConflict: () => Promise<void>;
    login: (email: string, password: string) => ReturnType<typeof supabase.auth.signInWithPassword>;
    logout: () => Promise<void>;
    refreshDbUser: () => Promise<void>;
    impersonationTenantId: string | null;
    setImpersonationTenantId: (id: string | null) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function fetchDbUser(uid: string, email?: string): Promise<DbUser | null> {
    const [
        { data: userRow, error: userErr },
        { data: staffRow, error: staffErr },
        { data: saasRow, error: saasErr }
    ] = await Promise.all([
        supabase.from('users').select('*').eq('id', uid).maybeSingle(),
        supabase
            .from('staff')
            .select('*')
            .eq('uid', uid)
            .eq('status', 'active')
            .limit(1)
            .maybeSingle(),
        supabase
            .from('saas_users')
            .select('*')
            .eq('uid', uid)
            .maybeSingle()
    ]);

    if (userErr) throw userErr;
    if (staffErr) throw staffErr;
    if (saasErr) throw saasErr;
    if (!userRow) return null;

    let actualRole = (staffRow as StaffRow)?.role ?? null;

    // SaaS Role takes precedence over tenant staff roles
    const checkEmail = email || userRow.email;
    if (checkEmail?.toLowerCase().trim() === SUPER_ADMIN_EMAIL) {
        actualRole = 'super_admin';
    } else if (saasRow) {
        actualRole = saasRow.role;
    } else if (staffRow && (staffRow as StaffRow).role_id) {
        const { data: roleRow } = await supabase
            .from('roles')
            .select('role_key')
            .eq('id', (staffRow as StaffRow).role_id)
            .single();
        if (roleRow) {
            actualRole = roleRow.role_key;
        }
    }

    return {
        ...(userRow as UserRow),
        role:      actualRole,
        tenant_id: (staffRow as StaffRow)?.tenant_id ?? null,
        staff_id:  (staffRow as StaffRow)?.id        ?? null,
    };
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const [session, setSession] = useState<Session | null>(null);
    const [dbUser, setDbUser] = useState<DbUser | null>(null);
    const [loading, setLoading] = useState(true);
    const [conflictUser, setConflictUser] = useState<ConflictState | null>(null);
    const [appState, setAppState] = useState<ResolvedAppState>(() => ({
        isApproved: localStorage.getItem('setup_complete') === 'true',
        userRole: (localStorage.getItem('user_role') as UserRole) || null,
        tenantId: localStorage.getItem('tenant_id') && localStorage.getItem('tenant_id') !== 'null'
            ? localStorage.getItem('tenant_id') : null,
        onboardingStep: 0,
        hasStaffWithPin: null,
        currentUserStaff: null,
    }));
    const [impersonationTenantId, setImpersonationTenantId] = useState<string | null>(
        localStorage.getItem('impersonatedTenantId') !== 'null' ? localStorage.getItem('impersonatedTenantId') : null
    );

    // Effect to sync impersonationTenantId to localStorage
    useEffect(() => {
        if (impersonationTenantId) {
            localStorage.setItem('impersonatedTenantId', impersonationTenantId);
        } else {
            localStorage.removeItem('impersonatedTenantId');
        }
    }, [impersonationTenantId]);

    // Resolves the full app-facing identity (device-session conflict, role,
    // tenant, onboarding step) from a Supabase session. This is the single
    // source of truth that used to be split between AuthContext (dbUser) and
    // App.tsx's own onIdTokenChanged listener (authState) under Firebase.
    const resolveIdentity = useCallback(async (nextSession: Session | null) => {
        if (localStorage.getItem('is_registering') === 'true') return;

        const user = nextSession?.user ?? null;

        if (!user) {
            localStorage.removeItem('setup_complete');
            localStorage.removeItem('user_role');
            localStorage.removeItem('tenant_id');
            setDbUser(null);
            setConflictUser(null);
            setAppState({ ...INITIAL_APP_STATE });
            setLoading(false);
            return;
        }

        const uid = user.id;
        const email = user.email?.toLowerCase().trim() || '';

        try {
            const next = await fetchDbUser(uid, email);
            setDbUser(next);
            const isSuperAdmin = next?.role === 'super_admin' || email === SUPER_ADMIN_EMAIL;
            if (!isSuperAdmin) {
                localStorage.removeItem('impersonatedTenantId');
                setImpersonationTenantId(null);
            }
        } catch (err) {
            console.error('[AuthContext] Failed to fetch DB user:', err);
            setDbUser(null);
        }

        try {
            // Device-session-conflict check (single-active-device-per-account)
            const currentSessionId = getDeviceSessionId();
            const { data: userRow } = await supabase.from('users').select('photo_url').eq('id', uid).maybeSingle();

            if (userRow?.photo_url && userRow.photo_url !== currentSessionId) {
                setConflictUser({ uid, email, currentSessionId });
                setLoading(false);
                return;
            }
            setConflictUser(null);

            if (userRow) {
                await supabase.from('users').update({ photo_url: currentSessionId }).eq('id', uid);
            }

            // 1. Super Admin detection
            if (email === SUPER_ADMIN_EMAIL) {
                await supabase.from('users').upsert({
                    id: uid,
                    email,
                    display_name: user.user_metadata?.full_name || 'Super Admin'
                }, { onConflict: 'id' });

                supabase.from('saas_users').upsert({
                    uid,
                    email,
                    name: user.user_metadata?.full_name || 'Super Admin',
                    role: 'super_admin',
                    is_active: true
                }, { onConflict: 'uid' }).then(({ error }) => {
                    if (error) console.error('[AuthContext] Error auto-provisioning super admin:', error);
                });

                setAppState({
                    isApproved: true,
                    userRole: 'super_admin' as UserRole,
                    tenantId: 'super_admin',
                    onboardingStep: 4,
                    hasStaffWithPin: true,
                    currentUserStaff: null,
                });
                localStorage.setItem('user_role', 'super_admin');
                localStorage.setItem('setup_complete', 'true');
                setLoading(false);
                return;
            }

            // 2. Resolve profile: staff -> saas_users -> tailor_requests
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
                } catch (e) { console.error('Error checking staff pins:', e); }

                const mappedStaff = {
                    ...staffData,
                    tenantId: staffData.tenant_id,
                    branchId: staffData.branch_id,
                    pin: staffData.pin_hash,
                    mustChangePin: staffData.must_change_pin
                };

                let step = 4;
                if (requestRes.data && (!requestRes.data.onboarding_step || requestRes.data.onboarding_step < 4)) {
                    step = requestRes.data.onboarding_step || 1;
                } else if (staffData.tenant?.status === 'onboarding') {
                    step = requestRes.data?.onboarding_step || 1;
                } else if (isPending && requestRes.data) {
                    step = requestRes.data.onboarding_step || 1;
                    if (requestRes.data.status === 'approved') {
                        setAppState({
                            isApproved: true,
                            userRole: role,
                            tenantId: staffData.tenant_id,
                            onboardingStep: step,
                            hasStaffWithPin: staffPinCount,
                            currentUserStaff: mappedStaff as any,
                        });
                        localStorage.removeItem('tenant_id');
                        setLoading(false);
                        return;
                    }
                }

                setAppState({
                    isApproved: approved,
                    userRole: role,
                    tenantId: staffData.tenant_id,
                    onboardingStep: step,
                    hasStaffWithPin: staffPinCount,
                    currentUserStaff: mappedStaff as any,
                });

                if (staffData.tenant_id && approved) {
                    localStorage.setItem('tenant_id', staffData.tenant_id);
                } else {
                    localStorage.removeItem('tenant_id');
                }
                localStorage.setItem('user_role', role);
                if (approved) localStorage.setItem('setup_complete', 'true');
                setLoading(false);
                return;
            }

            // 3. SaaS staff
            const { data: saasUser } = await supabase.from('saas_users').select('role').eq('uid', uid).maybeSingle();
            if (saasUser) {
                setAppState({
                    isApproved: true,
                    userRole: saasUser.role as UserRole,
                    tenantId: 'saas',
                    onboardingStep: 4,
                    hasStaffWithPin: true,
                    currentUserStaff: null,
                });
                localStorage.setItem('user_role', saasUser.role);
                localStorage.setItem('setup_complete', 'true');
                setLoading(false);
                return;
            }

            // 4. Onboarding request
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
                setAppState({
                    isApproved: approved,
                    userRole: 'owner' as UserRole,
                    tenantId: null,
                    onboardingStep: request.onboarding_step || 1,
                    hasStaffWithPin: false,
                    currentUserStaff: null,
                });
                if (approved) localStorage.setItem('setup_complete', 'true');
            } else {
                setAppState({
                    isApproved: false,
                    userRole: 'owner' as UserRole,
                    tenantId: null,
                    onboardingStep: 1,
                    hasStaffWithPin: false,
                    currentUserStaff: null,
                });
            }
            setLoading(false);
        } catch (error) {
            console.error('[CRITICAL] Auth verification failed:', error);
            setLoading(false);
        }
    }, []);

    // Single subscription: replaces both the separate Firebase
    // onAuthStateChanged + onIdTokenChanged listeners that used to live here,
    // and App.tsx's own duplicate onIdTokenChanged listener.
    useEffect(() => {
        const { data: sub } = supabase.auth.onAuthStateChange((event, nextSession) => {
            setSession(nextSession);
            setCurrentAuthSessionInfo({ userId: nextSession?.user?.id ?? null, email: nextSession?.user?.email ?? null });
            if (event === 'TOKEN_REFRESHED') return; // session state above is enough; no need to re-resolve identity
            resolveIdentity(nextSession);
        });
        return () => sub.subscription.unsubscribe();
    }, [resolveIdentity]);

    // Periodic session validation (another device logged in / kicked this one out)
    useEffect(() => {
        const uid = session?.user?.id;
        if (!uid || conflictUser) return;

        const currentSessionId = getDeviceSessionId();

        const checkSession = async () => {
            try {
                const { data: userRow } = await supabase.from('users').select('photo_url').eq('id', uid).maybeSingle();
                if (userRow?.photo_url && userRow.photo_url !== currentSessionId) {
                    console.log('[SESSION] Device kicked out because of a newer session on another device.');
                    await supabase.auth.signOut();
                    localStorage.removeItem('setup_complete');
                    localStorage.removeItem('user_role');
                    localStorage.removeItem('tenant_id');
                    window.location.replace('/login?conflict=true');
                }
            } catch (err) {
                console.warn('[SESSION] Periodic session check failed:', err);
            }
        };

        const interval = setInterval(checkSession, 5000);
        window.addEventListener('focus', checkSession);
        return () => {
            clearInterval(interval);
            window.removeEventListener('focus', checkSession);
        };
    }, [session?.user?.id, conflictUser]);

    useEffect(() => {
        (window as any).refreshAuthData = () => resolveIdentity(session);
        return () => { delete (window as any).refreshAuthData; };
    }, [resolveIdentity, session]);

    const resolveConflict = useCallback(async () => {
        if (!conflictUser) return;
        setLoading(true);
        try {
            await supabase.from('users').update({ photo_url: conflictUser.currentSessionId }).eq('id', conflictUser.uid);
            setConflictUser(null);
            await resolveIdentity(session);
        } catch (err) {
            console.error('Failed to update session ID:', err);
            setLoading(false);
        }
    }, [conflictUser, session, resolveIdentity]);

    const rejectConflict = useCallback(async () => {
        if (!conflictUser) return;
        setLoading(true);
        try {
            await supabase.auth.signOut();
            setConflictUser(null);
            localStorage.removeItem('setup_complete');
            localStorage.removeItem('user_role');
            localStorage.removeItem('tenant_id');
            setDbUser(null);
            setAppState({ ...INITIAL_APP_STATE });
            setLoading(false);
        } catch (err) {
            console.error('Failed to log out conflict:', err);
            setLoading(false);
        }
    }, [conflictUser]);

    const login = useCallback(
        (email: string, password: string) => supabase.auth.signInWithPassword({ email, password }),
        []
    );

    const logout = useCallback(async () => {
        try {
            const uid = session?.user?.id;
            if (uid) {
                await supabase.from('users').update({ photo_url: null }).eq('id', uid);
            }
        } catch (err) {
            console.warn('Failed to reset session on logout:', err);
        }
        try {
            localStorage.clear();
            sessionStorage.clear();
            await supabase.auth.signOut();
        } catch (e) {
            console.error(e);
        }
        window.location.replace('/login');
    }, [session]);

    const refreshDbUser = useCallback(async () => {
        await resolveIdentity(session);
    }, [session, resolveIdentity]);

    const value = useMemo<AuthContextValue>(
        () => ({
            session,
            user: session?.user ?? null,
            dbUser,
            loading,
            ...appState,
            conflictUser,
            resolveConflict,
            rejectConflict,
            login,
            logout,
            refreshDbUser,
            impersonationTenantId,
            setImpersonationTenantId
        }),
        [session, dbUser, loading, appState, conflictUser, resolveConflict, rejectConflict, login, logout, refreshDbUser, impersonationTenantId]
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within an <AuthProvider>.');
    return ctx;
}
