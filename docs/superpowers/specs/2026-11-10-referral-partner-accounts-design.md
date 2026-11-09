# حسابات "شركاء الإحالة" (Referral Partners) — مستند التصميم

**الحالة:** معتمَد من المستخدم (محادثة بتاريخ 2026-11-10) — جاهز للانتقال لخطة التنفيذ.

## السياق والهدف

زر بشكل هدية 🎁 في صفحة الهبوط العامة ينقل أي زائر لصفحة تسجيل دخول/إنشاء حساب **مستقلة عن حسابات التجار**، خاصة بأشخاص يُحيلون تجاراً جدداً لسِين مقابل مكافأة مالية. بعد تسجيل الدخول يرون صفحة إحالاتهم (رابط، محفظة، سجل إحالات، طلب سحب).

**القرارات المعتمَدة من المستخدم:**
1. من يُحيل صاحب الإحالة؟ **تجار جدد يشتركون في سِين** (نفس هدف برنامج الإحالة الحالي بين التجار).
2. آلية المكافأة: **نفس الآلية الحالية** — 300 ر.س لكل إحالة مؤهَّلة (اشتراك فعلي خلال 30 يوماً من التسجيل)، سحب متاح عند تجاوز 1000 ر.س، مراجعة إدارية يدوية قبل الدفع.
3. التسجيل: **فوري ذاتي** (اسم + جوال أو بريد + كلمة مرور) — بدون موافقة إدارية قبل التفعيل.

## خارج النطاق (v1)

- شركاء الإحالة لا يُحيلون عملاء نهائيين لمحلات التجار — فقط تجاراً جدداً يشتركون في سِين.
- لا تعديل على برنامج إحالة التجار الحالي (`referrals`/`referral_wallets`/`withdrawal_requests`/`Referral.tsx`) — يبقى كما هو تماماً، بلا أي تغيير في سلوكه أو جدوله.
- لا شاشة إدارية لإنشاء/تعطيل حسابات شركاء الإحالة يدوياً من سِين في v1 (التسجيل ذاتي بالكامل). تعطيل حساب شريك مخالف يبقى عملية قاعدة بيانات يدوية حتى تُطلب شاشة لذلك.
- لا تسجيل دخول Google لشركاء الإحالة في v1 (بريد/جوال + كلمة مرور فقط) — تبسيطاً، يمكن إضافته لاحقاً بسهولة بما أن `Login.tsx` يحتوي النمط جاهزاً.

## المعماريّة

### 1) نموذج البيانات — مجموعة جداول موازية، منفصلة عن جداول برنامج إحالة التجار

**السبب:** الجداول الحالية (`referrals`, `referral_wallets`, `withdrawal_requests`) مرتبطة ببنية `tenant_id` في كل مستوى: مفتاح أساسي (`referral_wallets.tenant_id` هو PK نفسه)، قيود FK على `tenants`، سياسات RLS ودوال RPC (`record_referral`, `request_withdrawal`) تتحقق حصرياً من `app_current_tenant_id()`. هذه بيانات مالية حيّة قيد الاستخدام الفعلي في الإنتاج الآن من تجار حقيقيين. توسيعها لتقبل فاعلاً من نوع مختلف (شريك لا تاجر) يتطلب تعديل بنية PK/FK لجداول مالية مُشغَّلة فعلياً — خطر غير ضروري. مجموعة موازية بنفس المنطق تماماً تُحقِّق المطلوب بلا أي خطر على ما هو قائم.

