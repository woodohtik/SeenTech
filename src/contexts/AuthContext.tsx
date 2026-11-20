import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import type { Session, User as SupabaseUser } from '@supabase/supabase-js';

import { supabase } from '../lib/supabase/client';
import { setCurrentAuthSessionInfo } from '../lib/appErrors';
import { setLoggerUserContext } from '../lib/logger';
import { getDeviceSessionId } from '../utils/session';
import { getIsOnline } from '../lib/offline/connectivity';
import { cacheIdentitySnapshot, getCachedIdentitySnapshot } from '../lib/offline/identityCache';
import { fetchSessionIdentity, STAFF_IDENTITY_COLUMNS } from '../lib/sessionIdentity';
import { primeTenantRow } from '../lib/tenantRow';
import type { Database } from '../types/supabase';
import type { UserRole, Staff as StaffType } from '../types';

type UserRow  = Database['public']['Tables']['users']['Row'];
type StaffRow = Database['public']['Tables']['staff']['Row'];

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
    /**
     * True only when a logged-in user has no resolvable profile anywhere
     * (no staff row, no saas_users row, no tailor_requests row) -- almost
     * always a registration that failed partway through. Distinct from a
     * merely-unapproved request, so the UI can explain what happened instead
     * of silently signing the user back out.
     */
    hasNoProfile: boolean;
    /**
     * Set only when resolveIdentity itself threw (network blip, RLS/schema
     * issue, etc.) instead of cleanly resolving a state. Lets the UI show
     * "we couldn't verify your account, retry" rather than falling through
     * to whatever appState happened to be left over from before the call.
     */
    resolveError: string | null;
}

