# حسابات شركاء الإحالة (Referral Partners) — خطة التنفيذ

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** إضافة نوع حساب جديد ومستقل تماماً عن حسابات التجار — "شريك إحالة" — يسجّل دخول/حساب من صفحة مستقلة، يُحيل تجاراً جدداً لسِين، ويرى رابطه ومحفظته وسجل إحالاته وطلبات سحبه في صفحة خاصة، مع زر وصول بشكل هدية 🎁 من صفحة الهبوط العامة.

**Architecture:** مجموعة جداول/RPCs موازية تماماً لبرنامج إحالة التجار الحالي (بلا أي تعديل عليه)، فرع جديد ومستقل في `AuthContext.tsx`'s `resolveIdentity` (يُفحَص بعد `staff`/`saas_users`، قبل fallback "لا ملف تعريف")، ومسار توجيه جديد `/partner/*` في `App.tsx` يوازي بنية `/admin/*` الحالية تماماً.

**Tech Stack:** React + TypeScript، Supabase (Postgres RPC + RLS)، Vitest (خدمات مع `supabase` مُقلَّد mocked).

**Spec:** `docs/superpowers/specs/2026-11-10-referral-partner-accounts-design.md`

## Global Constraints

- لا أي تعديل على `referrals`/`referral_wallets`/`withdrawal_requests`/`Referral.tsx`/`referralService.ts` الحالية — سلوكها يجب أن يبقى مطابقاً 100% لما هو قبل هذه الخطة.
- نفس أرقام المكافأة: 300 ر.س لكل إحالة مؤهَّلة خلال 30 يوماً، سحب متاح فوق 1000 ر.س (حصراً، لا "أو يساوي" — طبقاً لـ`request_withdrawal` الأصلي: `v_balance <= 1000` و`p_amount <= 1000` كلاهما يرفضان).
- RLS على كل جدول جديد: نفس نمط `USING (owner = app_identity() OR app_is_super_admin())` المستخدم في الجداول الأصلية، لكن المطابقة عبر `referral_partners.uid = auth.uid()` بدل `app_current_tenant_id()`.
- كل دالة RPC جديدة: `SECURITY DEFINER SET search_path=public` + فحص هوية صريح (نفس نمط `record_referral`/`request_withdrawal` الحيّ، لا نص `REFERRAL_program.sql` الأصلي بلا تحقق — انظر تحذير `20260910050000_backfill_referral_program.sql:5-13`).
- `npx tsc --noEmit` نظيف و`npx vitest run` كامل (لا تراجع) بعد كل مهمة تلمس كود TypeScript.

## Review Focus

- شخص يملك حساب تاجر/موظف (staff) فعلاً ويحاول أيضاً امتلاك حساب شريك إحالة بنفس uid: يجب أن يُحسَم دوماً كتاجر/موظف، لا كشريك — لأن فرع `staff` في `resolveIdentity` يُرجِع (return) مبكراً قبل فحص الفرع الجديد؛ Task 3 يضع الفرع الجديد في الموضع الصحيح تماماً (بعد `staff`/`saas_users`، قبل `tailor_requests`) ويُختبَر حيّاً في Task 7.
- طلب سحب شريك إحالة بمبلغ ≤ 1000 ر.س أو أكبر من الرصيد: يجب أن يُرفَض بنفس رسالة/منطق `request_withdrawal` الأصلي تماماً — Task 2 يختبر هذا عبر تمرير خطأ RPC المُقلَّد وتأكيد رميه.
- تطابق كود إحالة شريك مع كود إحالة تاجر (تصادم بين فضائي الأكواد): محلول بنيوياً في Task 1 بإعطاء أكواد الشركاء بادئة مختلفة (`'P'` بدل `'S'`) فلا يتطابق كود شريك مع استعلام جدول `tenants` أو العكس إطلاقاً.
- تعطيل برنامج شركاء الإحالة (`partner_referral_program.enabled=false`) أثناء وجود رصيد/طلبات سحب قائمة: يجب أن يبقى السحب والعرض متاحين (وضع قراءة فقط لرابط/مشاركة الإحالة الجديدة)، لا حجب كامل للصفحة — Task 5 يختبر هذا.
- شريك إحالة يحاول الوصول لأي مسار آخر في التطبيق (`/`, `/pos`, `/track/...`) بجلسته: يجب أن يُعاد توجيهه لـ`/partner/referrals` دوماً، لا أن يصطدم بشاشة تاجر فارغة أو عطل — Task 3 يضيف تحويلاً صريحاً لذلك، يُختبَر حيّاً في Task 7.