```sql
-- شريك الإحالة نفسه (حساب مستقل تماماً عن tenants/staff)
CREATE TABLE public.referral_partners (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uid           uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  name          text NOT NULL,
  email         text UNIQUE,
  phone         text UNIQUE,
  referral_code text UNIQUE,
  status        text NOT NULL DEFAULT 'active',  -- 'active' | 'suspended'
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.partner_wallets (
  partner_id   uuid PRIMARY KEY REFERENCES public.referral_partners(id) ON DELETE CASCADE,
  balance      numeric(12,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  total_earned numeric(12,2) NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.partner_referrals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id         uuid NOT NULL REFERENCES public.referral_partners(id) ON DELETE CASCADE,
  referred_tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  reward_amount      numeric(12,2) NOT NULL DEFAULT 300,
  status             text NOT NULL DEFAULT 'pending',  -- 'pending' | 'credited' | 'expired' | 'rejected'
  qualified_until    timestamptz NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  credited_at        timestamptz,
  UNIQUE (referred_tenant_id)  -- تاجر واحد يُحسَب لمُحيل واحد فقط (شريك أو تاجر آخر، الفحص عبر التطبيق)
);

CREATE TABLE public.partner_withdrawal_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id   uuid NOT NULL REFERENCES public.referral_partners(id) ON DELETE CASCADE,
  amount       numeric(12,2) NOT NULL CHECK (amount > 0),
  iban         text,
  beneficiary  text,
  status       text NOT NULL DEFAULT 'pending',
  admin_note   text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
```

**ملاحظة اتساق:** `referred_tenant_id UNIQUE` هنا (مثل الجدول الأصلي) يمنع ازدواج الحساب لتاجر واحد *داخل* جدول شركاء الإحالة، لكن لا يمنع تاجر من أن يُحسَب لمُحيلَين من نوعين مختلفين (تاجر آخر عبر `referrals`، وشريك عبر `partner_referrals`) في حال استخدامه كودي إحالة من كلا النظامين. هذا يُحسَم على مستوى RPC: `record_partner_referral` (أدناه) يرفض التسجيل إن كان التاجر مُحالاً فعلاً عبر `referrals` الأصلي، وبالعكس — `record_referral` الحالي لا يحتاج تعديلاً لأنه يفحص فقط جدوله هو.

**دوال RPC** (توازي دوال `referralService.ts`/`backfill_referral_program.sql` تماماً، بفحص هوية شريك بدل تاجر):

- `ensure_partner_referral_code(p_partner uuid) RETURNS text` — نفس منطق `ensure_referral_code` (توليد كود + ضمان صف محفظة)، لكن يتحقق أولاً أن `p_partner` يطابق صف `referral_partners` الذي `uid = auth.uid()`.
- `record_partner_referral(p_ref_code text, p_referred_tenant uuid) RETURNS void` — نفس منطق `record_referral`، إضافة: يرفض (`RETURN` بصمت) إن وُجد التاجر فعلاً في `referrals.referred_tenant_id` (مُحال من قبل تاجر آخر مسبقاً).
- `confirm_partner_referral(p_referred_tenant uuid) RETURNS void` — نفس منطق `confirm_referral`، يُستدعى من **نفس** المُشغِّل (trigger) `tenants_confirm_referral` الحالي على `tenants.subscription_status` (تعديل بسيط: السطر الذي يستدعي `confirm_referral` يستدعي أيضاً `confirm_partner_referral` — كلاهما بلا تأثير متبادل، كل دالة تفحص جدولها فقط).
- `request_partner_withdrawal(p_partner uuid, p_amount numeric, p_iban text, p_beneficiary text) RETURNS uuid` — نفس منطق `request_withdrawal` بفحص هوية شريك.
- `process_partner_withdrawal(p_request uuid, p_approve boolean, p_note text) RETURNS void` — نفس منطق `process_withdrawal` (يتطلب `app_is_super_admin()`، بلا تغيير في هذا الفحص).

**RLS:** نفس نمط `wallet_own`/`ref_own`/`wr_own` الحالي، بمطابقة عبر صف `referral_partners` الذي `uid = auth.uid()` بدل `app_current_tenant_id()`.