const INITIAL_APP_STATE: ResolvedAppState = {
    isApproved: false,
    userRole: null,
    tenantId: null,
    onboardingStep: 0,
    hasStaffWithPin: null,
    currentUserStaff: null,
    hasNoProfile: false,
    resolveError: null,
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

export function AuthProvider({ children }: { children: ReactNode }) {
    const [session, setSession] = useState<Session | null>(null);
    const [dbUser, setDbUser] = useState<DbUser | null>(null);
    const [loading, setLoading] = useState(true);
    const [conflictUser, setConflictUser] = useState<ConflictState | null>(null);
    // Whose identity is currently resolved and on screen (Phase 3.3/3.4).
    const resolvedUidRef = useRef<string | null>(null);
    // لا تُبذَر isApproved/userRole/tenantId من localStorage هنا -- loading
    // يبدأ true وAppContent (App.tsx ~457) يعرض MainSkeleton طالما loading
    // true، فلا يقرأ أي مكوّن appState قبل أن يُحسَم فعلياً عبر
    // resolveIdentity أدناه. البذر من localStorage كان يترك حالة قديمة (دور/
    // مستأجر من جلسة سابقة على نفس المتصفح) جاهزة في React state، فيومض
    // ظرفياً قبل أن يستبدلها resolveIdentity بالحالة الحقيقية.
    const [appState, setAppState] = useState<ResolvedAppState>({
        isApproved: false,
        userRole: null,
        tenantId: null,
        onboardingStep: 0,
        hasStaffWithPin: null,
        currentUserStaff: null,
        hasNoProfile: false,
        resolveError: null,
    });
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

    // seen-cto-sprint4-design-quality-task.md item 1: scope every Sentry
    // event from here on to the resolved identity, once, instead of each
    // call site passing tenant/user context by hand (which nothing did).
    // Reacts to resolveIdentity's own state, not a separate effect inside
    // it, so this stays correct across every one of its many setAppState
    // branches (including impersonation, which overrides the effective
    // tenant) without touching that function's own logic.
    useEffect(() => {
        const uid = session?.user?.id;
        if (!uid || !appState.userRole) {
            setLoggerUserContext(null);
            return;
        }
        setLoggerUserContext({
            uid,
            tenantId: impersonationTenantId || appState.tenantId,
            role: appState.userRole,
            branchId: appState.currentUserStaff?.branchId ?? null,
        });
    }, [session?.user?.id, appState.userRole, appState.tenantId, appState.currentUserStaff, impersonationTenantId]);

    // Resolves the full app-facing identity (device-session conflict, role,
    // tenant, onboarding step) from a Supabase session. This is the single
    // source of truth that used to be split between AuthContext (dbUser) and
    // App.tsx's own onIdTokenChanged listener (authState) under Firebase.
    const resolveIdentity = useCallback(async (nextSession: Session | null) => {
        if (localStorage.getItem('is_registering') === 'true') {
            // This flag is set right before an in-progress registration/Google
            // OAuth round-trip so this listener doesn't route the session
            // prematurely. It's only meant to live for a few seconds -- if the
            // tab was closed mid-flow, the redirect back lost its query param,
            // or any other interruption skipped the cleanup that normally
            // clears it, it would otherwise stay 'true' in localStorage forever
            // and permanently trap the whole app behind the loading skeleton
            // (App.tsx gates every route on `loading`, which never gets set to
            // false while this early-returns). Treat it as stale past a
            // generous window and resolve identity normally instead.
            const setAt = Number(localStorage.getItem('is_registering_at') || 0);
            const isStale = !setAt || Date.now() - setAt > 60_000;
            if (!isStale) return;
            localStorage.removeItem('is_registering');
            localStorage.removeItem('is_registering_at');
        }

        const user = nextSession?.user ?? null;

        if (!user) {
            resolvedUidRef.current = null;
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

        /* --------------------------------------------------------------
           seen-offline-sync-architecture-task.md Phase 5: a genuinely
           persisted session (persistSession: true) restores from
           localStorage synchronously even while offline, so `user` above
           is real -- but every lookup below needs the network. Without
           this, reloading the app mid-outage got stuck behind `loading`
           forever instead of getting back to a usable POS screen. Display
           only: setAppState below is the exact same call a real resolution
           makes, so nothing downstream can tell the difference, but every
           write this session performs still goes through the same
           server-side RLS check it always did regardless of what's
           sitting here locally.
           -------------------------------------------------------------- */
        if (!getIsOnline()) {
            const cached = getCachedIdentitySnapshot(uid);
            if (cached) {
                setAppState({
                    isApproved: cached.isApproved,
                    userRole: cached.userRole as UserRole | null,
                    tenantId: cached.tenantId,
                    onboardingStep: cached.onboardingStep,
                    hasStaffWithPin: cached.hasStaffWithPin,
                    currentUserStaff: cached.currentUserStaff as StaffType | null,
                    hasNoProfile: false,
                    resolveError: null,
                });
                setLoading(false);
                return;
            }
        }

        /* --------------------------------------------------------------
           seen-performance-first-open-login-task.md Phase 3.3 (stale-while-
           revalidate): someone coming back on this device sees the app
           straight away from the identity cached at their last visit, while
           the real resolution below runs. Display only, exactly like the
           offline path above -- every read and write still goes through
           RLS -- and the result below replaces it (a device conflict opens
           the usual window, a suspended shop or changed role takes the
           usual path).
           -------------------------------------------------------------- */
        const shownFromCache = (() => {
            if (resolvedUidRef.current === uid) return false; // already showing the real thing
            const cached = getCachedIdentitySnapshot(uid);
            if (!cached) return false;
            setAppState({
                isApproved: cached.isApproved,
                userRole: cached.userRole as UserRole | null,
                tenantId: cached.tenantId,
                onboardingStep: cached.onboardingStep,
                hasStaffWithPin: cached.hasStaffWithPin,
                currentUserStaff: cached.currentUserStaff as StaffType | null,
                hasNoProfile: false,
                resolveError: null,
            });
            setLoading(false);
            return true;
        })();

        // Phase 3: one request for every identity row (get_session_identity),
        // instead of five in a row. Its rows feed the same decisions below.
        let identity: Awaited<ReturnType<typeof fetchSessionIdentity>>;
        try {
            identity = await fetchSessionIdentity(uid);
        } catch (error: any) {
            if (shownFromCache) {
                // Keep the cached view rather than replace a working screen
                // with an error for a passing network blip; the next auth
                // event or the 60-second check tries again.
                console.warn('[AuthContext] identity refresh failed; keeping the cached view', error);
                return;
            }
            console.error('[CRITICAL] Auth verification failed:', error);
            setDbUser(null);
            setAppState(prev => ({
                ...prev,
                isApproved: false,
                hasNoProfile: false,
                resolveError: error?.message || String(error),
            }));
            setLoading(false);
            return;
        }

        resolvedUidRef.current = uid;
        // The shop's row is in the identity response; components opening
        // next read it from here instead of asking again (lib/tenantRow).
        primeTenantRow(identity.staff?.tenant_id, identity.tenant);

        {
            // What fetchDbUser used to build: the users row plus the role
            // (an active saas_users row first, then the custom role's key,
            // then staff.role) and the active staff row's tenant.
            const activeStaff = identity.staff?.status === 'active' ? identity.staff : null;
            let role: any = activeStaff?.role ?? null;
            const saas = identity.saas_user;
            if (saas && saas.is_active !== false) role = saas.role;
            else if (activeStaff?.role_id && identity.role_key) role = identity.role_key;
            const next = identity.user
                ? { ...(identity.user as UserRow), role, tenant_id: activeStaff?.tenant_id ?? null, staff_id: activeStaff?.id ?? null }
                : null;
            setDbUser(next as DbUser | null);
            if (next?.role !== 'super_admin') {
                localStorage.removeItem('impersonatedTenantId');
                setImpersonationTenantId(null);
            }
        }

        try {
            // Device-session-conflict check (single-active-device-per-account)
            const currentSessionId = getDeviceSessionId();
            const userRow = identity.user as { photo_url?: string | null } | null;

            if (userRow?.photo_url && userRow.photo_url !== currentSessionId) {
                setConflictUser({ uid, email, currentSessionId });
                setLoading(false);
                return;
            }
            setConflictUser(null);

            // Claiming the device session no longer holds up the app: it is
            // sent and not awaited (Phase 3.2). Only when it is not already ours.
            if (userRow && userRow.photo_url !== currentSessionId) {
                void supabase.from('users').update({ photo_url: currentSessionId }).eq('id', uid)
                    .then(({ error }) => { if (error) console.error('[AuthContext] claiming the device session failed', error); });
            }

            // Super admin is resolved below via the normal saas_users lookup
            // (step 3) — never via an email-string match. A hardcoded-email
            // auto-provisioning path used to live here, self-granting
            // super_admin (and writing a saas_users row) to whoever merely
            // registered with that literal address; removed as a critical
            // privilege-escalation risk. The legitimate super admin account
            // must already have (or be manually given) a saas_users row —
            // see supabase/migrations for the one-time seed script.

            // 1. Resolve profile: staff -> saas_users -> tailor_requests (all
            // already in `identity`; the same shapes the separate reads gave)
            const requestRes = { data: identity.tailor_request as any };
            const saasOverrideRes = { data: identity.saas_user as any };

            let staffData: any = identity.staff ? { ...identity.staff, tenant: identity.tenant } : null;
            let staffFromEmail = false;
            if (!staffData && email) {
                const { data: staffByEmail } = await supabase.from('staff').select(`${STAFF_IDENTITY_COLUMNS}, tenant:tenants(*)`).eq('email', email).maybeSingle();
                staffData = staffByEmail;
                staffFromEmail = Boolean(staffByEmail);
                if (staffData && !staffData.uid) {
                    await supabase.from('staff').update({ uid }).eq('id', staffData.id);
                }
            }

            if (staffData) {
                // saas_users takes precedence over the tenant staff role,
                // mirroring resolveDbUser's priority above (~line 124) --
                // otherwise a `staff.role` column holding a platform-level
                // value (super_admin, support_tech, billing_admin) would be
                // trusted directly for every super_admin guard app-wide,
                // without ever being backed by a real saas_users row.
                // seen-cto-code-review-2026-11-13.md AUTH-06: ignore a
                // deactivated saas_users row here too, same reasoning as
                // resolveDbUser above.
                const saasActive = saasOverrideRes.data && saasOverrideRes.data.is_active !== false;
                const role = (saasActive && saasOverrideRes.data ? saasOverrideRes.data.role : staffData.role) as UserRole;

                // The `tenant:tenants(*)` embed above can come back null on a
                // cold PostgREST read right after login (RLS on the embedded
                // tenants row denying access for a beat while the fresh
                // session's claims finish propagating across pooled
                // connections) even though staffData.tenant_id is present --
                // this is exactly the flash-then-recover "account not
                // eligible" screen users hit right after signing in. Retry a
                // direct, non-embedded read of the full tenant row (not just
                // status -- App.tsx's trial/subscription-expiry checks and
                // the header's workspace name read staffData.tenant.* too,
                // and were still silently seeing the stale null embed here
                // even after the isApproved flash itself got fixed) a
                // couple of times with backoff before concluding the
                // account isn't approved, mirroring the retry already used
                // below for a fresh-signup's cold tailor_requests read.
                let tenantRow: any = staffData.tenant ?? null;
                if (!tenantRow && staffData.tenant_id) {
                    // Phase 3.1: one direct retry instead of a loop of six
                    // (worst case ~8s behind the skeleton). The race this
                    // covered -- a fresh session's claims not yet visible to
                    // the tenants RLS on a pooled connection -- is far rarer
                    // now that the identity is a single read.
                    await new Promise((r) => setTimeout(r, 600));
                    const { data: fetchedTenant } = await supabase
                        .from('tenants')
                        .select('*')
                        .eq('id', staffData.tenant_id)
                        .maybeSingle();
                    tenantRow = fetchedTenant ?? null;
                    if (tenantRow) staffData.tenant = tenantRow;
                }

                const tenantStatus = tenantRow?.status ?? null;
                const approved = tenantStatus === 'active' || tenantStatus === 'approved' || tenantStatus === 'onboarding';
                const isPending = tenantStatus === 'pending';

                let staffPinCount = identity.has_staff_with_pin;
                if (staffFromEmail) {
                    try {
                        // pin_hash نفسها لم تعد قابلة للقراءة عبر PostgREST مباشرة
                        // (SELECT على العمود مسحوب من anon/authenticated) -- هذا
                        // فحص "وجود فقط" عبر RPC مخصَّص، لا يُرجع القيمة إطلاقاً.
                        const { data: pinIds } = await supabase.rpc('staff_ids_with_pin_set', { p_tenant_id: staffData.tenant_id });
                        staffPinCount = !!(pinIds && pinIds.length > 0);
                    } catch (e) { console.error('Error checking staff pins:', e); }
                }

                const mappedStaff = {
                    ...staffData,
                    tenantId: staffData.tenant_id,
                    branchId: staffData.branch_id,
                    pin: staffData.has_pin,
                    mustChangePin: staffData.must_change_pin
                };

                let step = 4;
                if (requestRes.data && (!requestRes.data.onboarding_step || requestRes.data.onboarding_step < 4)) {
                    step = requestRes.data.onboarding_step || 1;
                } else if (tenantStatus === 'onboarding') {
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
                            hasNoProfile: false,
                            resolveError: null,
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
                    hasNoProfile: false,
                    resolveError: null,
                });

                // Phase 5: snapshot for the offline-reload fallback above.
                cacheIdentitySnapshot(uid, {
                    isApproved: approved,
                    userRole: role,
                    tenantId: staffData.tenant_id,
                    onboardingStep: step,
                    hasStaffWithPin: staffPinCount,
                    currentUserStaff: mappedStaff,
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
            // seen-cto-code-review-2026-11-13.md AUTH-06: a deactivated row
            // here used to still resolve as a fully approved saas_users
            // session; now treated the same as no row at all, falling
            // through to the no-profile path below.
            const saasUser = identity.saas_user;
            if (saasUser && saasUser.is_active !== false) {
                setAppState({
                    isApproved: true,
                    userRole: saasUser.role as UserRole,
                    tenantId: 'saas',
                    onboardingStep: 4,
                    hasStaffWithPin: true,
                    currentUserStaff: null,
                    hasNoProfile: false,
                    resolveError: null,
                });
                localStorage.setItem('user_role', saasUser.role);
                localStorage.setItem('setup_complete', 'true');
                setLoading(false);
                return;
            }

            // Referral partner (standalone account, unrelated to any tenant) --
            // checked after staff/saas_users (which both return early above)
            // and before the tailor_requests fallback, so someone who already
            // has a tenant/staff/saas identity always resolves as that, never
            // flips into the partner UI.
            const partnerRow = identity.referral_partner;
            if (partnerRow) {
                setAppState({
                    isApproved: partnerRow.status === 'active',
                    userRole: 'referral_partner' as UserRole,
                    tenantId: 'referral_partner',
                    onboardingStep: 4,
                    hasStaffWithPin: false,
                    currentUserStaff: null,
                    hasNoProfile: false,
                    resolveError: null,
                });
                localStorage.setItem('user_role', 'referral_partner');
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
                    hasNoProfile: false,
                    resolveError: null,
                });
                if (approved) localStorage.setItem('setup_complete', 'true');
            } else {
                /*
                 * لا صف staff، لا saas_users، لا tailor_requests -- لكن هذا
                 * يحدث فعلياً بعد تسجيل جديد ناجح تماماً: Login.tsx يُنشئ صف
                 * tailor_requests هذا مباشرة قبل استدعاء resolveIdentity،
                 * وأحياناً لا يكون مرئياً فوراً لاستعلام PostgREST التالي
                 * (قد يمر عبر اتصال Postgres مُجمَّع pooled مختلف عن الذي
                 * نفّذ الإدراج). كانت هذه الحالة تظهر خطأً "لم يكتمل إعداد
                 * المتجر" لكل تسجيل جديد تقريباً رغم نجاحه فعلياً. نعيد
                 * المحاولة بضع مرات قصيرة أولاً — بلا أي نافذة ظاهرة، مجرد
                 * استعلام إضافي صامت أثناء شاشة التحميل — قبل الاستنتاج أن
                 * التسجيل فشل فعلاً.
                 */
                let foundOnRetry: any = null;
                for (let attempt = 0; attempt < 3 && !foundOnRetry; attempt++) {
                    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
                    const { data: retryRequest } = await supabase
                        .from('tailor_requests')
                        .select('*')
                        .eq('uid', uid)
                        .maybeSingle();
                    foundOnRetry = retryRequest;
                }

                if (foundOnRetry) {
                    const approved = foundOnRetry.status === 'approved';
                    setAppState({
                        isApproved: approved,
                        userRole: 'owner' as UserRole,
                        tenantId: null,
                        onboardingStep: foundOnRetry.onboarding_step || 1,
                        hasStaffWithPin: false,
                        currentUserStaff: null,
                        hasNoProfile: false,
                        resolveError: null,
                    });
                    if (approved) localStorage.setItem('setup_complete', 'true');
                } else {
                    // حقاً لا يوجد أي ملف تعريف حتى بعد المحاولات -- على
                    // الأرجح تسجيل فشل فعلاً في منتصف الطريق. نُظهر هذا
                    // صراحةً بدل تسجيل خروج صامت.
                    setAppState({
                        isApproved: false,
                        userRole: 'owner' as UserRole,
                        tenantId: null,
                        onboardingStep: 1,
                        hasStaffWithPin: false,
                        currentUserStaff: null,
                        hasNoProfile: true,
                        resolveError: null,
                    });
                }
            }
            setLoading(false);
        } catch (error: any) {
            console.error('[CRITICAL] Auth verification failed:', error);
            // Leaving appState untouched here used to mean the UI fell back
            // on whatever was resolved before this call (often the
            // logged-out default), which routed straight into
            // StaleAccountRedirect's silent sign-out -- a transient network
            // blip or RLS hiccup looked identical to "your account doesn't
            // exist". Surface it explicitly instead.
            setAppState(prev => ({
                ...prev,
                isApproved: false,
                hasNoProfile: false,
                resolveError: error?.message || String(error),
            }));
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
            // Phase 3.4: supabase-js re-emits SIGNED_IN every time the tab
            // becomes visible again (its visibility handler), which used to
            // re-run the whole resolution -- ~12 requests per tab switch.
            // Same person already resolved: nothing to do. A different
            // person, USER_UPDATED and SIGNED_OUT still resolve as before.
            if (event === 'SIGNED_IN' && nextSession?.user?.id && nextSession.user.id === resolvedUidRef.current) return;
            resolveIdentity(nextSession);
        });
        return () => sub.subscription.unsubscribe();
    }, [resolveIdentity]);

    // Periodic session validation (another device logged in / kicked this one out).
    // Routes through the same conflictUser modal the initial login check uses
    // instead of signing out unilaterally -- a silent hard sign-out here was
    // indistinguishable from "login is just broken", and any transient
    // read hiccup on the photo_url check (a dropped request, a stale read
    // right after a fresh device_session_id was generated) tore down a
    // perfectly valid session with zero explanation.
    useEffect(() => {
        const uid = session?.user?.id;
        const email = session?.user?.email || '';
        if (!uid || conflictUser) return;

        const currentSessionId = getDeviceSessionId();

        const checkSession = async () => {
            // A password-recovery session isn't a real "logged in on this
            // device" session - it must never be torn down by the
            // multi-device conflict check while the user is mid-reset.
            if (window.location.pathname === '/reset-password') return;
            // seen-offline-sync-architecture-task.md Phase 5: this used to
            // fire every 5s regardless of connectivity, failing silently
            // (the catch below) for as long as the device stayed offline --
            // a real check happens the moment connectivity actually returns
            // anyway (the interval's own next tick).
            if (!getIsOnline()) return;
            try {
                const { data: userRow } = await supabase.from('users').select('photo_url').eq('id', uid).maybeSingle();
                if (userRow?.photo_url && userRow.photo_url !== currentSessionId) {
                    console.log('[SESSION] Possible multi-device conflict detected, prompting user.');
                    setConflictUser({ uid, email, currentSessionId });
                }
            } catch (err) {
                console.warn('[SESSION] Periodic session check failed:', err);
            }
        };

        // seen-performance-first-open-login-task.md Phase 3.5: this used to
        // read users.photo_url every 5 seconds from every open tab, hidden
        // or not. Now:
        //  - Realtime on this person's own users row (migration
        //    20261228000001 publishes it): another device claiming the
        //    account shows the window within a moment;
        //  - one check when the tab becomes visible again (debounced);
        //  - a 60-second fallback while the tab is visible, in case the
        //    Realtime connection is down.
        const onRowChange = (payload: any) => {
            const photo = payload?.new?.photo_url;
            if (window.location.pathname === '/reset-password') return;
            if (photo && photo !== currentSessionId) {
                console.log('[SESSION] Another device claimed this account (realtime), prompting user.');
                setConflictUser({ uid, email, currentSessionId });
            }
        };
        const channel = supabase
            .channel(`device-session-${uid}`)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'users', filter: `id=eq.${uid}` }, onRowChange)
            .subscribe();

        let visibleTimer: number | null = null;
        const onVisible = () => {
            if (document.visibilityState !== 'visible') return;
            if (visibleTimer) window.clearTimeout(visibleTimer);
            visibleTimer = window.setTimeout(() => { visibleTimer = null; void checkSession(); }, 400);
        };
        const interval = window.setInterval(() => {
            if (document.visibilityState === 'visible') void checkSession();
        }, 60_000);
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('focus', onVisible);
        return () => {
            window.clearInterval(interval);
            if (visibleTimer) window.clearTimeout(visibleTimer);
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('focus', onVisible);
            void supabase.removeChannel(channel);
        };
    }, [session?.user?.id, session?.user?.email, conflictUser]);

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