---

### Task 1: مايجريشن قاعدة البيانات — جداول ودوال شركاء الإحالة

**Files:**
- Create: `supabase/migrations/20261110000000_referral_partner_accounts.sql`

**Interfaces:**
- Produces: جداول `referral_partners(id, uid, name, email, phone, referral_code, status, created_at)`, `partner_wallets(partner_id, balance, total_earned, updated_at)`, `partner_referrals(id, partner_id, referred_tenant_id, reward_amount, status, qualified_until, created_at, credited_at)`, `partner_withdrawal_requests(id, partner_id, amount, iban, beneficiary, status, admin_note, requested_at, processed_at)`. دوال RPC: `ensure_partner_referral_code(p_partner uuid) RETURNS text`، `record_partner_referral(p_ref_code text, p_referred_tenant uuid) RETURNS void`، `confirm_partner_referral(p_referred_tenant uuid) RETURNS void`، `request_partner_withdrawal(p_partner uuid, p_amount numeric, p_iban text, p_beneficiary text) RETURNS uuid`، `process_partner_withdrawal(p_request uuid, p_approve boolean, p_note text) RETURNS void`، `list_pending_partner_withdrawals() RETURNS SETOF partner_withdrawal_requests`.

لا توجد مهمة سابقة تستهلكها هذه المهمة.

- [ ] **Step 1: كتابة المايجريشن الكامل**

اتبع تعريفات الجداول الحرفية في مستند التصميم (قسم "1) نموذج البيانات"، `docs/superpowers/specs/2026-11-10-referral-partner-accounts-design.md`) دون تغيير. لدوال RPC، اتبع نفس بنية/فحوصات الدوال الحيّة المقابلة في `supabase/migrations/20260910050000_backfill_referral_program.sql` (`ensure_referral_code`, `record_referral`, `confirm_referral`, `request_withdrawal`, `process_withdrawal`) حرفياً، مع هذين الفرقين الإلزاميين فقط:
  1. `ensure_partner_referral_code`: الفحص الأول يتحقق أن `p_partner` يطابق `referral_partners.id` الذي `uid = auth.uid()` (رفض `RAISE EXCEPTION` إن لم يطابق) — عكس `app_current_tenant_id()` الذي يُستخدم مباشرة كمصدر الهوية في الدوال الأصلية. كود التوليد: `'P' || upper(substr(encode(gen_random_bytes(4),'hex'),1,6))` — بادئة `P` (لا `S`) لضمان عدم تطابق كود شريك مع كود تاجر في `record_referral`/`record_partner_referral` إطلاقاً (Review Focus).
  2. `record_partner_referral`: بعد إيجاد `v_partner` من `referral_partners.referral_code = p_ref_code`، أضف فحصاً: `IF EXISTS (SELECT 1 FROM referrals WHERE referred_tenant_id = p_referred_tenant) THEN RETURN; END IF;` (بالإضافة لفحص `partner_referrals` المكرَّر نفسه) — يمنع احتساب تاجر مُحال فعلاً من نظام إحالة التجار الأصلي ضمن نظام الشركاء أيضاً.
  3. المُشغِّل (trigger) `tenants_confirm_referral` الحالي (نفس الملف، سطر 101-111): عدِّل جسم `trg_confirm_referral()` بإضافة سطر `PERFORM confirm_partner_referral(NEW.id);` بعد `PERFORM confirm_referral(NEW.id);` الموجود — لا تُنشئ مُشغِّلاً جديداً، كلا الاستدعاءين على المُشغِّل الحالي نفسه، كل دالة تفحص جدولها فقط فتُرجِع بصمت إن لم تجد صفاً مطابقاً.
  4. `list_pending_partner_withdrawals()`: نفس بنية `listPendingWithdrawals`/`process_withdrawal`'s `app_is_super_admin()` فحص، تُرجِع `SELECT * FROM partner_withdrawal_requests WHERE status='pending' ORDER BY requested_at ASC`.