**إعدادات البرنامج:** مفتاح `saas_settings` جديد ومستقل `'partner_referral_program'` (نفس شكل `'referral_program'` الحالي: `enabled`, `rewardPerReferral`, `minWithdrawal`) — مستقل عمداً عن إعدادات برنامج إحالة التجار، بحيث يمكن لسِين تعطيل أحدهما دون الآخر.

### 2) المصادقة والتوجيه — فرع ثالث مستقل في سلسلة تحليل الهوية

`AuthContext.tsx`'s `resolveIdentity` تفحص اليوم بالترتيب: `staff` → `saas_users` → `tailor_requests` (fallback: "لا ملف تعريف"). سأضيف فحصاً جديداً **مستقلاً تماماً** لـ`referral_partners` (uid = المستخدم الحالي)، بنفس أسلوب فحص `saas_users` الحالي (سطر ~430) حرفياً: استعلام واحد، وإن وُجد صف فعُيِّن:
```
tenantId: 'referral_partner'
userRole: 'referral_partner'   // قيمة جديدة تُضاف لـ UserRole في types/index.ts
```
تماماً كما تُستخدم اليوم `tenantId: 'saas'` لموظفي سِين. هذا الفرع يُفحَص **قبل** fallback "لا ملف تعريف" مباشرة (بعد فحص `saas_users` وقبل فحص `tailor_requests`)، فلا يُصنَّف شريك الإحالة خطأً كـ"تسجيل فاشل".

`App.tsx`: `isReferralPartner = userRole === 'referral_partner'` (بجانب `isSaaSStaff` الموجود، بلا تعديل عليه)، تُوجَّه لمسار جديد `/partner/*` بتخطيط (layout) خاص به — مستقل تماماً عن شجرة توجيه التاجر/سِين. بوابات `isPublicRoute`/`needsPinSetup`/انتهاء الاشتراك (المعدَّلة هذا الأسبوع) تبقى بلا أي تغيير: جميعها تفحص `isSaaSStaff`/`tenantId` بطرق لا تتقاطع مع `tenantId === 'referral_partner'`، لكن يجب التحقق من كل بوابة عند التنفيذ (تفصيل في الخطة، لا في هذا المستند) أن القيمة الجديدة لا تُفعِّلها خطأً.

### 3) الصفحات

- **`/partner/login`**: نسخة مبسَّطة جداً من بنية `Login.tsx` (نفس تبديل تسجيل دخول/تسجيل حساب، نفس مكوّنات `IconInput`/`Button`) لكن:
  - التسجيل: `supabase.auth.signUp` ثم إدراج صف واحد في `referral_partners` فقط (بلا أي من خطوات إنشاء tenant/branch/staff/plans الخاصة بـ`Login.tsx`).
  - لا رابط Google، لا "؟ref=" (شركاء الإحالة لا يُحالون هم أنفسهم في v1).
- **`/partner/referrals`**: إعادة استخدام بنية `Referral.tsx` الكاملة (نفس التصميم المرئي: بطاقة محفظة، رابط+نسخ+واتساب، سجل إحالات، سجل سحوبات، نافذة طلب سحب) موصولة بـ`partnerReferralService.ts` جديد يوازي `referralService.ts` (نفس التوابع بأسماء موازية: `ensurePartnerReferralCode`, `getPartnerWallet`, `listPartnerReferrals`, `requestPartnerWithdrawal`, `listMyPartnerWithdrawals`).
  - رابط الإحالة الناتج: `https://seen.sa/?ref=<code>` (نفس شكل رابط التاجر تماماً) — `Login.tsx`'s `recordReferralOnSignup` الحالي يحتاج توسعة بسيطة: عند توقيع تاجر جديد بكود `?ref=`، يُحاول أولاً `record_referral` (كود تاجر)، وإن فشل/لم يُطابق، يُحاول `record_partner_referral` (كود شريك). كلا RPC يرجع بصمت إن لم يُطابق الكود جدوله، فلا تعارض.

### 4) شاشة مراجعة السحب الإدارية

