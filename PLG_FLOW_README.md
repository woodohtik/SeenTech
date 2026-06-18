# تدفّق PLG — التجربة المجانية (14 يوم) + متابعة السيلز

## الفلو الكامل
1. الزائر على اللاندنق `/` → **«ابدأ تجربتك ١٤ يوم مجاناً»** أو **«اشترك الآن مباشرة»**.
2. **التجربة:** ينشئ حساباً → يُزوَّد له tenant تجربة (14 يوم) **مع بيانات تجريبية جاهزة** وكل المميزات.
3. عند التسجيل → يُسجَّل **lead** (status='trial') مربوط بالـ tenant.
4. أعلى الداشبورد **شريط عدّاد تنازلي** بالأيام المتبقية.
5. **24 ساعة بلا دفع** → الـlead يصير **SLG** + تنبيه للسيلز يتواصل.
6. **انتهت الـ14 يوم** → النظام **يُقفل** (شاشة قفل)، والبيانات تبقى **30 يوم** (عدّاد ينقص كل يوم على شاشة القفل).
7. لم يشترك خلال الـ30 يوم → **تُحذف بيانات التجربة** (لكن جوال وإيميل العميل يبقيان محفوظين دائماً لمنع تكرار التجربة). اشترك خلال المهلة → **تفعيل دائم** والبيانات تبقى.

## الملفات المبنية
| الملف | الدور | الحالة |
|---|---|---|
| `PLG_trial_lifecycle.sql` | حقول التجربة + دوال + كنّاسات pg_cron (SLG/قفل/حذف) + جدول `sales_notifications` | شغّله في Supabase |
| `services/trialService.ts` | بدء التجربة، زرع البيانات، التقاط lead، حساب حالة التجربة | جاهز للتوصيل |
| `services/paymentService.ts` | طبقة دفع **محايدة للبوابة** (واجهة موحّدة + adapters: Moyasar / PayMob) | يحتاج اختيار المزوّد + مفاتيح |
| `src/components/TrialBanner.tsx` | شريط العدّاد أعلى الداشبورد | جاهز للتوصيل |
| `src/components/TrialLockOverlay.tsx` | شاشة القفل بعد الانتهاء + طمأنة الحذف | جاهز للتوصيل |
| `seen-landing-page.html` | أزرار CTA → `/login?intent=trial` و`?intent=subscribe` | تم |

## خطوات التوصيل
### 1) قاعدة البيانات
شغّل `PLG_trial_lifecycle.sql` (يضيف الأعمدة، الدوال، ويجدول الكنّاسات). تأكّد `create extension if not exists pg_cron;`.

### 2) عند التسجيل (في `Onboarding.tsx` / تدفّق إنشاء الحساب)
**أولاً امنع تكرار التجربة:** افحص هوية العميل قبل منح تجربة جديدة. إن سبق له التجربة → لا تمنح تجربة، وجّهه للاشتراك.
```ts
import { startTrial, seedTrialData, captureTrialLead, hasUsedTrial } from '../../services/trialService';

if (await hasUsedTrial(phone, email)) {
  // استهلك تجربته سابقاً → لا تجربة جديدة
  navigate('/subscribe');
  return;
}
await startTrial(tenantId);                 // 14 يوم
await seedTrialData(tenantId);              // بيانات تجريبية
await captureTrialLead({ name, phone, email, businessType, tenantId }); // يسجّل الهوية الدائمة (Trigger)
```
> الجوال والإيميل يُحفظان في `trial_identities` (جدول لا يُحذف عند كنس البيانات)، فحتى بعد حذف بيانات التجربة لا يستطيع العميل أخذ تجربة مجانية جديدة بنفس الرقم/الإيميل.

### 3) شريط العدّاد (أعلى `Dashboard.tsx` أو داخل `Layout`)
```tsx
import TrialBanner from './TrialBanner';
<TrialBanner subscriptionStatus={tenant.subscription_status}
             trialEndsAt={tenant.trial_ends_at}
             onSubscribe={() => navigate('/subscribe')} />
```

### 4) القفل (في `Layout`/`App` بعد المصادقة)
```tsx
import TrialLockOverlay from './TrialLockOverlay';
{tenant.subscription_status === 'locked' &&
  <TrialLockOverlay purgeAt={tenant.purge_at} onSubscribe={() => navigate('/subscribe')} />}
```
> أضِف أيضاً قراءة الحقول الجديدة (`subscription_status`, `trial_ends_at`, `purge_at`) ضمن استعلام الـ tenant، وعدّل واجهة `Tenant` في `src/types/index.ts` لتشملها.

### 5) الاشتراك المباشر (بوابة الدفع — محايدة)
> البوابة بعد غير محسومة (ربما PayMob). الكود محايد: يختار المزوّد من `PAYMENT_PROVIDER` ('moyasar' | 'paymob')، فالتبديل سطر إعداد واحد بلا تغيير منطق الاشتراك.
- أضِف مساراً `/subscribe` يعرض نموذج البوابة المختارة بالواجهة (مفتاح قابل للنشر).
- خادمياً: `POST /api/payments` يستدعي `getPaymentProvider().createPayment(...)`، و`/api/payments/callback` يستدعي
  `settleSubscriptionPayment(paymentId, tenantId, (id)=>supabaseAdmin.rpc('activate_tenant_subscription',{p_tenant_id:id}))`.
- عند حسم البوابة: عبّئ مفاتيحها (`MOYASAR_SECRET_KEY` أو `PAYMOB_API_KEY`)، وأكمل الـadapter وتحقّق توقيع الـwebhook. adapter الـPayMob حالياً stub فيه TODOs.

### 6) تنبيه السيلز (SLG)
اربط جدول `sales_notifications` بقناة فعلية عبر Supabase Edge Function أو Webhook (واتساب/سلاك/بريد) يستمع على الإدراج.

### 7) `intent` في اللاندنق
اللاندنق توجّه إلى `/login?intent=trial` و`?intent=subscribe`. في تدفّق الدخول/التسجيل اقرأ `intent`:
- `trial` → بعد إنشاء الحساب، نفّذ خطوة (2) ووجّه للداشبورد.
- `subscribe` → بعد الحساب، وجّه لصفحة `/subscribe`.