RLS: فعِّل RLS على الأربعة، وأضف سياسة `SELECT` واحدة لكل جدول (`partner_own`، نفس اسم النمط `wallet_own`/`ref_own`/`wr_own`) تطابق عبر `partner_id IN (SELECT id FROM referral_partners WHERE uid = auth.uid()) OR app_is_super_admin()` (أو `referral_partners.uid = auth.uid()` مباشرة لجدول `referral_partners` نفسه). `GRANT EXECUTE` على كل الدوال الخمس لـ`authenticated` (نفس نمط الأصل).

- [ ] **Step 2: تطبيق المايجريشن على staging والتحقق**

Run: `cd supabase && supabase link --project-ref yodvqhdjzjyhvrlhguzf && supabase db push`
Expected: المايجريشن يُطبَّق بلا أخطاء. تحقَّق يدوياً بـ`psql`/Supabase SQL editor أن الجداول الأربعة موجودة بالأعمدة الصحيحة وأن `\df public.*partner*` يُظهر الدوال الخمس. (لا يوجد سقالة اختبار SQL آلي في هذا المشروع — نفس قاعدة التحقق اليدوي المستخدمة لكل مايجريشن سابق في هذه الجلسة.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20261110000000_referral_partner_accounts.sql
git commit -m "feat(referral-partners): add partner referral schema and RPCs"
```

---

### Task 2: `partnerReferralService.ts` — طبقة الخدمة

**Files:**
- Create: `src/services/partnerReferralService.ts`
- Create: `src/services/partnerReferralService.test.ts`

**Interfaces:**
- Consumes: RPCs من Task 1 (`ensure_partner_referral_code`, `record_partner_referral`, `request_partner_withdrawal`, `list_pending_partner_withdrawals`, `process_partner_withdrawal`)، وجدول `saas_settings` (قراءة مفتاح `'partner_referral_program'`، نفس بنية `getReferralProgramSettings` في `src/services/referralService.ts:28-36`).
- Produces: `export interface PartnerWallet { balance: number; total_earned: number; }`، `export interface PartnerReferralRow { id: string; referred_tenant_id: string; reward_amount: number; status: string; created_at: string; qualified_until?: string; credited_at?: string; }`، `export interface PartnerWithdrawal { id: string; partner_id?: string; amount: number; iban?: string; beneficiary?: string; status: string; admin_note?: string; requested_at: string; processed_at?: string; }`، `export interface PartnerReferralProgramSettings { enabled: boolean; rewardPerReferral: number; minWithdrawal: number; }`، التوابع: `getPartnerReferralProgramSettings()`, `ensurePartnerReferralCode(partnerId: string): Promise<string>`, `partnerReferralLink(code: string): string`, `getPartnerWallet(partnerId: string): Promise<PartnerWallet>`, `listPartnerReferrals(partnerId: string): Promise<PartnerReferralRow[]>`, `recordReferralOnPartnerSignup(refCode: string, referredTenantId: string): Promise<void>`, `requestPartnerWithdrawal(partnerId: string, amount: number, iban: string, beneficiary: string): Promise<string>`, `listMyPartnerWithdrawals(partnerId: string): Promise<PartnerWithdrawal[]>`, `listPendingPartnerWithdrawals(): Promise<PartnerWithdrawal[]>`, `processPartnerWithdrawal(requestId: string, approve: boolean, note?: string): Promise<void>`.

- [ ] **Step 1: كتابة الاختبارات الفاشلة**

انسخ بنية `src/services/inventoryService.test.ts:1-35` (نفس أسلوب `vi.mock('../lib/supabase/client', ...)` مع `fromMock`/`rpcMock`). اختبارات مطلوبة:

```typescript
test('requestPartnerWithdrawal forwards amount/iban/beneficiary to request_partner_withdrawal RPC and returns its id', async () => {
  rpcMock.mockResolvedValue({ data: 'wd-123', error: null });
  const id = await requestPartnerWithdrawal('partner-1', 1500, 'SA0000000000000000000000', 'فلان');
  expect(rpcMock).toHaveBeenCalledWith('request_partner_withdrawal', {
    p_partner: 'partner-1', p_amount: 1500, p_iban: 'SA0000000000000000000000', p_beneficiary: 'فلان',
  });
  expect(id).toBe('wd-123');
});

test('requestPartnerWithdrawal throws when the RPC returns an error (e.g. below minimum)', async () => {
  rpcMock.mockResolvedValue({ data: null, error: { message: 'الحد الأدنى للسحب أكثر من 1000 ر.س' } });
  await expect(requestPartnerWithdrawal('partner-1', 500, 'SA0', 'فلان')).rejects.toBeTruthy();
});

test('recordReferralOnPartnerSignup calls record_partner_referral with the code and tenant id, and swallows RPC errors', async () => {
  rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } });
  await expect(recordReferralOnPartnerSignup('P1A2B3', 'tenant-9')).resolves.toBeUndefined();
  expect(rpcMock).toHaveBeenCalledWith('record_partner_referral', { p_ref_code: 'P1A2B3', p_referred_tenant: 'tenant-9' });
});