`SaaSWithdrawals.tsx` تُعدَّل لتجمع `listPendingWithdrawals()` (تاجر) و`listPendingPartnerWithdrawals()` (شريك) في قائمة واحدة مُرتَّبة بالتاريخ، مع عمود/شارة جديدة تُميِّز المصدر ("تاجر" / "شريك إحالة"). زرَّا الموافقة/الرفض يستدعيان `processWithdrawal`/`processPartnerWithdrawal` حسب مصدر الصف. بلا تغيير آخر في تصميم الشاشة.

### 5) زر الهدية في صفحة الهبوط

صفحة الهبوط الفعلية HTML ثابت (`LandingPage.html`) تُعرَض داخل iframe (`srcDoc`)، والتنقل يتم عبر `postMessage` من داخل الـiframe إلى `LandingPage.tsx` (مُعالَج بالفعل في `useEffect` الحالي، سطر ~15-45) الذي يستدعي `navigate(path)`. سأضيف:
- زر بشكل هدية 🎁 في `LandingPage.html` (الموقع الدقيق — شريط التنقل العلوي أو قسم الهيرو — يُحسَم عند التنفيذ بالنظر الفعلي للصفحة).
- معالج نقر في `landing-bridge.js` يرسل `{ type: 'NAVIGATE', path: '/partner/login' }` — تماماً كما يفعل زر "ابدأ الآن" الحالي.
- لا حاجة لتمرير `?ref=` هنا (شركاء الإحالة لا يُحالون في v1).

## معالجة الأخطاء

- تسجيل شريك إحالة بجوال/بريد مستخدم فعلاً (في `referral_partners` نفسها): رسالة خطأ واضحة، نفس نمط `login.errors.email_exists`/`phone_exists` الحالي في `Login.tsx`.
- فشل إدراج صف `referral_partners` بعد نجاح `auth.signUp` (مثل الحالة الموجودة فعلاً مع تسجيل تاجر فاشل جزئياً): يُترَك مستخدم Supabase Auth بلا صف شريك — عند الدخول التالي، فرع `referral_partners` في `resolveIdentity` لا يجد صفاً، فيستمر الفحص لبقية السلسلة (`tailor_requests` ثم "لا ملف تعريف") — نفس السلوك الموجود فعلاً لحالة تسجيل تاجر فاشل جزئياً، بلا حاجة لمنطق جديد.
- برنامج شركاء الإحالة معطَّل (`partner_referral_program.enabled = false`): نفس نمط `Referral.tsx`'s `disabledNotice` الحالي — رابط/مشاركة معطَّلان، سحب الرصيد القائم يبقى متاحاً.

## الاختبار

- اختبارات وحدة (Vitest) لمنطق `partnerReferralService.ts` (نفس بنية اختبارات `referralService.ts` إن وُجدت، أو اختبارات جديدة تماماً إن لم توجد).
- اختبار حي على staging (حساب تجريبي، لا حساب عميل حقيقي — حسب تفضيل المستخدم المسجَّل):
  1. تسجيل حساب شريك إحالة جديد من `/partner/login`.
  2. التأكد من التوجيه التلقائي لـ`/partner/referrals` وعرض رابط الإحالة.
  3. إنشاء تاجر جديد عبر رابط الشريك (`?ref=<code>`)، تفعيل اشتراكه، والتأكد أن `confirm_partner_referral` احتسب المكافأة في محفظة الشريك الصحيحة (لا محفظة تاجر).
  4. التأكد أن برنامج إحالة التجار الحالي (محفظة/سجل إحالات تاجر موجود مسبقاً) لم يتأثر إطلاقاً.
  5. طلب سحب من حساب الشريك، والتأكد من ظهوره في `SaaSWithdrawals.tsx` بشارة "شريك إحالة" ومعالجته بنجاح.
  6. الضغط على زر الهدية في صفحة الهبوط العامة والتأكد من الوصول لـ`/partner/login`.
