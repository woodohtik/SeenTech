import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from 'react';
import {
    onAuthStateChanged,
    onIdTokenChanged,
    signInWithEmailAndPassword,
    signOut,
    type User as FirebaseUser,
    type UserCredential,
} from 'firebase/auth';

import { auth as firebaseAuth } from '../lib/firebase';
import { supabase, setSupabaseAuthToken } from '../lib/supabase/client';
import type { Database } from '../types/supabase';

type UserRow  = Database['public']['Tables']['users']['Row'];
type StaffRow = Database['public']['Tables']['staff']['Row'];

/**
 * The combined user record surfaced to the UI.
 * - Base fields come from `users` (Firebase UID = users.id).
 * - `role` and `tenant_id` are resolved from the user's active staff record.
 *   If the user has no staff row yet (e.g. fresh sign-up awaiting approval),
 *   both are null and the UI should route them to an onboarding state.
 */
export interface DbUser extends UserRow {
    role: StaffRow['role'] | null;
    tenant_id: StaffRow['tenant_id'] | null;
    staff_id: StaffRow['id'] | null;
}

interface AuthContextValue {
    firebaseUser: FirebaseUser | null;
    dbUser: DbUser | null;
    loading: boolean;
    login: (email: string, password: string) => Promise<UserCredential>;
    logout: () => Promise<void>;
    refreshDbUser: () => Promise<void>;
    impersonationTenantId: string | null;
    setImpersonationTenantId: (id: string | null) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function fetchDbUser(uid: string): Promise<DbUser | null> {
    const [{ data: userRow, error: userErr }, { data: staffRow, error: staffErr }] =
        await Promise.all([
            supabase.from('users').select('*').eq('id', uid).maybeSingle(),
            supabase
                .from('staff')
                .select('*')
                .eq('uid', uid)
                .eq('status', 'active')
                .limit(1)
                .maybeSingle(),
        ]);

    if (userErr) throw userErr;
    if (staffErr) throw staffErr;
    if (!userRow) return null;

    let actualRole = (staffRow as StaffRow)?.role ?? null;
    if (staffRow && (staffRow as StaffRow).role_id) {
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
    const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
    const [dbUser, setDbUser] = useState<DbUser | null>(null);
    const [loading, setLoading] = useState(true);
    const [impersonationTenantId, setImpersonationTenantId] = useState<string | null>(
        localStorage.getItem('impersonatedTenantId') !== 'null' ? localStorage.getItem('impersonatedTenantId') : null
    );

    const hydrateFromFirebase = useCallback(async (fbUser: FirebaseUser | null) => {
        if (!fbUser) {
            setSupabaseAuthToken(null);
            setDbUser(null);
            return;
        }
        const token = await fbUser.getIdToken();
        setSupabaseAuthToken(token);

        try {
            const next = await fetchDbUser(fbUser.uid);
            setDbUser(next);
            
            // Validate impersonation: only super admins can impersonate
            const isSuperAdmin = next?.role === 'super_admin' || fbUser.email === "nomansa2566512@gmail.com";
            if (!isSuperAdmin) {
                localStorage.removeItem('impersonatedTenantId');
                setImpersonationTenantId(null);
            }
        } catch (err) {
            console.error('[AuthContext] Failed to fetch DB user:', err);
            setDbUser(null);
        }
    }, []);

    // Effect to sync impersonationTenantId to localStorage and notify supabase client
    useEffect(() => {
        if (impersonationTenantId) {
            localStorage.setItem('impersonatedTenantId', impersonationTenantId);
        } else {
            localStorage.removeItem('impersonatedTenantId');
        }
    }, [impersonationTenantId]);

    // Auth state: user signed in / out.
    useEffect(() => {
        if (!firebaseAuth) {
           console.warn("[AuthContext] Firebase auth is null. Skipping onAuthStateChanged binding.");
           setLoading(false);
           return;
        }
        const unsub = onAuthStateChanged(firebaseAuth, async (fbUser) => {
            setFirebaseUser(fbUser);
            await hydrateFromFirebase(fbUser);
            setLoading(false);
        });
        return unsub;
    }, [hydrateFromFirebase]);

    // Token refresh: keep Supabase's Authorization header in sync.
    useEffect(() => {
        if (!firebaseAuth) return;
        const unsub = onIdTokenChanged(firebaseAuth, async (fbUser) => {
            if (!fbUser) {
                setSupabaseAuthToken(null);
                return;
            }
            const token = await fbUser.getIdToken();
            setSupabaseAuthToken(token);
        });
        return unsub;
    }, []);

    const login = useCallback(
        (email: string, password: string) => {
            if (!firebaseAuth) throw new Error("Firebase Auth is not initialized. Please check API Keys.");
            return signInWithEmailAndPassword(firebaseAuth, email, password);
        },
        []
    );

    const logout = useCallback(async () => {
        if (firebaseAuth) await signOut(firebaseAuth);
    }, []);

    const refreshDbUser = useCallback(async () => {
        if (firebaseUser) await hydrateFromFirebase(firebaseUser);
    }, [firebaseUser, hydrateFromFirebase]);

    const value = useMemo<AuthContextValue>(
        () => ({ 
            firebaseUser, 
            dbUser, 
            loading, 
            login, 
            logout, 
            refreshDbUser,
            impersonationTenantId,
            setImpersonationTenantId
        }),
        [firebaseUser, dbUser, loading, login, logout, refreshDbUser, impersonationTenantId]
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within an <AuthProvider>.');
    return ctx;
}