test('recordReferralOnPartnerSignup is a no-op when refCode is empty', async () => {
  await recordReferralOnPartnerSignup('', 'tenant-9');
  expect(rpcMock).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: تشغيل الاختبارات والتأكد من فشلها**

Run: `npx vitest run src/services/partnerReferralService.test.ts`
Expected: FAIL — `Cannot find module './partnerReferralService'` أو ما يعادله (الملف غير موجود بعد).

- [ ] **Step 3: تنفيذ `partnerReferralService.ts`**

نفس بنية `src/services/referralService.ts` حرفياً (كل تابع يستدعي RPC/جدول مقابل بنفس الأسلوب)، مع `partnerReferralLink` تُرجِع `${SITE}/?ref=${code}` (نفس `SITE = 'https://seen.sa'` الثابت الحالي). `recordReferralOnPartnerSignup` لا يرمي أبداً (يُطبِّق `console.warn` عند الخطأ، نفس نمط `recordReferralOnSignup` الأصلي سطر 60-64) — هذا ما يثبته اختبار "swallows RPC errors" أعلاه.

- [ ] **Step 4: تشغيل الاختبارات والتأكد من نجاحها**

Run: `npx vitest run src/services/partnerReferralService.test.ts`
Expected: PASS (4/4)

- [ ] **Step 5: Commit**

```bash
git add src/services/partnerReferralService.ts src/services/partnerReferralService.test.ts
git commit -m "feat(referral-partners): add partner referral service layer"
```

---

### Task 3: المصادقة والتوجيه — فرع `referral_partner` في `AuthContext`/`App.tsx`

**Files:**
- Modify: `src/types/index.ts` (نوع `UserRole`, حوالي السطر 121-132)
- Modify: `src/contexts/AuthContext.tsx` (دالة `resolveIdentity`, حوالي السطر 428-446)
- Modify: `src/App.tsx` (حوالي السطر 110، 375-385، 461-462، 619-621، 632-742)

**Interfaces:**
- Consumes: جدول `referral_partners` من Task 1 (`id, uid, status`).
- Produces: `UserRole` يضم `'referral_partner'`. `AuthContext`'s `appState.userRole === 'referral_partner'` و`appState.tenantId === 'referral_partner'` عندما يملك المستخدم صف `referral_partners` مطابق. `App.tsx`'s `isReferralPartner: boolean` (بجانب `isSaaSStaff` الموجود). مسار `/partner/*` يُستهلَك في Task 4/5 (حالياً بصفحات مؤقتة placeholder، تُستبدَل هناك).

- [ ] **Step 1: إضافة `'referral_partner'` لنوع `UserRole`**

في `src/types/index.ts`، أضف `| 'referral_partner'` ضمن اتحاد `UserRole` (بعد `'accountant'` أو أي موضع في القائمة).

- [ ] **Step 2: إضافة الفرع الجديد في `resolveIdentity`**

في `src/contexts/AuthContext.tsx`، أضف فحصاً جديداً **بعد** كتلة "3. SaaS staff" (تنتهي عند `return;` بعد `setLoading(false);`، حوالي السطر 445) و**قبل** كتلة "4. Onboarding request" (`let request = requestRes.data;`، حوالي السطر 449). هذا الموضع إلزامي (Review Focus: شخص له حساب تاجر/موظف يُحسَم دوماً كتاجر، لأن الفرع أعلاه (`staffData`) يُرجِع مبكراً قبل الوصول لهذا الكود، والفرع الجديد يُفحَص بعد `saas_users` وقبل `tailor_requests`):

```typescript
// Referral partner (standalone account, unrelated to any tenant)
const { data: partnerRow } = await supabase.from('referral_partners').select('id, status').eq('uid', uid).maybeSingle();
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
```

- [ ] **Step 3: إضافة `isReferralPartner` وتوجيهاتها في `App.tsx`**

بجانب تعريف `isSaaSStaff` (حوالي السطر 380-384)، أضف:
```typescript
const isReferralPartner = userRole === 'referral_partner';
```

أضف `'/partner/'` إلى `PUBLIC_ROUTE_PREFIXES` (المصفوفة المُعرَّفة بعد `MeasurementsRoute`، أُنشئت في إصلاح سابق هذا الأسبوع) — **إلزامي** (Review Focus: موظف تاجر مسجَّل دخول في نفس المتصفح يفتح `/partner/login` يجب ألا يُعترَض ببوابات `conflictUser`/انتهاء الاشتراك/`needsPinSetup`/`showPinLogin` التي تسبق كتلة `<Routes>`، تماماً كخلل `/measurements/:token` المُصلَح هذا الأسبوع):
```typescript
const PUBLIC_ROUTE_PREFIXES = ['/track/', '/p/inv/', '/measurements/', '/partner/'];
```

أضف مسار جديد داخل `<Routes>` (بجانب `/admin/*`، حوالي السطر 742، بنفس بنيته تماماً — `React.lazy` + `React.Suspense`):
```tsx
<Route
  path="/partner/*"
  element={
    isReferralPartner ? (
      <React.Suspense fallback={<PageSkeleton />}>
        <Routes>
          <Route path="/referrals" element={<PartnerReferrals />} />
          <Route path="*" element={<Navigate to="/partner/referrals" />} />
        </Routes>
      </React.Suspense>
    ) : (
      <React.Suspense fallback={<PageSkeleton />}>
        <PartnerLogin />
      </React.Suspense>
    )
  }
/>
```
(`PartnerReferrals`/`PartnerLogin` يُستورَدان كـ`React.lazy` بجانب استيرادات `SaaSLayout`/`AdminTailors` الحالية — سيُنشآن في Task 4/5؛ إلى حين ذاك اجعلهما يستوردان من مسار سيُنشأ، و`tsc`/`vitest` لن يمرّا حتى تكتمل Task 4/5، فنفِّذ هذه الخطوة وTask 4/5 كوحدة تسليم واحدة قبل تشغيل الفحص النهائي لهذه المهمة — لا تُشغِّل Step 4 أدناه إلا بعد وجود الملفين).

أخيراً، أضف تحويلاً صريحاً (Review Focus: شريك إحالة يفتح أي مسار آخر غير `/partner/*` يجب أن يُعاد توجيهه، لا أن يصطدم بشاشة تاجر): في كتلة `userRole === 'super_admin' && !impersonationTenantId ? <Navigate to="/admin/dashboard" /> : (...)` الموجودة في مسارَي `/` (حوالي السطر 788 و920)، أضف شرطاً مماثلاً قبلها: `isReferralPartner ? <Navigate to="/partner/referrals" /> :`.

- [ ] **Step 4: فحص الأنواع والاختبارات (بعد اكتمال Task 4/5)**

Run: `npx tsc --noEmit && npx vitest run`
Expected: لا أخطاء أنواع، كل الاختبارات تمر (لا تراجع). لا يوجد ملف اختبار مخصَّص لـ`AuthContext.tsx`/`App.tsx` في هذا المشروع (لا سابقة لذلك) — هذا الفحص + الاختبار الحي في Task 7 هما التحقق المعتمَد لهذه المهمة، بنفس أسلوب كل تعديل سابق على هذين الملفين هذه الجلسة.

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/contexts/AuthContext.tsx src/App.tsx
git commit -m "feat(referral-partners): wire referral_partner auth resolution and routing"
```

---

### Task 4: صفحة `/partner/login`

**Files:**
- Create: `src/components/public/PartnerLogin.tsx`
- Modify: `src/i18n/locales/ar.json`, `src/i18n/locales/en.json`, `src/i18n/locales/ur.json` (مفاتيح `partner_login.*`)

**Interfaces:**
- Consumes: `supabase.auth.signUp`/`signInWithPassword` (مباشرة، نفس `src/components/Login.tsx`)، `ensurePartnerReferralCode` من Task 2 (تُستدعى بعد إنشاء صف `referral_partners`، لتوليد الكود فوراً بدل الانتظار لأول زيارة لصفحة الإحالات).
- Produces: `export default function PartnerLogin()` — يُستورَد في Task 3's `App.tsx`.

- [ ] **Step 1: تنفيذ `PartnerLogin.tsx`**

نسخة مبسَّطة من بنية `src/components/Login.tsx` (نفس `ViewMode`/`IconInput`/`Button`/تبديل دخول↔تسجيل)، بالفروقات الإلزامية:
- لا زر Google، لا معالجة `?ref=` (شركاء الإحالة لا يُحالون في v1 — حسب المستند).
- حقول التسجيل: الاسم، الجوال أو البريد (حقل واحد بدل حقلين — اختياري أيهما)، كلمة المرور. عند الإرسال: `supabase.auth.signUp({ email, password })` (إن أُدخِل جوال فقط بلا بريد، استخدم نمط بريد مُركَّب كما يفعل أي تدفّق جوال-فقط آخر في المشروع إن وُجد، أو اطلب بريداً دوماً كحقل إلزامي وجوالاً اختيارياً — اتخذ القرار الأبسط: بريد إلزامي + جوال اختياري، يطابق حقلي `referral_partners.email`/`phone` كلاهما NULLABLE في Task 1) ثم `supabase.from('referral_partners').insert({ uid: user.id, name, email, phone, status: 'active' })` ثم `ensurePartnerReferralCode(partnerId)`.
- عند فشل إدراج `referral_partners` بعد نجاح `signUp` (بريد/جوال مستخدم فعلاً — قيد `UNIQUE`): اعرض رسالة خطأ واضحة (نفس نمط `t('login.errors.email_exists')`)، بلا طبقة `is_registering` lock (غير مطلوبة هنا، لا سباق مع `resolveIdentity` بما أن هذه الصفحة مستقلة ولا AuthContext عام يتزاحم معها على نفس الشاشة أثناء التسجيل).
- بعد نجاح التسجيل/الدخول: `(window as any).refreshAuthData?.()` ثم `navigate('/partner/referrals')`.

- [ ] **Step 2: إضافة مفاتيح الترجمة**

أضف مفتاح `partner_login` في الثلاث ملفات (`ar.json`/`en.json`/`ur.json`) بالمفاتيح الفرعية التي يستخدمها المكوّن (العنوان، الوصف، تسمية الحقول، رسائل الخطأ) — انسخ أسلوب مفاتيح `login.*` الموجودة.

- [ ] **Step 3: فحص الأنواع**

Run: `npx tsc --noEmit`
Expected: لا أخطاء (قد تبقى أخطاء Task 3's استيراد `PartnerReferrals` غير الموجودة بعد — طبيعي، يُحسَم في Task 5).

- [ ] **Step 4: Commit**

```bash
git add src/components/public/PartnerLogin.tsx src/i18n/locales/ar.json src/i18n/locales/en.json src/i18n/locales/ur.json
git commit -m "feat(referral-partners): add partner login/signup page"
```

---

### Task 5: صفحة `/partner/referrals`

**Files:**
- Create: `src/components/public/PartnerReferrals.tsx`
- Modify: `src/i18n/locales/ar.json`, `src/i18n/locales/en.json`, `src/i18n/locales/ur.json` (مفاتيح `partner_referral.*`)

**Interfaces:**
- Consumes: كل توابع `partnerReferralService.ts` من Task 2، `useAuth()` من `AuthContext.tsx` (لقراءة `dbUser`/الـ`uid` الحالي، ثم استعلام `referral_partners` عن `id` المطابق — أو تمرير `partner_id` مباشرة إن أضافته Task 3's `AuthContext` لـ`DbUser`؛ الأبسط: هذا المكوّن يستعلم هو نفسه `referral_partners` عن `id` بـ`uid = session.user.id` عند التحميل، تماماً كما يفعل `useEffect` تحميل أولي عادي — لا حاجة لتعديل `DbUser`/`AuthContext` إضافياً).
- Produces: `export default function PartnerReferrals()` — يُستورَد في Task 3's `App.tsx`.

- [ ] **Step 1: تنفيذ `PartnerReferrals.tsx`**

نسخة من بنية `src/components/Referral.tsx` الكاملة (نفس التصميم المرئي بالضبط: بطاقة محفظة، رابط+نسخ+واتساب، سجل إحالات، سجل سحوبات، `WithdrawModal`) لكن:
- بدل الحصول على `tenantId` كـ prop، يحصل المكوّن على `partnerId` بنفسه داخلياً: `useEffect` أول يستعلم `supabase.from('referral_partners').select('id').eq('uid', session.user.id).maybeSingle()` (`session` من `useAuth()`)، ثم يُحمِّل بقية البيانات بـ`partnerId` الناتج (بنفس تسلسل `load()` الحالي في `Referral.tsx:39-53`، لكن بتوابع `partnerReferralService.ts`: `ensurePartnerReferralCode`, `partnerReferralLink`, `getPartnerWallet`, `listPartnerReferrals`, `listMyPartnerWithdrawals`, `getPartnerReferralProgramSettings`).
- زر "طلب سحب" يستدعي `requestPartnerWithdrawal` بدل `requestWithdrawal`.
- أضف زر/رابط "تسجيل خروج" ظاهر في أعلى الصفحة (الصفحة لا تملك `Layout`/`SaaSLayout` عاماً يوفّر ذلك) يستدعي `useAuth().logout()`.

- [ ] **Step 2: إضافة مفاتيح الترجمة**

أضف مفتاح `partner_referral` في الثلاث ملفات، بنفس المفاتيح الفرعية الموجودة تحت `referral.*` حرفياً (نفس النصوص، نطاق مفاتيح مختلف فقط) — نسخ مباشر يكفي.

- [ ] **Step 3: فحص الأنواع والاختبارات الكاملة**

Run: `npx tsc --noEmit && npx vitest run`
Expected: لا أخطاء أنواع (الآن `PartnerLogin`/`PartnerReferrals` كلاهما موجودان فتحقَّق Task 3's استيرادات بنجاح)، كل الاختبارات تمر.

- [ ] **Step 4: Commit**

```bash
git add src/components/public/PartnerReferrals.tsx src/i18n/locales/ar.json src/i18n/locales/en.json src/i18n/locales/ur.json
git commit -m "feat(referral-partners): add partner referrals dashboard page"
```

---

### Task 6: دمج شاشة مراجعة السحب الإدارية

**Files:**
- Modify: `src/components/SaaSWithdrawals.tsx`

**Interfaces:**
- Consumes: `listPendingPartnerWithdrawals`, `processPartnerWithdrawal` من Task 2 (بجانب `listPendingWithdrawals`/`processWithdrawal` الحاليين من `referralService.ts`، بلا تعديل عليهما).

- [ ] **Step 1: دمج القائمتين مع شارة المصدر**

في `load()` (السطر 25-34)، اجلب القائمتين بـ`Promise.all` (`listPendingWithdrawals()` و`listPendingPartnerWithdrawals()`)، أضف حقل مصدر لكل صف (`{ ...row, source: 'tenant' as const }` / `{ ...row, source: 'partner' as const }`)، ودمجهما مُرتَّبتين بـ`requested_at`. في `act(id, approve)` (السطر 43-60)، اختر `processWithdrawal`/`processPartnerWithdrawal` بحسب `source` الصف المطابق لـ`id`. أضف عموداً/شارة صغيرة في الجدول (نفس نمط `badge`/`cn` المستخدم في بقية المشروع) تعرض "تاجر" أو "شريك إحالة" حسب `source`.

- [ ] **Step 2: فحص الأنواع والاختبارات**

Run: `npx tsc --noEmit && npx vitest run`
Expected: لا أخطاء، لا تراجع.

- [ ] **Step 3: Commit**

```bash
git add src/components/SaaSWithdrawals.tsx
git commit -m "feat(referral-partners): merge partner withdrawals into admin review screen"
```

---

### Task 7: زر الهدية في صفحة الهبوط + ربط التسجيل بالإحالة + اختبار شامل حيّ

**Files:**
- Modify: `src/components/LandingPage.html` (أو ما يعادله ضمن أصول الصفحة الثابتة)
- Modify: `public/assets/landing-bridge.js` (أو مسارها الفعلي — تحقَّق بـ`Glob` عند التنفيذ)
- Modify: `src/components/Login.tsx` (دالة `recordReferralOnSignup` استدعاؤها، حوالي السطر 486-489)

**Interfaces:**
- Consumes: `recordReferralOnPartnerSignup` من Task 2.

- [ ] **Step 1: زر الهدية**

أضف زراً بشكل هدية 🎁 في `LandingPage.html` (الموضع: شريط التنقل العلوي، بجانب زر "ابدأ الآن" الحالي — ابحث عنه بـ`Grep` قبل التعديل). أضف معالج نقر في `landing-bridge.js` يُرسِل `window.parent.postMessage({ type: 'NAVIGATE', path: '/partner/login' }, window.location.origin)` — نفس آلية إرسال زر "ابدأ الآن" الحالي تماماً (ابحث عن معالجه الحالي بـ`Grep` لنسخ الصيغة الدقيقة).

- [ ] **Step 2: ربط تسجيل تاجر جديد بكود شريك إحالة**

في `src/components/Login.tsx`'s `handleRegister` (حوالي السطر 486-489)، بعد استدعاء `recordReferralOnSignup(refCode, tenantId)` الحالي، أضف استدعاء `recordReferralOnPartnerSignup(refCode, tenantId).catch(() => {})` مباشرة بعده — كلا الاستدعاءين يُرسِلان نفس `refCode`؛ كل RPC يفحص جدوله فقط (بادئة الكود `'S'`/`'P'` من Task 1 تمنع التطابق الخاطئ)، فلا تعارض ولا ازدواج.

- [ ] **Step 3: فحص الأنواع والاختبارات**

Run: `npx tsc --noEmit && npx vitest run`
Expected: لا أخطاء، لا تراجع.

- [ ] **Step 4: Commit**

```bash
git add src/components/LandingPage.html <landing-bridge.js الفعلي> src/components/Login.tsx
git commit -m "feat(referral-partners): add landing page entry point and signup linkage"
```

- [ ] **Step 5: اختبار حي شامل على staging (يدوي، حسب تفضيل المستخدم المسجَّل — حساب تجريبي لا حساب عميل حقيقي)**

اتبع تسلسل الاختبار الكامل في مستند التصميم (قسم "الاختبار")، بما يشمل تحديداً Review Focus الخمسة أعلاه:
1. تسجيل حساب شريك جديد من `/partner/login` → توجيه تلقائي لـ`/partner/referrals` مع رابط إحالة ظاهر.
2. تسجيل تاجر جديد عبر رابط الشريك، تفعيل اشتراكه (تحديث `subscription_status` يدوياً أو عبر تدفّق اشتراك حقيقي)، تأكيد احتساب المكافأة في محفظة **الشريك** فقط (لا تاجر).
3. تأكيد أن محفظة/سجل إحالات تاجر موجود مسبقاً (نظام الإحالة الأصلي) لم يتأثر إطلاقاً.
4. طلب سحب من حساب الشريك، ظهوره في `/admin/withdrawals` بشارة "شريك إحالة"، معالجته بنجاح.
5. تسجيل دخول كتاجر/موظف موجود مسبقاً (نفس المتصفح) وفتح `/partner/login` مباشرة — يجب ألا تظهر شاشة تسجيل دخول/قفل خاصة بالتاجر (Review Focus #1 و#5).
6. الضغط على زر الهدية في صفحة الهبوط العامة والتأكد من الوصول لـ`/partner/login`.

لا commit لهذه الخطوة (اختبار يدوي فقط). عند اكتمالها بنجاح، تابع بـ`superpowers:finishing-a-development-branch`.
