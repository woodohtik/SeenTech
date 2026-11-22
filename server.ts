import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import dotenv from 'dotenv';
import helmet from "helmet";
import { globalRateLimiter } from "./src/server/rateLimiter.ts";
import { authenticate, authorize } from "./src/server/middleware/authMiddleware.ts";
import { requirePermission, hasPermission, taxFingerprint } from './src/server/middleware/requirePermission.ts';
import { registerPrintRelay } from "./src/server/printRelay.ts";
import { initServerLogger, captureServerException, logger } from "./src/server/logger.ts";
import { isValidMeasurementUnit } from "./src/utils/measurementUnits.ts";
import { normalizeFabricEstimateSettings } from "./src/utils/fabricEstimate.ts";
import { resolveTaxSettings } from "./src/utils/taxSettings.ts";
import { listArticles, getArticle, createArticle, updateArticle, deleteArticle, previewArticle, fetchAllArticles } from "./src/server/blogAdmin.ts";
import { triggerBlogRebuild } from "./src/server/blogDeployHook.ts";
import { validateMeasurementsPayload } from "./src/server/validateMeasurementsPayload.ts";

// { path: [...] }, not bare dotenv.config() -- this repo has no .env file,
// only .env.local (written by `vercel env pull`); bare dotenv.config() only
// looks for .env and silently loads nothing (verified directly). This
// call's own position here is actually moot for the imports above (ES
// module imports evaluate first -- see src/server/rateLimiter.ts's
// comment), which is exactly why rateLimiter.ts/firebase-admin.ts/
// supabase-admin.ts each also call this themselves; kept here too for
// anything in this file itself that reads process.env at module scope.
dotenv.config({ path: ['.env.local', '.env'] });
initServerLogger();

const app = express();

// بلا هذا، Express لا يثق بترويسة X-Forwarded-For إطلاقاً و req.ip يرجع
// عنوان وكيل Vercel الداخلي نفسه لكل الطلبات -- فكل تحديد معدّل مبني على IP
// (المحدّد العام أدناه، /api/staff/verify-pin، printRelay.ts، ونقطة تتبّع
// الطلب العامة) كان إما يُطبَّق على "IP" واحد وهمي مشترك بين كل المستخدمين،
// أو -- إن اعتُمِد على الترويسة مباشرة بلا `trust proxy` -- قابلاً للتزييف
// الكامل من طالب الخدمة نفسه (Express يتجاهل الترويسة المزوَّرة فقط عندما
// لا يثق بها؛ قراءتها يدوياً كما في clientIp() أدناه لا تحلّ هذا). Vercel
// يمرّ عبر قفزة وكيل واحدة موثوقة قبل الوصول لدالة السيرفر.
app.set('trust proxy', 1);

// seen-structured-logging-task.md: every request gets a child pino logger
// carrying a correlation id, attached to req.log so every handler below can
// log structured JSON instead of console.*. Reuses Vercel's own x-vercel-id
// when present (ties our log lines to Vercel's own request trace) instead
// of inventing a second id; falls back to a fresh UUID for local dev where
// that header doesn't exist. tenant_id/staff_id get added by authenticate()
// itself once it resolves req.user, not here -- this runs before auth.
app.use((req: any, res, next) => {
  const requestId = (req.headers['x-vercel-id'] as string) || crypto.randomUUID();
  req.log = logger.child({ requestId });
  next();
});

// E-2 (security-fix-tasklist.md) / seen-master-backlog-and-structure.md P4:
// CSP allowlist below is the result of a full repo survey of every external
// origin the client actually loads scripts/styles/fonts/images from, or
// connects to (fetch/XHR/WebSocket) -- Google Identity Services (login),
// Firebase Auth + FCM (still used for auth/push, not Firestore/Storage),
// Supabase (REST + Realtime WebSocket + Storage), Google Fonts, OpenStreetMap
// (address picker in onboarding), and api.ipify.org. Moyasar (payments) is
// server-side only today (paymentService.ts calls it directly from Node,
// never from the browser) so it deliberately has no browser CSP entry yet --
// add one if a client-side Moyasar widget is ever introduced.
//
// script-src has no 'unsafe-inline': confirmed both index.html and the built
// dist/index.html only ever load external <script src="..."> tags, never an
// inline block. style-src keeps 'unsafe-inline' -- auditing every React
// inline style={} usage across the whole app to remove it isn't proportional
// here, and inline *style* injection is a far lower-severity CSP gap than
// inline *script* injection (which this policy does fully close).
//
// VITE_SUPABASE_URL/VITE_FIREBASE_AUTH_DOMAIN are read from the same .env
// dotenv already loads above -- Vite only *filters* which VITE_-prefixed
// vars reach the browser bundle, it doesn't hide them from plain Node
// process.env, so the server can derive the exact project host instead of
// hardcoding it.
const supabaseHost = (() => {
  try { return new URL(process.env.VITE_SUPABASE_URL || '').host; } catch { return ''; }
})();
const firebaseAuthDomain = process.env.VITE_FIREBASE_AUTH_DOMAIN || '';

// crossOriginOpenerPolicy is explicitly relaxed to same-origin-allow-popups
// (Google's own recommendation for Identity Services): helmet's default
// same-origin COOP isolates the Google Sign-In popup from window.opener,
// breaking the postMessage-based credential handoff Login.tsx relies on.
//
// IMPORTANT -- this CSP is duplicated in vercel.json's own `headers` block.
// vercel.json's rewrites send every non-/api/* request straight to the
// static index.html, bypassing this Express app (and this helmet
// middleware) entirely -- so THAT copy, not this one, is what actually
// reaches the browser for real page loads in production/staging on Vercel.
// This one only governs /api/* responses and local `npm run dev`. Found
// live (2026-09-27): a style-src fix landed here but not in vercel.json,
// so production kept serving the old header. Any CSP change here must be
// mirrored in vercel.json's headers[0].headers, or it never ships.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://accounts.google.com', 'https://www.gstatic.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://accounts.google.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: [
        "'self'", 'data:', 'blob:',
        ...(supabaseHost ? [`https://${supabaseHost}`] : []),
        'https://*.tile.openstreetmap.org',
        'https://firebasestorage.googleapis.com',
      ],
      connectSrc: [
        "'self'",
        ...(supabaseHost ? [`https://${supabaseHost}`, `wss://${supabaseHost}`] : []),
        'https://accounts.google.com',
        'https://oauth2.googleapis.com',
        'https://identitytoolkit.googleapis.com',
        'https://securetoken.googleapis.com',
        'https://fcmregistrations.googleapis.com',
        'https://fcm.googleapis.com',
        'https://firebaseinstallations.googleapis.com',
        'https://api.ipify.org',
        'https://nominatim.openstreetmap.org',
        // Sentry stays a no-op until VITE_SENTRY_DSN is set (src/lib/logger.ts)
        // -- pre-allowing its ingest hosts now means turning monitoring on
        // later needs no CSP follow-up.
        'https://*.ingest.sentry.io',
        'https://*.ingest.us.sentry.io',
        'https://*.ingest.de.sentry.io',
      ],
      frameSrc: [
        "'self'",
        'https://accounts.google.com',
        ...(firebaseAuthDomain ? [`https://${firebaseAuthDomain}`] : []),
      ],
      workerSrc: ["'self'", 'https://www.gstatic.com'],
      manifestSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
    },
  },
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  // Same reasoning as COOP above: helmet's default require-corp COEP has its
  // own known conflicts with Google Identity Services' cross-origin iframe/
  // script -- left disabled since nothing here asked for it and getting it
  // wrong risks the exact same login breakage this whole CSP pass is trying
  // to avoid.
  crossOriginEmbedderPolicy: false,
}));
// seen-ux-fixes-batch-task.md #3: /api/health had no exception -- a branch
// with several cashier devices sharing one IP could exceed 120 req/min
// across ALL of them combined, and the connectivity check itself (the one
// request that must never be rate-limited, or the app wrongly reports
// "offline" while the internet is actually fine) would get a 429 like any
// other route.
//
// seen-rate-limiting-redis-task.md: was express-rate-limit's in-memory
// MemoryStore -- ineffective on Vercel serverless, each function instance
// keeps its own counter. Now backed by Upstash Redis (fail-open on Upstash
// errors, see src/server/rateLimiter.ts).
app.use(globalRateLimiter((req) => req.path === '/api/health' || req.path === '/api/ping'));

// حجم كبير لأن بيانات الرسم النقطي للفاتورة قد تصل لعدة ميغابايت
app.use(express.json({ limit: '25mb' }));

// CORS لمسارات /api/public/* فقط (seen-companion-app-android-task.md, Track B).
// تطبيق العميل الأصلي يعمل من أصل https://localhost (خادم Capacitor
// المحلي)، فأي طلب لهذا الأصل الحقيقي (staging.seentech.io) يُعتبر
// cross-origin -- اكتُشف هذا فعلياً عبر اختبار حي على جهاز حقيقي (كل طلبات
// /api/public/order-lookup كانت تُحجَب بصمت من WebView قبل هذا الإصلاح).
// آمن لأن هذه المسارات عامة بالتصميم أصلاً (بلا كوكيز، بلا جلسة) --
// الحماية الفعلية هي رمز التتبّع/رقم الفاتورة+الجوال وتحديد المعدّل، لا
// أصل الطلب. لا يمسّ أي مسار آخر (موظف/مصادَق).
app.use('/api/public', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // helmet's default Cross-Origin-Resource-Policy: same-origin blocks a
  // cross-origin fetch's response from being read by the page even when
  // CORS headers above allow it -- CORP is enforced independently of CORS.
  // Override it for this same public-by-design surface only.
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

// Express 4 لا يمرّر رفض Promise غير ملتقط من معالج async إلى next(err)
// تلقائياً -- فيفلت من middleware معالجة الأخطاء العام أسفل الملف ويبقى
// الطلب معلّقًا حتى ينتهي وقت دالة Vercel. استخدم هذا الغلاف لأي مسار async
// جديد لا يغلّف جسمه بـ try/catch بنفسه (معظم المسارات الحالية تفعل ذلك
// يدويًا، فهذا مخصص للمسارات المستقبلية).
function asyncHandler(
  fn: (req: express.Request, res: express.Response, next: express.NextFunction) => Promise<any>
) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/* ================================================================
   وسيط الطباعة  —  SEEN POS Printing
   ----------------------------------------------------------------
   كل مسارات /api/print/* معرّفة في src/server/printRelay.ts:

     • الوسيط السحابي (relay): جهاز الكاشير يتصل خارجاً وينتظر المهام،
       فتعمل الطباعة الصامتة من أي جهاز — ويندوز أو أندرويد — بدون أي
       اتصال بـ localhost، وبذلك نتجاوز حجب Local Network Access و
       Mixed Content الذي كان يجعل الوسيط يبدو «غير مُشغَّل».

     • الطباعة المباشرة على طابعة شبكة (TCP 9100) عند تشغيل السيرفر
       داخل شبكة المتجر.
   ================================================================ */

registerPrintRelay(app);

// API Routes

// C-1 (security-fix-tasklist.md): this endpoint is intentionally
// unauthenticated (a public invoice link), so it must never return more
// than PublicInvoice.tsx actually renders. The previous version spread the
// full `orders`/`tenants`/`customers` rows into the response, leaking
// customer phone/measurements, tenant owner_email/owner_uid/commercial_register,
// and internal order fields (notes, images, created_by, branch_id) to anyone
// who guessed or was handed an invoice id.
//
// Also fixed a functional bug found while verifying this against the live
// schema: `orders` has no `items` or `store_name`/`vat_amount` columns --
// items live in a separate `order_items` table, the tenant's display name
// column is `name`, and the tax column is `tax_amount`. The old code was
// silently sending `items: undefined` and `storeName: undefined` for every
// public invoice.
app.get("/api/public/invoices/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Lazy import to ensure supabaseAdmin is initialized
    const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");

    // seen-deep-technical-audit.md Medium tier: this route had no rate limit
    // at all, unlike every other /api/public/* route. Low actual risk --
    // `id` is orders.id, an unguessable UUID, not a short/sequential token
    // -- but added for consistency with the rest. Same shared
    // tracking_attempts limiter the order-tracking routes already use.
    const { allowed, recordFailure } = await checkTrackingRateLimit(supabaseAdmin, clientIp(req));
    if (!allowed) {
      return res.status(429).json({ error: 'محاولات كثيرة جداً. انتظر دقيقة ثم أعد المحاولة.' });
    }

    const { data: orderData, error: orderError } = await supabaseAdmin
      .from('orders')
      .select('order_number, order_date, total_amount, tax_amount, tenant_id, customer_id')
      .eq('id', id)
      .maybeSingle();

    if (orderError || !orderData) {
      await recordFailure();
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const [{ data: tenantData }, { data: customerData }, { data: itemsData }] = await Promise.all([
      supabaseAdmin
        .from('tenants')
        .select('name, vat_number, phone, logo_url')
        .eq('id', orderData.tenant_id)
        .maybeSingle(),
      orderData.customer_id
        ? supabaseAdmin.from('customers').select('name').eq('id', orderData.customer_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabaseAdmin.from('order_items').select('name, quantity, price').eq('order_id', id),
    ]);

    res.json({
      order: {
        orderNumber: orderData.order_number,
        orderDate: orderData.order_date,
        totalAmount: orderData.total_amount,
        vatAmount: orderData.tax_amount,
        items: itemsData || [],
      },
      tenant: tenantData ? {
        storeName: tenantData.name,
        vatNumber: tenantData.vat_number,
        phone: tenantData.phone,
        logoUrl: tenantData.logo_url,
      } : null,
      customer: customerData ? { name: customerData.name } : null,
    });
  } catch (err) {
    logger.error({ err }, "Error fetching invoice");
    res.status(500).json({ error: 'تعذّر تحميل الفاتورة حالياً، حاول بعد قليل أو تواصل مع المتجر' });
  }
});

// صفحة تتبّع الطلب العامة (/track/:token في الواجهة) -- بلا مصادقة، رمز
// عشوائي غير قابل للتخمين (orders.tracking_token). نفس نمط
// /api/public/invoices/:id أعلاه: supabaseAdmin (يتجاوز RLS) مع اختيار
// الحقول المسموحة فقط يدوياً -- لا استعلام عام مباشر من المتصفح على
// orders، ولا RPC معرَّض لـanon (تفادياً للاعتماد على رؤية IP الحقيقي
// للعميل داخل Postgres خلف مجمِّع الاتصالات). التفاصيل الكاملة في
// docs/reports/PUBLIC_TRACKING_SPEC.md.
//
// تحديد معدّل: جدول tracking_attempts (نفس نمط print_pair_attempts في
// printRelay.ts) يعدّ محاولات كل IP، ويُزاد فقط عند عدم إيجاد طلب -- حتى لا
// يُعاقَب عميل شرعي يعيد تحميل صفحة تتبّعه الصحيحة.
const TRACKING_TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRACKING_ATTEMPTS_PER_MINUTE = 20;

// req.ip (وليس قراءة X-Forwarded-For يدوياً) -- Express مع `trust proxy: 1`
// أعلاه يثق بقفزة وكيل Vercel الواحدة فقط ويشتق العنوان من الطرف الصحيح من
// سلسلة الترويسة، فلا يقدر الطالب تزييف عنوانه بوضع قيمة مزوَّرة في أول
// الترويسة (كانت القراءة اليدوية السابقة تأخذ أول قيمة في القائمة، وهي
// بالضبط ما يتحكم به الطالب).
function clientIp(req: express.Request): string {
  return req.ip || 'unknown';
}

// SECURITY (seen-deep-technical-audit.md High #6): a raw Postgres/Supabase
// error.message can leak schema details (table/column names, constraint
// names) to the client. Internal routes should log the real error server-side
// and send the client a generic message -- same pattern already used by the
// public-facing routes above (e.g. /api/public/order-tracking's 500 handler).
//
// seen-deep-technical-audit.md High #11: most routes catch their own errors
// and respond directly instead of calling next(err), so they never reached
// the global error-handling middleware (the only place that called
// captureServerException) -- meaning most 500s would never have reached
// Sentry even with a real DSN configured. Routed through here too now, so
// every caller of this helper reports the same way the global handler does.
// Still a safe no-op with no DSN set (see src/server/logger.ts).
function internalError(res: express.Response, context: string, err: unknown): express.Response {
  logger.error({ err }, context);
  captureServerException(err, { context });
  return res.status(500).json({ error: 'Internal Server Error' });
}

// مشترك بين GET (قراءة الحالة) وPOST (تسجيل اشتراك الإشعارات) على نفس
// المسار -- كلاهما تخمين محتمل لتوكِنات عشوائية فيستحقان نفس الحماية.
// يزيد العدّاد فقط عند الاستدعاء بـ recordFailure=true (طلب بتوكِن غير
// موجود)، حتى لا يُعاقَب عميل شرعي يعيد تحميل/يعيد تفعيل الإشعارات لطلبه
// الصحيح.
//
// فحص "هل تجاوز الحد" أدناه قراءة عادية (قد تكون متأخرة جزء من ثانية تحت
// تزامن عالٍ -- مقبول، مجرد حد سريع لتفادي عمل إضافي). الزيادة الفعلية عبر
// increment_tracking_attempt (RPC ذرّية، 20260904010000) وليس upsert
// قراءة-ثم-كتابة، حتى لا تتراكم محاولتان متزامنتان على نفس count القديم
// بدل الزيادة الصحيحة.
async function checkTrackingRateLimit(
  supabaseAdmin: any,
  ip: string
): Promise<{ allowed: boolean; recordFailure: () => Promise<void> }> {
  const { data: rec } = await supabaseAdmin.from('tracking_attempts').select('*').eq('ip', ip).maybeSingle();
  const recActive = !!rec && new Date(rec.reset_at).getTime() > Date.now();
  const allowed = !(recActive && rec.count >= TRACKING_ATTEMPTS_PER_MINUTE);
  return {
    allowed,
    recordFailure: async () => {
      await supabaseAdmin.rpc('increment_tracking_attempt', { p_ip: ip });
    },
  };
}

// بحث الجوال قبل تسجيل الدخول (Login.tsx، دخول برقم الجوال بدل البريد):
// كان استعلاماً مباشراً من المتصفح على staff/tailor_requests بلا جلسة --
// RLS على الجدولين تشترط app_current_uid() غير NULL على SELECT، فالاستعلام
// غير المُصادَق عليه كان يُرجع صفراً صفوف دائماً (تسجيل الدخول بالجوال معطَّل
// فعلياً)، لا "تسريب حصر أرقام" كما افترض ملف المراجعة -- لكن حلّها الصحيح
// نفسه: بحث خادمي واحد عبر supabaseAdmin (يتجاوز RLS بأمان) بمعدّل محدود،
// بدل فتح RLS للقراءة العامة بالجوال (وهذا كان سيُنشئ فعلاً ثغرة حصر أرقام
// حقيقية لم تكن موجودة).
const PHONE_LOOKUP_ATTEMPTS_PER_MINUTE = 10;

// Security audit 2026-10-25, fingerprint
// server.ts:381:lookup-email-by-phone-pii-oracle: checkPhoneLookupRateLimit's
// counter was only ever incremented on a miss (recordFailure was called by
// the 404 branch alone) -- the exact harvesting scenario this limiter exists
// to stop (sweeping a list of real phone numbers) was completely unthrottled,
// since every successful lookup never counted against the limit. The read
// also silently dropped any DB error (`const { data: rec } = ...`), failing
// open. recordAttempt() below is now called on every outcome, and a read
// error fails closed (treated as already at the limit) instead of allowed.
async function checkPhoneLookupRateLimit(
  supabaseAdmin: any,
  ip: string
): Promise<{ allowed: boolean; recordAttempt: () => Promise<void> }> {
  const { data: rec, error } = await supabaseAdmin.from('auth_phone_lookup_attempts').select('*').eq('ip', ip).maybeSingle();
  if (error) {
    return { allowed: false, recordAttempt: async () => {} };
  }
  const recActive = !!rec && new Date(rec.reset_at).getTime() > Date.now();
  const allowed = !(recActive && rec.count >= PHONE_LOOKUP_ATTEMPTS_PER_MINUTE);
  return {
    allowed,
    recordAttempt: async () => {
      await supabaseAdmin.rpc('increment_auth_phone_lookup_attempt', { p_ip: ip });
    },
  };
}

app.post("/api/auth/lookup-email-by-phone", asyncHandler(async (req, res) => {
  const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");
  const phone = String((req.body || {}).phone || '').trim();

  if (!phone) {
    return res.status(400).json({ ok: false, error: 'رقم جوال مطلوب' });
  }

  const { allowed, recordAttempt } = await checkPhoneLookupRateLimit(supabaseAdmin, clientIp(req));
  if (!allowed) {
    return res.status(429).json({ ok: false, error: 'محاولات كثيرة جداً. انتظر دقيقة ثم أعد المحاولة.' });
  }

  const { data: reqRow } = await supabaseAdmin.from('tailor_requests').select('email').eq('phone', phone).maybeSingle();
  if (reqRow?.email) {
    await recordAttempt();
    return res.json({ ok: true, email: reqRow.email });
  }

  const { data: staffRow } = await supabaseAdmin.from('staff').select('email').eq('phone', phone).maybeSingle();
  if (staffRow?.email) {
    await recordAttempt();
    return res.json({ ok: true, email: staffRow.email });
  }

  await recordAttempt();
  res.status(404).json({ ok: false, error: 'لا يوجد حساب مرتبط بهذا الرقم' });
}));

app.get("/api/public/order-tracking/:token", asyncHandler(async (req, res) => {
  const { token } = req.params;
  const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");

  // شكل غير صالح أصلاً (لا حتى UUID) -- لا داعي لاستهلاك حصة تحديد المعدّل
  // أو الوصول لقاعدة البيانات على تخمينات عشوائية واضحة.
  if (!TRACKING_TOKEN_RE.test(token)) {
    return res.status(404).json({ error: 'Order not found' });
  }

  const { allowed, recordFailure } = await checkTrackingRateLimit(supabaseAdmin, clientIp(req));
  if (!allowed) {
    return res.status(429).json({ error: 'محاولات كثيرة جداً. انتظر دقيقة ثم أعد المحاولة.' });
  }

  // Embedded select (one round trip) instead of orders then tenants
  // sequentially -- this is an unauthenticated, WhatsApp-shared page whose
  // whole point is a fast first load.
  const { data: orderData } = await supabaseAdmin
    .from('orders')
    .select('order_number, status, status_key, delivery_date, tenant:tenants(name, logo_url, vertical)')
    .eq('tracking_token', token)
    .maybeSingle();

  if (!orderData) {
    await recordFailure();
    return res.status(404).json({ error: 'Order not found' });
  }

  const tenantData = (orderData as any).tenant;

  res.json({
    order_number: orderData.order_number,
    status: (orderData as any).status_key || orderData.status,
    shop_name: tenantData?.name || '',
    shop_logo_url: tenantData?.logo_url || null,
    delivery_date: orderData.delivery_date,
    ...(await publicTrackingStages(supabaseAdmin, tenantData?.vertical, (orderData as any).status_key)),
  });
}));

// بديل يدوي عن كتابة tracking_token (رمز UUID طويل، غير عملي لإعادة كتابته
// يدوياً) لتطبيق "طلباتي" في تطبيق العميل -- seen-companion-app-android-task.md
// Track B. يعيد الآلية الأمنية نفسها بشكل مختلف: بدل token عشوائي واحد،
// يتطلّب معرفة رقمي الطلب معاً (order_number + آخر 4 أرقام من جوال
// العميل المسجَّل على الطلب) -- بها فقط، بلا مصادقة، تماماً كأنظمة تتبّع
// الشحن التجارية (رقم الشحنة + الرمز البريدي). عمداً لا يقبل order_number
// وحده: هذا رقم صغير قابل للتخمين/التسلسل، وربطه بآخر 4 أرقام من الجوال
// (10,000 احتمال) يرفع تكلفة التخمين العشوائي بشكل كافٍ خلف نفس تحديد
// المعدّل بالأسفل. يعيد tracking_token نفسه عند النجاح فقط -- هذا الاستثناء
// الوحيد المتعمَّد لإرجاع التوكِن من السيرفر، لأن الطالب أثبت للتو معرفته
// بسرّين معاً لا سرّاً واحداً مخمَّناً.
// seen-verticals-readiness-task.md Phase 2: a shop on a vertical other than
// men's tailoring has its own stages (a sofa goes through «تنجيد», not
// «خياطة»). The tracking page builds its steps from them; for men's
// tailoring nothing is added and the page keeps its fixed steps.
async function publicTrackingStages(supabaseAdmin: any, vertical: string | null | undefined, statusKey: string | null | undefined) {
  if (!vertical || vertical === 'mens_tailoring') return {};
  const { data } = await supabaseAdmin
    .from('vertical_workflow_stages')
    .select('stage_key, label_ar, label_en, label_ur, phase, sort')
    .eq('vertical_key', vertical)
    .order('sort');
  const stages = (data || []) as Array<{ stage_key: string; label_ar: string; label_en?: string | null; label_ur?: string | null; phase?: string | null }>;
  if (stages.length === 0 || stages.some((st) => !st.phase)) return {};
  const current = stages.find((st) => st.stage_key === statusKey);
  return {
    phase: current?.phase ?? null,
    stages: stages
      .filter((st) => st.phase !== 'cancelled')
      .map((st) => ({ key: st.stage_key, phase: st.phase, label_ar: st.label_ar, label_en: st.label_en ?? null, label_ur: st.label_ur ?? null })),
  };
}

const ORDER_LOOKUP_NUMBER_RE = /^[0-9]{1,10}$/;
const PHONE_LAST4_RE = /^[0-9]{4}$/;

app.post("/api/public/order-lookup", asyncHandler(async (req, res) => {
  const orderNumberRaw = (req.body || {}).orderNumber;
  const phoneLast4 = (req.body || {}).phoneLast4;
  const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");

  const orderNumber = typeof orderNumberRaw === 'string' || typeof orderNumberRaw === 'number'
    ? String(orderNumberRaw).trim()
    : '';

  if (!ORDER_LOOKUP_NUMBER_RE.test(orderNumber) || typeof phoneLast4 !== 'string' || !PHONE_LAST4_RE.test(phoneLast4)) {
    return res.status(400).json({ error: 'Invalid input' });
  }

  const { allowed, recordFailure } = await checkTrackingRateLimit(supabaseAdmin, clientIp(req));
  if (!allowed) {
    return res.status(429).json({ error: 'محاولات كثيرة جداً. انتظر دقيقة ثم أعد المحاولة.' });
  }

  const { data: candidates } = await supabaseAdmin
    .from('orders')
    .select('order_number, status, status_key, delivery_date, tracking_token, tenant:tenants(name, logo_url, vertical), customer:customers(phone)')
    .eq('order_number', Number(orderNumber));

  // order_number مُتسلسِل لكل مستأجر على حدة، لا فريد على مستوى المنصّة
  // كلها -- والاستعلام أعلاه بلا أي تقييد بمستأجر (لا يوجد سياق مستأجر
  // معروف في تطبيق العميل أصلاً). تصادم نادر لكن حقيقي: مستأجران مختلفان
  // كلاهما لديه order_number مطابق، وصدفةً عميلان مختلفان لكل منهما جوال
  // ينتهي بنفس 4 أرقام -- match() القديمة كانت تأخذ أول نتيجة تصادف
  // مطابقتها فتُسرِّب بيانات طلب مستأجر آخر للعميل الخطأ. أكثر من نتيجة
  // مطابقة = حالة ملتبسة تُرفَض بدل تخمين الأقرب.
  const matches = (candidates || []).filter((o: any) => (o.customer?.phone || '').endsWith(phoneLast4));

  if (matches.length !== 1) {
    await recordFailure();
    return res.status(404).json({ error: 'Order not found' });
  }
  const orderData = matches[0];

  const tenantData = (orderData as any).tenant;

  res.json({
    tracking_token: orderData.tracking_token,
    order_number: orderData.order_number,
    status: (orderData as any).status_key || orderData.status,
    shop_name: tenantData?.name || '',
    shop_logo_url: tenantData?.logo_url || null,
    delivery_date: orderData.delivery_date,
    ...(await publicTrackingStages(supabaseAdmin, tenantData?.vertical, (orderData as any).status_key)),
  });
}));

// تفعيل إشعارات Push من صفحة التتبّع العامة نفسها -- بلا حساب، الاشتراك
// مربوط بـ tracking_token فقط (انظر 20260904000000_order_push_subscriptions.sql).
app.post("/api/public/order-tracking/:token/subscribe", asyncHandler(async (req, res) => {
  const { token } = req.params;
  const fcmToken = (req.body || {}).fcmToken;
  const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");

  if (!TRACKING_TOKEN_RE.test(token)) {
    return res.status(404).json({ error: 'Order not found' });
  }
  if (typeof fcmToken !== 'string' || !fcmToken || fcmToken.length > 4096) {
    return res.status(400).json({ error: 'Invalid subscription token' });
  }

  const { allowed, recordFailure } = await checkTrackingRateLimit(supabaseAdmin, clientIp(req));
  if (!allowed) {
    return res.status(429).json({ error: 'محاولات كثيرة جداً. انتظر دقيقة ثم أعد المحاولة.' });
  }

  const { data: orderData } = await supabaseAdmin.from('orders').select('id').eq('tracking_token', token).maybeSingle();
  if (!orderData) {
    await recordFailure();
    return res.status(404).json({ error: 'Order not found' });
  }

  const { error } = await supabaseAdmin.from('order_push_subscriptions').upsert(
    { tracking_token: token, fcm_token: fcmToken, updated_at: new Date().toISOString() },
    { onConflict: 'tracking_token,fcm_token' }
  );
  if (error) {
    logger.error({ err: error }, '[order-tracking/subscribe]');
    return res.status(500).json({ error: 'تعذّر تفعيل إشعارات تتبّع الطلب حالياً، حاول مرة أخرى لاحقاً' });
  }

  res.json({ ok: true });
}));

// فورم مقاسات عام للعميل (/measurements/:token في الواجهة) -- بلا مصادقة،
// نفس نمط /api/public/order-tracking/* أعلاه تماماً: رمز عشوائي غير قابل
// للتخمين (customers.measurements_token)، supabaseAdmin مع اختيار حقول
// صريح، ونفس محدِّد المعدّل المشترك. التفاصيل الكاملة في
// docs/superpowers/specs/2026-11-08-customer-measurements-public-form-design.md.
app.get("/api/public/measurements/:token", asyncHandler(async (req, res) => {
  const { token } = req.params;
  const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");

  if (!TRACKING_TOKEN_RE.test(token)) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  const { allowed, recordFailure } = await checkTrackingRateLimit(supabaseAdmin, clientIp(req));
  if (!allowed) {
    return res.status(429).json({ error: 'محاولات كثيرة جداً. انتظر دقيقة ثم أعد المحاولة.' });
  }

  const { data: customerData } = await supabaseAdmin
    .from('customers')
    .select('name, measurements, measurements_token_expires_at, tenant:tenants(name, logo_url, measurement_unit)')
    .eq('measurements_token', token)
    .maybeSingle();

  if (!customerData) {
    await recordFailure();
    return res.status(404).json({ error: 'Customer not found' });
  }
  // seen-readiness-fixes-task.md P4 (OPERATIONS-16 / SECURITY-10): a link lasts
  // 7 days; the shop sends a new one after that.
  const expiresAt = (customerData as any).measurements_token_expires_at;
  if (!expiresAt || new Date(expiresAt).getTime() <= Date.now()) {
    return res.status(410).json({ error: 'Link expired' });
  }

  const tenantData = (customerData as any).tenant;

  res.json({
    customer_name: customerData.name,
    shop_name: tenantData?.name || '',
    shop_logo_url: tenantData?.logo_url || null,
    measurement_unit: isValidMeasurementUnit(tenantData?.measurement_unit) ? tenantData.measurement_unit : 'inch',
    measurements: customerData.measurements || {},
  });
}));

app.post("/api/public/measurements/:token", asyncHandler(async (req, res) => {
  const { token } = req.params;
  const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");

  if (!TRACKING_TOKEN_RE.test(token)) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  const { allowed, recordFailure } = await checkTrackingRateLimit(supabaseAdmin, clientIp(req));
  if (!allowed) {
    return res.status(429).json({ error: 'محاولات كثيرة جداً. انتظر دقيقة ثم أعد المحاولة.' });
  }

  const result = validateMeasurementsPayload((req.body || {}).measurements);
  if (result.ok === false) {
    return res.status(400).json({ error: result.error });
  }

  const { data: customerData } = await supabaseAdmin
    .from('customers')
    .select('id')
    .eq('measurements_token', token)
    .maybeSingle();

  if (!customerData) {
    await recordFailure();
    return res.status(404).json({ error: 'Customer not found' });
  }

  // P4 (OPERATIONS-16 / SECURITY-10): refused after expiry; the previous
  // measurements are kept and the shop is told.
  const { data: saved, error: updateError } = await supabaseAdmin
    .rpc('save_public_measurements', { p_token: token, p_measurements: result.value });

  if (updateError) {
    return internalError(res, 'Error saving public measurements', updateError);
  }
  if (!saved) {
    return res.status(410).json({ error: 'Link expired' });
  }

  res.json({ ok: true });
}));

// مشترك بين مسارَي إشعار حالة الطلب وإشعار الموظفين بطلب جديد -- يرسل عبر
// FCM لكل اشتراك، وينظّف توكِنات المُلغاة/المنتهية (تفادياً لتكرار نفس
// منطق التنظيف بالضبط في كل مسار push جديد).
async function sendPushAndPruneDeadTokens(
  adminMessaging: any,
  subs: { fcm_token: string }[],
  notification: { title: string; body: string },
  link: string,
  pruneDeadTokens: (deadTokens: string[]) => PromiseLike<any>
): Promise<number> {
  const results = await Promise.allSettled(
    subs.map((s) => adminMessaging.send({
      token: s.fcm_token,
      notification,
      webpush: { fcmOptions: { link } },
    }))
  );

  const deadTokens = results
    .map((r, i) => ({ r, token: subs[i].fcm_token }))
    .filter(({ r }) => r.status === 'rejected' && (r as any).reason?.code === 'messaging/registration-token-not-registered')
    .map(({ token }) => token);

  if (deadTokens.length) {
    await pruneDeadTokens(deadTokens);
  }

  return results.filter((r) => r.status === 'fulfilled').length;
}

// نص عربي مبسّط لحالات الخياطة الرجالية القديمة (mens_tailoring) فقط --
// نفس فجوة STEPS الموثّقة في docs/reports/PUBLIC_TRACKING_SPEC.md: مستأجرو القطاعات
// الأخرى (status_key حر حسب vertical) يحصلون على نص الحالة الخام بدل تسمية
// عربية مترجمة إلى أن يُعمَّم هذا حسب vertical كل تاجر.
const ORDER_STATUS_LABELS_AR: Record<string, string> = {
  measurements_taken: 'تم أخذ المقاسات', cutting: 'قص', sewing: 'خياطة', embroidery: 'تطريز',
  ironing_packaging: 'كي وتغليف', ready: 'جاهز للاستلام', partial_delivered: 'تسليم جزئي',
  delivered: 'تم التسليم', cancelled: 'ملغى',
};

// يُستدعى من العميل (الموظف المصادَق) فور نجاح أي تحديث لحالة طلب --
// Orders.tsx وDashboardToday.tsx (src/utils/orderNotify.ts). لا يعدّل حالة
// الطلب ولا يتوقف عليه أي منطق آخر؛ فشله لا يجب أن يُبطئ أو يُفشل تحديث
// الحالة نفسه (المُستدعي يستخدم fire-and-forget مع try/catch منفصل).
app.post("/api/orders/:id/notify-status", authenticate, asyncHandler(async (req: any, res) => {
  const tenantId = req.user?.tenantId;
  const { id } = req.params;
  if (!tenantId) return res.status(401).json({ error: 'Unauthorized' });

  const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");
  const { data: orderData } = await supabaseAdmin
    .from('orders')
    .select('tenant_id, tracking_token, status, status_key, order_number')
    .eq('id', id)
    .maybeSingle();

  if (!orderData || orderData.tenant_id !== tenantId) {
    return res.status(404).json({ error: 'Order not found' });
  }

  const { data: subs } = await supabaseAdmin
    .from('order_push_subscriptions')
    .select('fcm_token')
    .eq('tracking_token', orderData.tracking_token);

  if (!subs || subs.length === 0) {
    return res.json({ ok: true, sent: 0 });
  }

  const { adminMessaging } = await import("./src/server/firebase-admin.ts");
  if (!adminMessaging) {
    return res.json({ ok: true, sent: 0 });
  }

  const statusKey = orderData.status_key || orderData.status;
  // The stage's own name in the shop's vertical (seen-verticals-readiness-task.md
  // Phase 2) -- a sofa's customer read «الحالة الآن: design_approval». The
  // tailoring dictionary only when the vertical does not name the stage.
  const { data: tenantRow } = await supabaseAdmin.from('tenants').select('vertical').eq('id', tenantId).maybeSingle();
  let stageName: string | null = null;
  // Men's tailoring keeps the dictionary's texts exactly as before.
  if (tenantRow?.vertical && tenantRow.vertical !== 'mens_tailoring' && orderData.status_key) {
    const { data: stage } = await supabaseAdmin
      .from('vertical_workflow_stages')
      .select('label_ar')
      .eq('vertical_key', tenantRow.vertical)
      .eq('stage_key', orderData.status_key)
      .maybeSingle();
    stageName = stage?.label_ar || null;
  }
  const title = `طلبك رقم ${orderData.order_number}`;
  const body = `الحالة الآن: ${stageName || ORDER_STATUS_LABELS_AR[statusKey] || statusKey}`;
  const link = `${req.protocol}://${req.get('host')}/track/${orderData.tracking_token}`;

  const sent = await sendPushAndPruneDeadTokens(adminMessaging, subs, { title, body }, link, (deadTokens) =>
    supabaseAdmin.from('order_push_subscriptions').delete().eq('tracking_token', orderData.tracking_token).in('fcm_token', deadTokens)
  );

  res.json({ ok: true, sent });
}));

// تسجيل اشتراك إشعارات Push للموظف (المرحلة 3) -- staff_id من
// req.user.staffId (يُشتقّه authMiddleware.ts من الجلسة المصادَق عليها
// نفسها أثناء تحقّقه من الدور/tenant، فلا حاجة لاستعلام staff ثانٍ هنا)،
// لا يُقرأ من جسم الطلب إطلاقاً -- فلا يقدر أي موظف يسجّل توكِن جهازه باسم
// موظف آخر. staffId يكون undefined لموظفي SaaS (saas_users، لا صف staff
// لهم أصلاً) فيُرفَض الطلب بوضوح بدل استعلام يرجع فارغاً.
app.post("/api/staff/push-subscribe", authenticate, asyncHandler(async (req: any, res) => {
  const staffId = req.user?.staffId;
  const fcmToken = (req.body || {}).fcmToken;
  if (!staffId) return res.status(404).json({ error: 'Staff record not found' });
  if (typeof fcmToken !== 'string' || !fcmToken || fcmToken.length > 4096) {
    return res.status(400).json({ error: 'Invalid subscription token' });
  }

  const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");
  const { error } = await supabaseAdmin.from('staff_push_subscriptions').upsert(
    { staff_id: staffId, fcm_token: fcmToken, updated_at: new Date().toISOString() },
    { onConflict: 'staff_id,fcm_token' }
  );
  if (error) {
    logger.error({ err: error }, '[staff/push-subscribe]');
    return res.status(500).json({ error: 'تعذّر تفعيل إشعارات الموظف حالياً، حاول مرة أخرى لاحقاً' });
  }

  res.json({ ok: true });
}));

// كل أدوار MERCHANT_ROLE_KEYS (src/services/permissionService.ts) تملك
// orders.view افتراضياً -- بما فيها accountant وwarehouse_manager
// وbranch_manager (سقطت من نسخة أولى لهذه القائمة، فكانت النقطة تُفعَّل
// بنجاح من إعدادات الموظف بلا أي خطأ ظاهر، لكن لا تُرسل له push إشعار
// فعلياً أبداً). تقريب متعمَّد لصلاحية orders.view الفعلية بدل حساب الأدوار
// المخصّصة الكاملة (roles_permissions/role overrides) هنا؛ الموظف أصلاً
// اختار التفعيل بنفسه من إعداداته، وهذا الفحص طبقة أمان إضافية لا الوحيدة.
// موثَّق كتبسيط معروف في docs/reports/PUBLIC_TRACKING_SPEC.md.
const ORDERS_VIEW_ROLES = ['super_admin', 'owner', 'admin', 'manager', 'branch_manager', 'accountant', 'warehouse_manager', 'cashier', 'tailor'];

// يُستدعى من العميل فور نجاح إنشاء طلب جديد (Orders.tsx، POS.tsx --
// src/utils/orderNotify.ts) لإشعار الموظفين المشتركين. لا ينشئ الطلب ولا
// يتوقف عليه؛ فشله معزول بنفس نمط notify-status أعلاه.
app.post("/api/orders/:id/notify-new-order", authenticate, asyncHandler(async (req: any, res) => {
  const tenantId = req.user?.tenantId;
  const { id } = req.params;
  if (!tenantId) return res.status(401).json({ error: 'Unauthorized' });

  const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");
  // eligibleStaff only depends on tenantId (already known from the
  // verified JWT via req.user, not from the order row) so it doesn't need
  // to wait on orderData -- fetched in parallel instead of after it.
  const [{ data: orderData }, { data: eligibleStaff }] = await Promise.all([
    supabaseAdmin.from('orders').select('tenant_id, order_number, customer_name, total_amount').eq('id', id).maybeSingle(),
    supabaseAdmin.from('staff').select('id').eq('tenant_id', tenantId).eq('status', 'active').in('role', ORDERS_VIEW_ROLES),
  ]);

  if (!orderData || orderData.tenant_id !== tenantId) {
    return res.status(404).json({ error: 'Order not found' });
  }

  // Exclude whoever created the order -- they already saw it happen (and
  // the client-side toast) and don't need an OS push telling them their
  // own order arrived.
  const targetStaffIds = eligibleStaff
    ? eligibleStaff.map((s: { id: string }) => s.id).filter((sid: string) => sid !== req.user?.staffId)
    : [];

  if (targetStaffIds.length === 0) {
    return res.json({ ok: true, sent: 0 });
  }

  const { data: subs } = await supabaseAdmin
    .from('staff_push_subscriptions')
    .select('fcm_token, staff_id')
    .in('staff_id', targetStaffIds);

  if (!subs || subs.length === 0) {
    return res.json({ ok: true, sent: 0 });
  }

  const { adminMessaging } = await import("./src/server/firebase-admin.ts");
  if (!adminMessaging) {
    return res.json({ ok: true, sent: 0 });
  }

  const title = 'طلب مبيعات جديد';
  const body = `${orderData.customer_name || 'عميل'} — #${orderData.order_number} — ${Number(orderData.total_amount || 0).toFixed(2)} ر.س`;
  const link = `${req.protocol}://${req.get('host')}/orders?highlight=${id}`;

  const sent = await sendPushAndPruneDeadTokens(adminMessaging, subs, { title, body }, link, (deadTokens) =>
    supabaseAdmin.from('staff_push_subscriptions').delete().in('fcm_token', deadTokens)
  );

  res.json({ ok: true, sent });
}));

// seen-deep-technical-audit.md -- حرج #8: كان يُرجع "ok" دائماً حتى لو
// قاعدة البيانات معطوبة بالكامل، فلا قيمة فعلية لربطه بمراقبة توقف خارجية.
// فحص حقيقي الآن: استعلام خفيف فعلي (بلا بيانات، head فقط) بمهلة قصيرة.
// seen-performance-first-open-login-task.md Phase 5: the client's
// connectivity check. Answers at once without touching the database, so a
// tab checking "am I online" no longer queries Supabase each time;
// /api/health below keeps the database check for server monitoring.
app.get("/api/ping", (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true });
});

app.get("/api/health", async (req, res) => {
  try {
    const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    const { error } = await supabaseAdmin
      .from("tenants")
      .select("id", { head: true, count: "exact" })
      .limit(1)
      .abortSignal(controller.signal);
    clearTimeout(timeout);
    if (error) throw error;
    res.json({ status: "ok" });
  } catch (err: any) {
    logger.error({ err }, "[health] database check failed");
    res.status(503).json({ status: "error", database: "unreachable" });
  }
});

app.get("/api/inventory-adjustments", authenticate, async (req: any, res) => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized: No tenant ID found' });
    }

    const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");
    const { data, error } = await supabaseAdmin
      .from("inventory_adjustments")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });

    if (error) {
      return internalError(res, "Error in GET /api/inventory-adjustments:", error);
    }

    res.json(data || []);
  } catch (err: any) {
    internalError(res, "Error in GET /api/inventory-adjustments:", err);
  }
});

app.get("/api/inventory-adjustments/:id/items", authenticate, async (req: any, res) => {
  try {
    const tenantId = req.user?.tenantId;
    const { id } = req.params;
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized: No tenant ID found' });
    }

    const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");
    
    // Security check: verify parent adjustment belongs to this tenant
    const { data: parentAdj, error: parentErr } = await supabaseAdmin
      .from("inventory_adjustments")
      .select("tenant_id")
      .eq("id", id)
      .maybeSingle();

    if (parentErr || !parentAdj) {
      return res.status(404).json({ error: "Adjustment not found" });
    }

    if (parentAdj.tenant_id !== tenantId) {
      return res.status(403).json({ error: "Forbidden: Access denied" });
    }

    const { data, error } = await supabaseAdmin
      .from("adjustment_items")
      .select("*")
      .eq("adjustment_id", id);

    if (error) {
      return internalError(res, "Error in GET /api/inventory-adjustments/:id/items:", error);
    }

    res.json(data || []);
  } catch (err: any) {
    internalError(res, "Error in GET /api/inventory-adjustments/:id/items:", err);
  }
});

// seen-cto-code-review-2026-11-13.md C8: this route used to insert the
// adjustment and, when status === "Approved", write branch_inventory and
// stock_ledger directly through the service-role client with no role
// check and no variant_id filter -- any authenticated user could POST
// {status: "Approved"} and mutate stock, and the write overwrote every
// variant of an item in one shot. The client now calls the
// approve_stock_take Postgres RPC directly (role-checked, variant-aware,
// atomic) instead of this route, so the unsafe write path is removed
// rather than patched. The GET routes above stay -- they are read-only
// history views, tenant-scoped, not a stock-mutation path.

app.post("/api/saas/complete-temp-password", authenticate, async (req: any, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) {
      return res.status(401).json({ error: 'Unauthorized: User UID not found' });
    }

    const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");
    
    // Fetch current temp passwords list
    const { data: tempPassSetting } = await supabaseAdmin
      .from('saas_settings')
      .select('*')
      .eq('key', 'temp_passwords')
      .maybeSingle();

    const currentTempPasswords = tempPassSetting?.value && typeof tempPassSetting.value === 'object'
      ? (tempPassSetting.value as Record<string, boolean>)
      : {};

    if (uid in currentTempPasswords) {
      const updatedTempPasswords = { ...currentTempPasswords };
      delete updatedTempPasswords[uid];

      await supabaseAdmin
        .from('saas_settings')
        .upsert({
          key: 'temp_passwords',
          value: updatedTempPasswords,
          updated_at: new Date().toISOString()
        });
    }

    res.json({ success: true });
  } catch (err: any) {
    internalError(res, "Error updating temp password status:", err);
  }
});

// Creates a Supabase Auth account for a new staff/team member. This must be
// server-side: supabaseAdmin.auth.admin.createUser() requires the
// service-role key, which must never reach the browser. Replaces the old
// client-side "spin up a secondary Firebase app" trick used by
// SaaSTeamManagement.tsx / AddEmployeeModal.tsx / Staff.tsx.
app.post("/api/staff/create-account", authenticate, requirePermission('staff.create'), async (req: any, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");
    const { createOrUpdateStaffAccount } = await import("./src/server/staffAccountService.ts");

    // seen-cto-sprint0-critical-fixes-task.md item 1 (SRV-01): 5 attempts/
    // minute per caller -- same Postgres-backed fixed-window pattern as
    // print-pairing/PIN verify, keyed per uid since this route already
    // requires authenticate.
    const { count: attemptCount, error: rateLimitError } = await supabaseAdmin
      .rpc('increment_staff_account_create_attempt', { p_caller_uid: req.user.uid })
      .then((r: any) => ({ count: r.data, error: r.error }));
    if (rateLimitError) {
      logger.warn({ err: rateLimitError }, '[staff/create-account] rate-limit check failed -- failing open');
    } else if (attemptCount > 5) {
      return res.status(429).json({ error: 'too_many_attempts' });
    }

    // status-review-2026-11-17/C-sprint2-4.md item 4: the reset-existing-
    // account path was removed from createOrUpdateStaffAccount entirely
    // (it was a provable account-takeover vector -- see that function's
    // header comment), so an already-registered email now always comes
    // back as a 409 here and `alreadyExisted` is always false. No reset
    // audit log to write anymore.
    const result = await createOrUpdateStaffAccount(supabaseAdmin, {
      email: String(email),
      password,
      name,
      requesterTenantId: req.user.tenantId,
      requesterRole: req.user.role,
    });
    if (result.ok === false) {
      return res.status(result.status).json({ error: result.error });
    }

    res.json({ uid: result.uid, alreadyExisted: result.alreadyExisted });
  } catch (err: any) {
    internalError(res, "Error creating staff account:", err);
  }
});

// Resets a SaaS team member's password (super_admin-only -- "forgot
// password" from /admin/team). Scoped to saas_users specifically: the
// target `uid` must already be a SaaS team member, so this endpoint can't
// be used to reset an arbitrary account's password platform-wide just
// because the caller is a super_admin. Also flags the account as having a
// temporary password (same as account creation), forcing the member to
// pick their own on next login instead of the admin's choice staying
// permanent.
app.post("/api/saas/reset-member-password", authenticate, authorize(['super_admin']), async (req: any, res) => {
  try {
    const { uid, password } = req.body;
    if (!uid || !password) {
      return res.status(400).json({ error: 'uid and password are required' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'password must be at least 6 characters' });
    }

    const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");

    const { data: member } = await supabaseAdmin.from('saas_users').select('uid').eq('uid', uid).maybeSingle();
    if (!member) {
      return res.status(404).json({ error: 'saas_team_member_not_found' });
    }

    const { resetStaffPassword } = await import("./src/server/staffAccountService.ts");
    const result = await resetStaffPassword(supabaseAdmin, String(uid), String(password));
    if (result.ok === false) {
      return res.status(result.status).json({ error: result.error });
    }

    // Same temp_passwords bookkeeping as account creation -- see
    // /api/saas/complete-temp-password above for how it's cleared.
    const { data: tempPassSetting } = await supabaseAdmin
      .from('saas_settings')
      .select('*')
      .eq('key', 'temp_passwords')
      .maybeSingle();
    const currentTempPasswords = tempPassSetting?.value && typeof tempPassSetting.value === 'object'
      ? (tempPassSetting.value as Record<string, boolean>)
      : {};
    await supabaseAdmin
      .from('saas_settings')
      .upsert({
        key: 'temp_passwords',
        value: { ...currentTempPasswords, [uid]: true },
        updated_at: new Date().toISOString()
      });

    res.json({ success: true });
  } catch (err: any) {
    internalError(res, "Error resetting SaaS member password:", err);
  }
});

// Verifies a staff PIN server-side. This must not be done client-side:
// the previous implementation fetched every active staff member's
// pin_hash to the browser (PinLogin.tsx) so it could compare locally — since
// PINs are only 4 digits (10,000 combinations), any staff member could
// capture a coworker's/owner's code from the network response and log in as
// them directly. This endpoint compares server-side and never returns any
// pin_hash to the client.
//
// E-1 (security-fix-tasklist.md): /api/staff/verify-pin had no attempt
// limiting at all -- a 4-digit PIN is only 10,000 combinations, so without
// this an authenticated attacker (any staff member's own session, since the
// endpoint only requires being logged in as *someone* on the tenant) could
// brute-force another staff member's PIN via straightforward scripted
// requests. 5 failed attempts locks out for an escalating window (1, 2, 4,
// 8, capped at 15 minutes), reset entirely on a successful match.
//
// (3، seen-comprehensive-review-fixes-task.md): كان هذا Map في الذاكرة --
// غير فعّال عبر نسخ Vercel Functions المتعددة (نفس درس printRelay.ts أعلى
// هذا الملف). انتقل لجدول pin_verify_attempts (نفس نمط tracking_attempts/
// print_pair_attempts)، عبر RPCين ذرّيين: record_pin_verify_failure يزيد
// العدّاد ويطبِّق القفل المتصاعد، وreset_pin_verify_attempts يصفّره عند
// نجاح المطابقة.
const VERIFY_PIN_MAX_ATTEMPTS = 5;
const VERIFY_PIN_MAX_LOCK_MINUTES = 15;

// PINs are intentionally stored and compared as plain 4-digit strings (not
// bcrypt-hashed) per explicit product decision -- the admin needs to be able
// to look a staff member's PIN back up (see GET /api/staff/pins) to hand it
// out or resolve a "my PIN doesn't work" report, which an irreversible hash
// can never support.
app.post("/api/staff/verify-pin", authenticate, async (req: any, res) => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized: No tenant ID found' });
    }

    const { pin, mode } = req.body;
    if (!pin || typeof pin !== 'string') {
      return res.status(400).json({ error: 'pin is required' });
    }

    const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");

    // seen-cto-sprint0-critical-fixes-task.md item 7 (SRV-04): check-unique
    // used to be exempt from this limiter entirely and callable by any
    // authenticated staff member -- any cashier could enumerate all 10,000
    // PINs with no throttle, learn which ones exist in the tenant, then
    // call this same endpoint in normal mode once per known PIN (never a
    // wrong guess, so the 5-attempt lock never triggers) to find out which
    // one belongs to the owner/admin. It's only ever used while an
    // owner/admin/manager is setting someone else's PIN (Staff.tsx) -- not
    // a path a regular login needs -- so it's now owner/admin/manager-only,
    // and rate-limited under its OWN key (never shared with the real login
    // counter below, so checking uniqueness repeatedly while picking a PIN
    // can't lock out that admin's own login attempts, or vice versa).
    if (mode === 'check-unique') {
      // seen-permissions-fix-task.md Phase 3: whoever adds or edits staff sets their PIN.
      const mayCheck = (await hasPermission(req, 'staff.create')) || (await hasPermission(req, 'staff.edit'));
      if (!mayCheck) return res.status(403).json({ error: 'forbidden', permission: 'staff.create|staff.edit' });

      // seen-status-fix-regressions-task.md item 8: this mode returns
      // before the failure-recording block below ever runs, so nothing
      // was actually throttling it -- a dedicated 20/minute-per-caller
      // counter, recorded on every call (not just a "wrong guess").
      const { count: uniqueCheckCount, error: uniqueRateLimitError } = await supabaseAdmin
        .rpc('increment_check_unique_attempt', { p_caller_uid: req.user.uid })
        .then((r: any) => ({ count: r.data, error: r.error }));
      if (uniqueRateLimitError) {
        logger.warn({ err: uniqueRateLimitError }, '[pin/check-unique] rate-limit check failed -- failing open');
      } else if (uniqueCheckCount > 20) {
        return res.status(429).json({ error: 'too_many_attempts' });
      }
    }

    const attemptKey = mode === 'check-unique'
      ? `${tenantId}:${req.user?.uid}:check-unique`
      : `${tenantId}:${req.user?.uid}`;
    {
      const { data: rec } = await supabaseAdmin.from('pin_verify_attempts').select('lock_until').eq('attempt_key', attemptKey).maybeSingle();
      if (rec?.lock_until && new Date(rec.lock_until).getTime() > Date.now()) {
        return res.status(429).json({
          error: 'محاولات كثيرة جداً. يرجى الانتظار قبل إعادة المحاولة.',
          retryAfterSeconds: Math.ceil((new Date(rec.lock_until).getTime() - Date.now()) / 1000),
        });
      }
    }

    const [{ data: staffData }, { data: rolesData }] = await Promise.all([
      supabaseAdmin.from('staff').select('id, tenant_id, uid, name, email, phone, role, role_id, branch_id, status, pin_hash, must_change_pin').eq('tenant_id', tenantId).eq('status', 'active'),
      supabaseAdmin.from('roles').select('id, role_key').or(`tenant_id.is.null,tenant_id.eq.${tenantId}`),
    ]);

    const rolesMap = new Map((rolesData || []).map((r: any) => [r.id, r.role_key]));
    let matched: any = null;
    for (const s of staffData || []) {
      if (!s.pin_hash) continue;
      if (s.pin_hash === pin) {
        matched = s;
        break;
      }
    }

    if (mode === 'check-unique') {
      return res.json({ isUnique: !matched });
    }

    if (!matched) {
      if (attemptKey) {
        await supabaseAdmin.rpc('record_pin_verify_failure', {
          p_key: attemptKey,
          p_max_attempts: VERIFY_PIN_MAX_ATTEMPTS,
          p_max_lock_minutes: VERIFY_PIN_MAX_LOCK_MINUTES,
        });
      }

      // A PIN activated before PINs switched from bcrypt hashes to plain
      // text is still sitting there as an old hash, which can never equal
      // anything typed in (hashing is one-way -- the original PIN can't be
      // recovered from it). That looks identical to a wrong PIN from the
      // client's side unless it's told to point at "needs reactivating"
      // instead of "you mistyped it".
      const hasLegacyHash = (staffData || []).some((s: any) => s.pin_hash && /^\$2[aby]\$/.test(s.pin_hash));
      return res.status(404).json({ matched: false, hasLegacyPins: hasLegacyHash });
    }

    // seen-readiness-fixes-task.md SECURITY-05: a correct PIN no longer resets
    // the failure count -- a cashier who knows her own PIN could otherwise
    // alternate guesses at the owner's PIN with her own and never be locked.
    // Failures expire after 15 quiet minutes instead (record_pin_verify_failure).

    // seen-permissions-fix-task.md Phase 2: from now on this device's
    // requests are this employee's (12 hours at most, ended on logout, lock
    // and idle). Without the session the UI would show them while the
    // server still saw the device account, so no token -> no switch.
    const { createActingSession } = await import('./src/server/actingSession.ts');
    const actingToken = await createActingSession(supabaseAdmin, {
      tenantId: matched.tenant_id,
      authUid: req.user.uid,
      staffId: matched.id,
    });

    const actualRole = matched.role_id ? (rolesMap.get(matched.role_id) || matched.role) : matched.role;
    res.json({
      matched: true,
      actingToken,
      staff: {
        id: matched.id,
        name: matched.name,
        email: matched.email,
        phone: matched.phone,
        role: actualRole,
        roleId: matched.role_id,
        status: matched.status,
        tenantId: matched.tenant_id,
        branchId: matched.branch_id,
        mustChangePin: matched.must_change_pin,
        isTest: matched.is_test,
        commission_type: matched.commission_type,
        commission_value: matched.commission_value,
        has_seen_onboarding: matched.has_seen_onboarding,
        createdAt: matched.created_at,
        updatedAt: matched.updated_at,
      },
    });
  } catch (err: any) {
    internalError(res, "Error verifying staff PIN:", err);
  }
});

// seen-permissions-fix-task.md Phase 2: end a PIN session (logout, lock,
// idle, switching to someone else). Only this device account's own tokens.
app.post("/api/staff/acting-session/end", authenticate, async (req: any, res) => {
  try {
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");
    const { endActingSession } = await import('./src/server/actingSession.ts');
    await endActingSession(supabaseAdmin, { authUid: req.user.uid, token });
    res.status(204).end();
  } catch (err: any) {
    internalError(res, "Error ending a PIN session:", err);
  }
});

// Returns every active staff member's plain-text PIN for this tenant, so the
// owner can look one up to hand out or resolve a "PIN doesn't work" report.
// Restricted to 'owner'/'super_admin' server-side (not admin/manager, per
// explicit product decision on 2026-09-08 -- plaintext PIN storage stays,
// but exposure is narrowed to the tenant owner only): the `staff` table's
// RLS only scopes SELECT by tenant, not by role, so a plain client-side
// query (or any staff member with devtools) would otherwise let any staff
// member -- down to a cashier -- read every coworker's, and the owner's,
// login PIN directly.
app.get("/api/staff/pins", authenticate, authorize(['super_admin', 'owner']), async (req: any, res) => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized: No tenant ID found' });
    }

    const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");
    const { data, error } = await supabaseAdmin
      .from('staff')
      .select('id, pin_hash')
      .eq('tenant_id', tenantId)
      .not('pin_hash', 'is', null);

    if (error) throw error;

    // A PIN activated before PINs switched from bcrypt hashes to plain text
    // still has its old hash sitting in this column -- surface that as
    // `legacy: true` instead of dumping the raw hash string into the PIN
    // display column.
    res.json({
      pins: (data || []).map((s: any) => {
        const isLegacy = /^\$2[aby]\$/.test(s.pin_hash || '');
        return { id: s.id, pin: isLegacy ? null : s.pin_hash, legacy: isLegacy };
      }),
    });
  } catch (err: any) {
    internalError(res, "Error fetching staff pins:", err);
  }
});

// Example Protected Route: Only accessible by Super Admin
app.get("/api/admin/stats", authenticate, authorize(['super_admin']), (req, res) => {
  res.json({
    message: "Welcome Super Admin",
    stats: { totalTenants: 10, revenue: 50000 }
  });
});

// Blog admin CRUD -- backed by the GitHub Contents API (src/server/blogAdmin.ts).
app.get("/api/admin/blog/articles", authenticate, authorize(['super_admin']), asyncHandler(listArticles));
app.get("/api/admin/blog/articles/:slug", authenticate, authorize(['super_admin']), asyncHandler(getArticle));
app.post("/api/admin/blog/articles", authenticate, authorize(['super_admin']), asyncHandler(createArticle));
app.put("/api/admin/blog/articles/:slug", authenticate, authorize(['super_admin']), asyncHandler(updateArticle));
app.delete("/api/admin/blog/articles/:slug", authenticate, authorize(['super_admin']), asyncHandler(deleteArticle));
app.post("/api/admin/blog/preview", authenticate, authorize(['super_admin']), asyncHandler(previewArticle));

// Example Protected Route: Accessible by Owners and Admins (and managers for GET)
app.get("/api/tenant/settings", authenticate, requirePermission('settings.view'), async (req: any, res) => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized: No tenant ID found' });
    }

    const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");
    const { data: tenant, error } = await supabaseAdmin
      .from("tenants")
      .select("*")
      .eq("id", tenantId)
      .maybeSingle();

    if (error || !tenant) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    let parsedMeta: any = {};
    if (tenant.legacy_id && tenant.legacy_id.startsWith("{")) {
      try {
        parsedMeta = JSON.parse(tenant.legacy_id);
      } catch (e) {
        logger.warn({ err: e }, "Failed to parse tenant.legacy_id JSON");
      }
    }

    // tenants.tax_settings (migration 20261230000000) is the source; legacy_id
    // only for an older database. One reading: src/utils/taxSettings.ts.
    const rawTax = (tenant.tax_settings && typeof tenant.tax_settings === 'object')
      ? tenant.tax_settings
      : (parsedMeta.tax_settings || parsedMeta);
    const taxSettings = resolveTaxSettings({ ...tenant, tax_settings: null }, rawTax);

    const notificationSettings = rawTax?.notificationSettings || parsedMeta?.notificationSettings || {
      lowStock: true,
      newOrder: true,
      dailyClose: true,
      tomorrowDelivery: true
    };

    res.json({
      name: tenant.name || '',
      phone: tenant.phone || '',
      address: tenant.address || '',
      commercialRegister: tenant.commercial_register || '',
      city: tenant.city || '',
      postalCode: tenant.postal_code || '',
      logoUrl: tenant.logo_url || '',
      measurementUnit: isValidMeasurementUnit(tenant.measurement_unit) ? tenant.measurement_unit : 'inch',
      fabricEstimate: normalizeFabricEstimateSettings(tenant.fabric_estimate_settings),
      taxSettings,
      notificationSettings
    });
  } catch (err: any) {
    internalError(res, "Error in GET /api/tenant/settings:", err);
  }
});

app.post("/api/tenant/settings", authenticate, requirePermission('settings.edit'), async (req: any, res) => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized: No tenant ID found' });
    }

    const data = req.body;
    if (!data) {
      return res.status(400).json({ error: "Missing body data" });
    }

    const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");

    // Format phone number to Saudi style if needed
    const formatSaudiPhone = (phone: string) => {
      let cleaned = phone.replace(/\D/g, '');
      if (cleaned.startsWith('0')) cleaned = cleaned.substring(1);
      if (cleaned.startsWith('966')) cleaned = cleaned.substring(3);
      if (cleaned.length === 9) return `+966${cleaned}`;
      return phone;
    };

    // seen-deep-technical-audit.md Medium tier: vatRate had a real Zod check
    // client-side (src/lib/validations.ts settingsSchema, 0-100) but nothing
    // re-checked it server-side -- a direct API call bypassing that form
    // could still write a garbage default_tax_rate (no CHECK constraint on
    // that column either). Scoped to just this field rather than pulling in
    // the whole client-facing schema, which depends on the i18n t() helper
    // for its messages.
    if (data.taxSettings?.vatRate !== undefined) {
      const vatRate = Number(data.taxSettings.vatRate);
      if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) {
        return res.status(400).json({ error: 'نسبة الضريبة يجب أن تكون رقماً بين 0 و 100' });
      }
    }

    if (data.measurementUnit !== undefined && !isValidMeasurementUnit(data.measurementUnit)) {
      return res.status(400).json({ error: 'وحدة القياس يجب أن تكون سم أو إنش' });
    }

    const tax_settings = {
      ...data.taxSettings,
      notificationSettings: data.notificationSettings
    };

    const updatePayload: any = {
      name: data.name,
      phone: data.phone ? formatSaudiPhone(data.phone) : '',
      address: data.address,
      commercial_register: data.commercialRegister,
      city: data.city,
      postal_code: data.postalCode,
      inventory_strategy: 'decentralized',
      logo_url: data.logoUrl,
      vat_number: data.taxSettings?.trn || '',
      is_tax_enabled: Boolean(data.taxSettings?.enabled),
      default_tax_rate: data.taxSettings?.vatRate || 15,
      // The settings document goes to tenants.tax_settings; the database trigger
      // tenants_tax_settings_sync copies it to legacy_id for older app versions
      // (migration 20261230000000 -- apply it before this code).
      tax_settings,
      updated_at: new Date().toISOString()
    };

    if (data.measurementUnit !== undefined) {
      updatePayload.measurement_unit = data.measurementUnit;
    }

    if (data.fabricEstimate !== undefined) {
      const fe = data.fabricEstimate || {};
      const inRange = (v: unknown, min: number, max: number) => {
        const n = Number(v);
        return Number.isFinite(n) && n >= min && n <= max;
      };
      if (!inRange(fe.wasteCm, 0, 200) || !inRange(fe.defaultWidthCm, 50, 400) || !inRange(fe.narrowWidthCm, 50, 400)) {
        return res.status(400).json({ error: 'أرقام حساب القماش غير صالحة' });
      }
      const { roundToCm: _roundToCm, ...stored } = normalizeFabricEstimateSettings(fe);
      updatePayload.fabric_estimate_settings = stored;
    }

    // seen-permissions-fix-task.md Phase 3: the screen sends the tax document
    // on every save; actually changing it needs settings.tax.
    const { data: currentTax } = await supabaseAdmin
      .from("tenants")
      .select("vat_number, is_tax_enabled, default_tax_rate, tax_settings")
      .eq("id", tenantId)
      .maybeSingle();
    const taxChanged = taxFingerprint(currentTax || {}) !== taxFingerprint(updatePayload);
    if (taxChanged && !(await hasPermission(req, 'settings.tax'))) {
      return res.status(403).json({ error: 'forbidden', permission: 'settings.tax' });
    }

    const { error } = await supabaseAdmin
      .from("tenants")
      .update(updatePayload)
      .eq("id", tenantId);

    if (error) {
      return internalError(res, "Error in POST /api/tenant/settings:", error);
    }

    res.json({ success: true });
  } catch (err: any) {
    internalError(res, "Error in POST /api/tenant/settings:", err);
  }
});

/* ================================================================
   مساعد سين الذكي — Smart Assistant
   ----------------------------------------------------------------
   إعدادات عامة (صف واحد assistant_settings.id='global') يديرها السوبر
   أدمن فقط عبر /api/super-admin/assistant-settings، ويقرأها /api/chat
   في كل طلب (لا قيم ثابتة بالكود) حتى يعمل التفعيل/التعطيل وتغيير
   المزوّد فوراً بلا إعادة نشر. مفتاح الـ API مشفّر في القاعدة
   (src/server/assistantCrypto.ts) ولا يُعاد كاملاً لأي استجابة.
   ================================================================ */

// result.pipeTextStreamToResponse() swallows model-call errors (invalid key,
// deprecated model, quota, ...): it only forwards "text-delta" parts, so an
// error part ends the stream with a plain 200 + empty body and no way for the
// client to tell what happened. Iterate the stream manually instead so an
// error thrown mid-iteration can still produce a real error response (JSON if
// nothing was written yet, or a visible in-band message if streaming already
// started).
const ASSISTANT_FRIENDLY_ERROR = 'حدث خطأ أثناء التواصل مع المساعد، حاول مرة أخرى.';

// يستخرج السقف الفعلي المسموح به لـ max_tokens من رسالة خطأ المزوّد، مثل
// رسالة Groq: "`max_tokens` must be less than or equal to `512`, the
// maximum value for `max_tokens` is less than the `context_window` for
// this model". لا يمكن تخمين سقف ثابت لكل نموذج مسبقاً لأن اسم النموذج
// حقل نص حر يكتبه السوبر أدمن (انظر SaaSAssistantSettings.tsx) وليس قائمة
// مغلقة، فبعض النماذج (خصوصاً معاينات Groq الصغيرة) تفرض سقف إخراج أقل
// بكثير من نافذة السياق الفعلية.
function extractMaxTokensCeiling(message: string | undefined): number | null {
  if (!message) return null;
  const match = message.match(/max_tokens.*?(?:less than or equal to|<=)\s*`?(\d+)`?/i);
  return match ? parseInt(match[1], 10) : null;
}

// كتلة ثابتة (لا تتغيّر لكل طلب) تُضاف قبل system_prompt القابل للتعديل من
// السوبر أدمن: الشخصية، خريطة كاملة بأقسام النظام (لتكون الإجابات على "كيف
// أضيف كذا؟" دقيقة دون الحاجة لأداة بيانات)، حدود النطاق (لا يجيب خارج
// النظام)، وسلوك اقتراح الجولة التعليمية عبر أداة guidedTour. مبنية من نفس
// نصوص src/config/tourSteps.ts + src/i18n لتبقى متطابقة مع ما يراه المستخدم
// فعلياً في الواجهة والجولة التعريفية الأولى.
const ASSISTANT_PERSONA_AND_KNOWLEDGE = `أنت "مساعد سين الذكي"، المساعد الرسمي داخل نظام سين (Seen) لإدارة المحلات التجارية. أسلوبك محترف وواثق ومباشر: جمل قصيرة وواضحة، بلا حشو أو اعتذارات متكررة، وبلا صياغة روبوتية جافة.

نطاقك محصور بنظام سين واستخدامه فقط (المبيعات، الطلبات، العملاء، المخزون، الموردين، التقارير، الإعدادات، وبيانات المحل الفعلية عبر أدواتك). أي سؤال خارج هذا النطاق تماماً (عام، ديني، سياسي، برمجة غير متعلقة بالنظام، ...) لا تُجب عنه من معرفتك العامة إطلاقاً — قل بأدب واختصار إنك هنا للإجابة عمّا يخص نظام سين فقط، وأعد توجيه الحديث لما يمكنك مساعدته فيه فعلاً.

خريطة أقسام النظام:
- لوحة التحكم (/dashboard): ملخص يومي سريع — مبيعات اليوم، الطلبات قيد التنفيذ، المبالغ المستحقة، وتنبيهات المخزون الناقص.
- المبيعات / نقطة البيع (/sales): إنشاء فواتير البيع المباشر، تبويب المرتجعات لاسترجاع الأصناف، وتبويب الورديات (فتح/إغلاق وردية الكاشير ومتابعة رصيد الصندوق نقداً).
- الطلبات (/orders): طلبات العملاء من البداية للتسليم. زر "طلب جديد" لاختيار العميل وإدخال تفاصيل الصنف وتاريخ التسليم وتسجيل العربون. تبويبا "نشطة" و"مكتملة"، وبحث بالاسم أو رقم الطلب أو مسح الباركود.
- العملاء (/customers): سجل العملاء — الاسم والجوال وبياناته المحفوظة تُستدعى تلقائياً في كل طلب قادم بلا إعادة إدخال. بحث في القائمة، وكشف حساب مالي لأي عميل عليه مبالغ متبقية.
- المخزون (/inventory): أصناف المخزون — إدخال أرصدة افتتاحية لما هو موجود فعلياً، إضافة أصناف جديدة، تحويل كميات بين الفروع مع تتبع الحركة، وتقارير المخزون.
- الموردين والمشتريات (/suppliers): تسجيل الموردين، إنشاء أوامر شراء لأصناف المخزون، تسجيل المرتجعات، ومتابعة أرصدة الموردين والفواتير المستحقة تلقائياً.
- التقارير (/reports): اللوحة العامة، التقارير المالية، تقارير الطلبات والمخزون، أداء الموظفين والعملاء، عمولات الخياطين، وتقارير الإغلاق اليومي (Z). فلاتر بالفترة الزمنية والموظف وحالة الدفع، وتصدير Excel/PDF.
- الإعدادات (/settings): بيانات المحل والشعار، الفروع، الموظفين والصلاحيات، شكل الفاتورة والطابعة، الرقم الضريبي، الإشعارات والواتساب، والاشتراك.

بعض الأقسام مقيّدة بالصلاحيات (كالتقارير المالية والإعدادات الإدارية وشؤون الموردين) — دور المستخدم الحالي مذكور في نهاية هذه الرسالة، خذه بعين الاعتبار عند الشرح أو اقتراح جولة تعليمية: لا تقترح على كاشير أو خيّاط أقساماً إدارية بحتة غالباً لا تظهر له.

عندما يسأل المستخدم "كيف أضيف / أنشئ / أسجّل ..." أي شيء في النظام:
1) اشرح الخطوات بإيجاز ودقة: أين يضغط، وما الحقول المطلوبة.
2) بعد الشرح مباشرة في نفس الرد، استدعِ أداة guidedTour بـ action="offer" ونفس الـ topic المطابق تماماً لما شرحته. الأداة نفسها هي ما تعرض للمستخدم زر التوجيه — لا تكتفِ بسؤاله نصياً "هل توجهك؟" دون استدعائها.
3) إذا وافق المستخدم لاحقاً بالنص على عرض سابق (نعم / تمام / أكيد / لو سمحت...)، استدعِ guidedTour مرة أخرى بنفس الـ topic و action="start" لتشغيل الجولة فوراً.
لا تستخدم guidedTour إطلاقاً لموضوع لم تشرحه للمستخدم للتو في نفس المحادثة.`;

// مسؤولة عن محادثة /api/chat التي تستخدم أدوات
// (tools) وتدعم عدة مزوّدين مع ترتيب احتياطي (Fallback): بروتوكول NDJSON
// بسيط (سطر JSON واحد لكل جزء) بدل النص الخام، حتى يستطيع العميل تمييز نص
// الرد عن نتائج الأدوات ويعرضها كبطاقات/جداول بدل نص خام، ويعرض مؤشر "جارِ
// البحث..." أثناء تنفيذ الأداة بدل شاشة فارغة. كل سطر إما
// {"t":"text","v":"..."} أو {"t":"status","name":...} (بدأ تنفيذ أداة) أو
// {"t":"tool","name":...,"result":...} أو {"t":"tool-error",...}.
//
// candidates: قائمة مرشّحين مرتّبة (المزوّد النشط أولاً ثم fallbackOrder،
// بعد استبعاد غير المُعدّين). لكل مرشّح نبني موديل جديداً ونستدعي
// buildResult(model) للحصول على نتيجة streamText طازجة، ثم نكرّر على
// fullStream بالكامل. إن فشل مرشّح قبل أي إخراج فعلي للعميل (wroteAny لا
// تزال false) ننتقل بصمت للمرشّح التالي مع تسجيل التبديل في سجل التدقيق؛
// أما إن فشل بعد أن بدأ العميل يستلم رداً جزئياً فلا يمكن تبديل المزوّد
// بأمان منتصف رد بدأ استلامه -- نتوقف برسالة خطأ مفهومة بدل ذلك.
async function streamAssistantReply(
  candidates: Array<{ providerKey: string; modelName: string; apiKey: string }>,
  buildResult: (model: any, maxOutputTokensOverride?: number) => any,
  res: any,
  onFallback: (failedProviderKey: string, reason: string, nextProviderKey: string | null) => Promise<void>,
): Promise<{ text: string; toolResults: Array<{ name: string; result: unknown }>; toolErrors: string[] } | null> {
  // What the person was actually sent, returned so the chat route can keep
  // it in the conversation history (2-4). Null when nothing was sent.
  let collected = { text: '', toolResults: [] as Array<{ name: string; result: unknown }>, toolErrors: [] as string[] };
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  const { buildModelForProvider } = await import('./src/server/aiProviderRegistry.ts');

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    // محاولتان لنفس المرشّح كحد أقصى: الثانية فقط إن كشف خطأ المحاولة
    // الأولى سقف max_tokens فعلي أقل مما هو مُعدّ (انظر extractMaxTokensCeiling) --
    // المفتاح والنموذج سليمان في هذه الحالة، فالانتقال لمزوّد آخر بالكامل
    // غير ضروري، يكفي تخفيض ميزانية الإخراج المطلوبة لهذا الطلب فقط.
    let maxOutputTokensOverride: number | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      let wroteAny = false;
      collected = { text: '', toolResults: [], toolErrors: [] };
      try {
        const model = await buildModelForProvider(candidate.providerKey, candidate.modelName, candidate.apiKey);
        const result = buildResult(model, maxOutputTokensOverride);
        for await (const part of result.fullStream) {
          if (part.type === 'text-delta') {
            wroteAny = true;
            collected.text += part.text;
            res.write(JSON.stringify({ t: 'text', v: part.text }) + '\n');
          } else if (part.type === 'tool-call') {
            wroteAny = true;
            res.write(JSON.stringify({ t: 'status', name: part.toolName }) + '\n');
          } else if (part.type === 'tool-result') {
            wroteAny = true;
            collected.toolResults.push({ name: part.toolName, result: part.output });
            res.write(JSON.stringify({ t: 'tool', name: part.toolName, result: part.output }) + '\n');
          } else if (part.type === 'tool-error') {
            wroteAny = true;
            logger.error({ err: part.error, tool: part.toolName }, '[assistant-tool-error]');
            collected.toolErrors.push(part.toolName);
            res.write(JSON.stringify({ t: 'tool-error', name: part.toolName, message: 'تعذّر تنفيذ الأداة' }) + '\n');
          } else if (part.type === 'error') {
            throw part.error instanceof Error ? part.error : new Error(String(part.error));
          }
        }
        res.end();
        return collected;
      } catch (err: any) {
        // المستخدم النهائي (Admin/Cashier في الـ Widget) لا يرى تفاصيل الخطأ
        // البرمجي أبداً (رسائل SDK/مزوّد الذكاء الاصطناعي الخام مثل quota/rate
        // limit) -- فقط سجل الخادم يحتفظ بها لأغراض التشخيص.
        logger.error({ err, provider: candidate.providerKey, attempt }, 'Assistant stream error');

        if (wroteAny) {
          // بدأ العميل بالفعل يستلم جزءاً من الرد -- لا تبديل ممكن الآن.
          res.write(JSON.stringify({ t: 'text', v: `\n\n${ASSISTANT_FRIENDLY_ERROR}` }) + '\n');
          res.end();
          collected.text += `\n\n${ASSISTANT_FRIENDLY_ERROR}`;
          return collected;
        }

        if (attempt === 0) {
          const ceiling = extractMaxTokensCeiling(err.message);
          if (ceiling !== null) {
            maxOutputTokensOverride = ceiling;
            continue; // نفس المرشّح، محاولة ثانية بسقف مخفَّض
          }
        }

        const nextCandidate = candidates[i + 1];
        await onFallback(candidate.providerKey, err.message || 'unknown error', nextCandidate?.providerKey || null);
        // لم يُكتب شيء للعميل بعد -- آمن للمتابعة للمرشّح التالي في الحلقة الخارجية.
        break;
      }
    }
  }

  // فشلت كل المرشّحين المتاحين بلا أي إخراج على الإطلاق.
  if (!res.headersSent) {
    res.status(502).json({ error: ASSISTANT_FRIENDLY_ERROR });
  } else {
    res.end();
  }
  return null;
}

// seen-ai-assistant-redesign-task.md 2-4: the signed-in person's own past
// conversations (30 days). Never anyone else's: every query is filtered by
// their uid and shop inside assistantHistory.ts.
app.get("/api/assistant/conversations", authenticate, async (req: any, res) => {
  try {
    if (!req.user?.tenantId || !req.user?.uid) return res.status(401).json({ error: 'Unauthorized' });
    const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");
    const { listConversations } = await import("./src/server/assistantHistory.ts");
    res.json({ conversations: await listConversations(supabaseAdmin, { tenantId: req.user.tenantId, userId: req.user.uid }) });
  } catch (err: any) {
    internalError(res, "Error in GET /api/assistant/conversations:", err);
  }
});

app.get("/api/assistant/conversations/:id", authenticate, async (req: any, res) => {
  try {
    if (!req.user?.tenantId || !req.user?.uid) return res.status(401).json({ error: 'Unauthorized' });
    const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");
    const { isConversationId, readConversation } = await import("./src/server/assistantHistory.ts");
    if (!isConversationId(req.params.id)) return res.status(404).json({ error: 'not_found' });
    const conversation = await readConversation(supabaseAdmin, { tenantId: req.user.tenantId, userId: req.user.uid }, req.params.id);
    if (!conversation) return res.status(404).json({ error: 'not_found' });
    res.json(conversation);
  } catch (err: any) {
    internalError(res, "Error in GET /api/assistant/conversations/:id:", err);
  }
});

app.delete("/api/assistant/conversations/:id", authenticate, async (req: any, res) => {
  try {
    if (!req.user?.tenantId || !req.user?.uid) return res.status(401).json({ error: 'Unauthorized' });
    const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");
    const { isConversationId, deleteConversation } = await import("./src/server/assistantHistory.ts");
    if (!isConversationId(req.params.id)) return res.status(404).json({ error: 'not_found' });
    const deleted = await deleteConversation(supabaseAdmin, { tenantId: req.user.tenantId, userId: req.user.uid }, req.params.id);
    if (!deleted) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  } catch (err: any) {
    internalError(res, "Error in DELETE /api/assistant/conversations/:id:", err);
  }
});

// seen-ai-assistant-redesign-task.md 2-1: "useful / not useful" on a reply.
// Any signed-in shop user may rate; the row is theirs and their shop's, and
// rating the same reply again replaces the earlier rating. Only the question
// and the tool names are kept, not the answer (founder's decision).
app.post("/api/assistant-feedback", authenticate, async (req: any, res) => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId || !req.user?.uid) return res.status(401).json({ error: 'Unauthorized' });
    const { parseFeedback } = await import("./src/server/assistantFeedback.ts");
    const parsed = parseFeedback(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const f = parsed.value;
    const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");
    const { error } = await supabaseAdmin.from("assistant_feedback").upsert({
      tenant_id: tenantId,
      user_id: req.user.uid,
      message_key: f.messageKey,
      rating: f.rating,
      comment: f.comment,
      question: f.question,
      tool_names: f.toolNames,
      page: f.page,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,message_key' });
    if (error) return internalError(res, "Error in POST /api/assistant-feedback:", error);
    res.json({ ok: true });
  } catch (err: any) {
    internalError(res, "Error in POST /api/assistant-feedback:", err);
  }
});

// The super admin's view of the ratings: the latest 100 (optionally only
// "not useful"), with the shop's name, and the last 30 days' totals.
app.get("/api/super-admin/assistant-feedback", authenticate, authorize(['super_admin']), async (req: any, res) => {
  try {
    const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");
    const onlyDown = req.query?.rating === 'down';
    let list = supabaseAdmin
      .from("assistant_feedback")
      .select("id, rating, comment, question, tool_names, page, updated_at, tenants(name)")
      .order("updated_at", { ascending: false })
      .limit(100);
    if (onlyDown) list = list.eq("rating", -1);
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const [{ data, error }, up, down] = await Promise.all([
      list,
      supabaseAdmin.from("assistant_feedback").select("id", { count: 'exact', head: true }).eq("rating", 1).gte("updated_at", since),
      supabaseAdmin.from("assistant_feedback").select("id", { count: 'exact', head: true }).eq("rating", -1).gte("updated_at", since),
    ]);
    if (error) return internalError(res, "Error in GET /api/super-admin/assistant-feedback:", error);
    if (up.error || down.error) return internalError(res, "Error in GET /api/super-admin/assistant-feedback:", up.error || down.error);
    res.json({
      totals: { up: up.count || 0, down: down.count || 0 },
      items: (data || []).map((r: any) => ({
        id: r.id,
        rating: r.rating === 1 ? 'up' : 'down',
        comment: r.comment,
        question: r.question,
        toolNames: r.tool_names || [],
        page: r.page,
        at: r.updated_at,
        shopName: r.tenants?.name || null,
      })),
    });
  } catch (err: any) {
    internalError(res, "Error in GET /api/super-admin/assistant-feedback:", err);
  }
});

// خفيف ومتاح لأي مستخدم مسجّل دخول (Admin/Cashier) — الـ Widget يسأله فقط
// "هل أعرض الزر العائم أصلاً؟"، بلا أي بيانات حساسة. يجمع بين المفتاح العام
// (assistant_settings.is_enabled، يُطفئ المساعد للمنصة بأكملها) وتعطيل خاص
// بهذا المشترك تحديداً (tenants.assistant_enabled، يديره السوبر أدمن لكل
// مشترك على حدة من لوحة إدارة المشتركين) -- كلاهما يجب أن يكون مفعّلاً.
app.get("/api/assistant-settings/status", authenticate, async (req: any, res) => {
  try {
    // The platform team's accounts have no shop (tenantId "saas_management"),
    // so no assistant -- answered quietly instead of a 500 from comparing
    // that marker with the uuid tenant ids below.
    const { hasReadyProvider, isShopTenantId } = await import("./src/server/assistantReadiness.ts");
    if (!isShopTenantId(req.user?.tenantId)) return res.json({ isEnabled: false });
    const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");
    // seen-ai-assistant-redesign-task.md 2-3: also how many messages are left
    // today. The counter (increment_assistant_usage) keys on the database's
    // current_date, which is UTC on Supabase -- the same date is read here.
    const usageDate = new Date().toISOString().slice(0, 10);
    const [{ data, error }, { data: tenant, error: tenantErr }, { data: usage, error: usageErr }, { data: creds, error: credsErr }] = await Promise.all([
      supabaseAdmin.from("assistant_settings").select("is_enabled, daily_message_limit, active_provider, fallback_order").eq("id", "global").maybeSingle(),
      req.user?.tenantId
        ? supabaseAdmin.from("tenants").select("assistant_enabled").eq("id", req.user.tenantId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      req.user?.tenantId
        ? supabaseAdmin.from("assistant_usage_daily").select("message_count").eq("tenant_id", req.user.tenantId).eq("usage_date", usageDate).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      // Only whether a key is saved -- never the key itself.
      supabaseAdmin.from("assistant_provider_credentials").select("provider_key, is_configured, api_key_encrypted"),
    ]);
    if (error) return internalError(res, "Error in GET /api/assistant-settings/status:", error);
    if (tenantErr) return internalError(res, "Error in GET /api/assistant-settings/status:", tenantErr);
    if (credsErr) return internalError(res, "Error in GET /api/assistant-settings/status:", credsErr);
    // The launcher shows only when a question could be answered: switched on
    // for the platform and this shop, and a provider the chat route would
    // use has a saved key. Without one every question got the 503
    // "not configured" reply (production, 2026-11-20).
    const isEnabled = Boolean(data?.is_enabled) && tenant?.assistant_enabled !== false && hasReadyProvider(data || {}, creds);
    // No limit configured (0) means unlimited: the counts are left out.
    const dailyLimit = Number(data?.daily_message_limit) || 0;
    if (usageErr) logger.error({ err: usageErr }, "assistant usage read failed");
    if (dailyLimit <= 0 || usageErr) return res.json({ isEnabled });
    const usedToday = Math.max(0, Number(usage?.message_count) || 0);
    res.json({ isEnabled, dailyLimit, usedToday, remaining: Math.max(0, dailyLimit - usedToday) });
  } catch (err: any) {
    internalError(res, "Error in GET /api/assistant-settings/status:", err);
  }
});

// يبني تمثيل مصفوفة "providers" المرسلة للواجهة: صف من سجل PROVIDERS
// (aiProviderRegistry.ts) لكل مزوّد مدعوم -- حتى المزوّدين بلا صف بيانات
// اعتماد بعد يظهرون كـ "غير مُعدّين"، بدل الاعتماد فقط على الصفوف الموجودة
// فعلياً في assistant_provider_credentials.
async function buildProviderStatusList(credRows: any[]) {
  const { PROVIDERS } = await import("./src/server/aiProviderRegistry.ts");
  const { decryptApiKey, maskApiKey } = await import("./src/server/assistantCrypto.ts");
  const credByKey = new Map((credRows || []).map((r: any) => [r.provider_key, r]));

  return Object.entries(PROVIDERS).map(([key, def]) => {
    const cred = credByKey.get(key);
    let apiKeyMasked = '';
    if (cred?.api_key_encrypted) {
      try { apiKeyMasked = maskApiKey(decryptApiKey(cred.api_key_encrypted)); } catch { apiKeyMasked = '••••••••'; }
    }
    return {
      providerKey: key,
      label: def.label,
      defaultModels: def.defaultModels,
      isConfigured: Boolean(cred?.is_configured),
      hasApiKey: Boolean(cred?.api_key_encrypted),
      apiKeyMasked,
      lastTestedAt: cred?.last_tested_at || null,
      lastTestStatus: cred?.last_test_status || null,
      lastTestMessage: cred?.last_test_message || null,
    };
  });
}

app.get("/api/super-admin/assistant-settings", authenticate, authorize(['super_admin']), async (req: any, res) => {
  try {
    const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");
    const { data, error } = await supabaseAdmin
      .from("assistant_settings")
      .select("*")
      .eq("id", "global")
      .maybeSingle();
    if (error) return internalError(res, "Error in GET /api/super-admin/assistant-settings:", error);
    if (!data) return res.status(404).json({ error: "Assistant settings not found" });

    const { data: credRows, error: credErr } = await supabaseAdmin.from("assistant_provider_credentials").select("*");
    if (credErr) return internalError(res, "Error in GET /api/super-admin/assistant-settings:", credErr);

    res.json({
      isEnabled: data.is_enabled,
      activeProvider: data.active_provider,
      activeModel: data.active_model,
      fallbackOrder: data.fallback_order || [],
      systemPrompt: data.system_prompt,
      temperature: data.temperature,
      maxTokens: data.max_tokens,
      dailyMessageLimit: data.daily_message_limit,
      updatedAt: data.updated_at,
      updatedBy: data.updated_by,
      providers: await buildProviderStatusList(credRows || []),
    });
  } catch (err: any) {
    internalError(res, "Error in GET /api/super-admin/assistant-settings:", err);
  }
});

app.put("/api/super-admin/assistant-settings", authenticate, authorize(['super_admin']), async (req: any, res) => {
  try {
    const data = req.body;
    if (!data) return res.status(400).json({ error: "Missing body data" });

    const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");
    const { PROVIDERS, isKnownProvider } = await import("./src/server/aiProviderRegistry.ts");

    const activeProvider = String(data.activeProvider || '');
    if (!isKnownProvider(activeProvider)) {
      return res.status(400).json({ error: `مزوّد غير معروف: ${activeProvider}` });
    }
    const fallbackOrder: string[] = Array.isArray(data.fallbackOrder)
      ? Array.from(new Set(data.fallbackOrder.filter((p: any) => typeof p === 'string')))
      : [];
    for (const p of fallbackOrder) {
      if (!isKnownProvider(p)) return res.status(400).json({ error: `مزوّد غير معروف في الترتيب الاحتياطي: ${p}` });
    }

    // لا يمكن تفعيل مزوّد أو وضعه في الترتيب الاحتياطي قبل أن يكون له مفتاح
    // API صالح مُختبَر بنجاح -- تحقق خادمي حقيقي، وليس فقط تعطيل زر بالواجهة.
    const keysNeedingCheck = Array.from(new Set([activeProvider, ...fallbackOrder]));
    const { data: credRows, error: credErr } = await supabaseAdmin
      .from("assistant_provider_credentials")
      .select("provider_key, is_configured, last_test_status")
      .in("provider_key", keysNeedingCheck);
    if (credErr) return internalError(res, "Error in PUT /api/super-admin/assistant-settings (credentials check):", credErr);
    const credByKey = new Map((credRows || []).map((r: any) => [r.provider_key, r]));

    const notReady = keysNeedingCheck.filter((key) => {
      const cred = credByKey.get(key);
      return !cred || !cred.is_configured || cred.last_test_status !== 'success';
    });
    if (notReady.length > 0) {
      return res.status(400).json({
        error: `لا يمكن التفعيل قبل اختبار الاتصال بنجاح لهذا المزوّد: ${notReady.map((k) => PROVIDERS[k]?.label || k).join('، ')}`,
      });
    }

    const updatePayload: any = {
      is_enabled: Boolean(data.isEnabled),
      active_provider: activeProvider,
      active_model: String(data.activeModel || PROVIDERS[activeProvider].defaultModels[0]),
      fallback_order: fallbackOrder.filter((p) => p !== activeProvider),
      system_prompt: String(data.systemPrompt || ''),
      temperature: Math.min(1, Math.max(0, Number(data.temperature) || 0)),
      max_tokens: Math.max(1, parseInt(data.maxTokens, 10) || 500),
      daily_message_limit: Math.max(0, parseInt(data.dailyMessageLimit, 10) || 0),
      updated_at: new Date().toISOString(),
      updated_by: req.user?.email || req.user?.uid || null,
    };

    const { data: updated, error } = await supabaseAdmin
      .from("assistant_settings")
      .update(updatePayload)
      .eq("id", "global")
      .select("*")
      .maybeSingle();

    if (error) return internalError(res, "Error in PUT /api/super-admin/assistant-settings:", error);

    await supabaseAdmin.from('saas_security_logs').insert({
      user_id: req.user?.uid,
      user_email: req.user?.email,
      action: 'assistant_settings_updated',
      details: `isEnabled=${updatePayload.is_enabled}, activeProvider=${updatePayload.active_provider}, activeModel=${updatePayload.active_model}, fallbackOrder=${JSON.stringify(updatePayload.fallback_order)}`,
    }).then(({ error: logErr }: any) => {
      if (logErr) logger.warn({ err: logErr }, '[saas_security_logs] insert failed');
    });

    const { data: credRowsAfter } = await supabaseAdmin.from("assistant_provider_credentials").select("*");

    res.json({
      isEnabled: updated.is_enabled,
      activeProvider: updated.active_provider,
      activeModel: updated.active_model,
      fallbackOrder: updated.fallback_order || [],
      systemPrompt: updated.system_prompt,
      temperature: updated.temperature,
      maxTokens: updated.max_tokens,
      dailyMessageLimit: updated.daily_message_limit,
      updatedAt: updated.updated_at,
      updatedBy: updated.updated_by,
      providers: await buildProviderStatusList(credRowsAfter || []),
    });
  } catch (err: any) {
    internalError(res, "Error in PUT /api/super-admin/assistant-settings:", err);
  }
});

// يحفظ مفتاح API لمزوّد واحد (إن أُرسل مفتاح جديد غير فارغ) ثم يختبر
// الاتصال فوراً برسالة توليد قصيرة جداً -- لا فائدة من حفظ مفتاح دون
// التحقق من صحته، ولا من اختبار مفتاح غير محفوظ. حقل apiKey فارغ = استخدم
// المفتاح المحفوظ مسبقاً لهذا المزوّد (لإعادة اختباره فقط). يحدّث
// last_tested_at/last_test_status/last_test_message بدقة النتيجة الفعلية.
app.post("/api/super-admin/assistant-settings/providers/:providerKey/test", authenticate, authorize(['super_admin']), async (req: any, res) => {
  try {
    const { providerKey } = req.params;
    const { PROVIDERS, isKnownProvider, buildModelForProvider } = await import("./src/server/aiProviderRegistry.ts");
    if (!isKnownProvider(providerKey)) return res.status(400).json({ error: `مزوّد غير معروف: ${providerKey}` });

    const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");
    const { encryptApiKey, decryptApiKey, maskApiKey } = await import("./src/server/assistantCrypto.ts");

    const bodyApiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
    const modelName = String(req.body?.modelName || PROVIDERS[providerKey].defaultModels[0]);

    let apiKeyToTest: string;
    if (bodyApiKey) {
      const { error: upsertErr } = await supabaseAdmin.from("assistant_provider_credentials").upsert({
        provider_key: providerKey,
        api_key_encrypted: encryptApiKey(bodyApiKey),
        is_configured: true,
        last_test_status: null,
        last_test_message: null,
        last_tested_at: null,
        updated_at: new Date().toISOString(),
        updated_by: req.user?.email || req.user?.uid || null,
      });
      if (upsertErr) return internalError(res, "Error in POST /api/super-admin/assistant-settings/providers/:providerKey/test (credential upsert):", upsertErr);
      apiKeyToTest = bodyApiKey;
    } else {
      const { data: cred } = await supabaseAdmin
        .from("assistant_provider_credentials")
        .select("api_key_encrypted")
        .eq("provider_key", providerKey)
        .maybeSingle();
      if (!cred?.api_key_encrypted) {
        return res.status(400).json({ error: 'لا يوجد مفتاح محفوظ لهذا المزوّد لاختباره' });
      }
      apiKeyToTest = decryptApiKey(cred.api_key_encrypted);
    }

    let success = false;
    let message = '';
    try {
      const model = await buildModelForProvider(providerKey, modelName, apiKeyToTest);
      const { generateText } = await import('ai');
      await generateText({ model, prompt: 'قل "تم الاتصال بنجاح" فقط.', maxOutputTokens: 20 });
      success = true;
      message = 'تم الاتصال بنجاح';
    } catch (err: any) {
      success = false;
      message = String(err?.message || 'فشل الاتصال').slice(0, 500);
    }

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("assistant_provider_credentials")
      .update({
        last_tested_at: new Date().toISOString(),
        last_test_status: success ? 'success' : 'failed',
        last_test_message: success ? null : message,
      })
      .eq("provider_key", providerKey)
      .select("*")
      .maybeSingle();
    if (updateErr) logger.error({ err: updateErr }, '[assistant_provider_credentials] test-status update failed');

    let apiKeyMasked = '';
    if (updated?.api_key_encrypted) {
      try { apiKeyMasked = maskApiKey(decryptApiKey(updated.api_key_encrypted)); } catch { apiKeyMasked = '••••••••'; }
    }

    res.json({
      success,
      message,
      provider: {
        providerKey,
        label: PROVIDERS[providerKey].label,
        defaultModels: PROVIDERS[providerKey].defaultModels,
        isConfigured: Boolean(updated?.is_configured),
        hasApiKey: Boolean(updated?.api_key_encrypted),
        apiKeyMasked,
        lastTestedAt: updated?.last_tested_at || null,
        lastTestStatus: updated?.last_test_status || null,
        lastTestMessage: updated?.last_test_message || null,
      },
    });
  } catch (err: any) {
    internalError(res, "Error in POST /api/super-admin/assistant-settings/providers/:providerKey/test:", err);
  }
});

// اختبار حي (صندوق المحادثة في أسفل صفحة الإعدادات): يستخدم القيم غير
// المحفوظة القادمة من الفورم مباشرة (مزوّد/نموذج/برومبت قد يكون المستخدم
// غيّرها للتو)، وليس من القاعدة، حتى يرى السوبر أدمن أثر تعديلاته فوراً قبل
// الحفظ. إن لم يُرسل حقل apiKey (المستخدم لم يكتب مفتاحاً جديداً في بطاقة
// هذا المزوّد)، يقع رجوعاً على المفتاح المحفوظ فعلياً لهذا المزوّد.
app.post("/api/super-admin/assistant-settings/test", authenticate, authorize(['super_admin']), async (req: any, res) => {
  try {
    const { aiProvider, modelName, apiKey, systemPrompt, temperature, maxTokens, message } = req.body || {};
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: "Missing 'message' to test with" });
    }

    const { isKnownProvider, buildModelForProvider, PROVIDERS } = await import("./src/server/aiProviderRegistry.ts");
    const providerKey = isKnownProvider(aiProvider) ? aiProvider : 'gemini';

    let effectiveApiKey = typeof apiKey === 'string' && apiKey.trim().length > 0 ? apiKey.trim() : '';
    if (!effectiveApiKey) {
      const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");
      const { data } = await supabaseAdmin
        .from("assistant_provider_credentials")
        .select("api_key_encrypted")
        .eq("provider_key", providerKey)
        .maybeSingle();
      if (data?.api_key_encrypted) {
        const { decryptApiKey } = await import("./src/server/assistantCrypto.ts");
        effectiveApiKey = decryptApiKey(data.api_key_encrypted);
      }
    }
    if (!effectiveApiKey) {
      return res.status(400).json({ error: "No API key configured to test with" });
    }

    const { streamText } = await import('ai');
    const model = await buildModelForProvider(providerKey, String(modelName || PROVIDERS[providerKey].defaultModels[0]), effectiveApiKey);
    const effectiveModelName = String(modelName || PROVIDERS[providerKey].defaultModels[0]);
    const requestedMaxTokens = Math.max(1, parseInt(maxTokens, 10) || 500);

    const result = streamText({
      model,
      system: String(systemPrompt || ''),
      messages: [{ role: 'user', content: message }],
      temperature: Math.min(1, Math.max(0, Number(temperature) || 0.7)),
      maxOutputTokens: requestedMaxTokens,
    });

    // نسخة مخصّصة من streamTextOrError هنا تحديداً (لا الدالة المشتركة):
    // زر "اختبار" الغرض منه بالذات كشف مشاكل الإعداد قبل الاعتماد عليها
    // فعلياً، فخطأ سقف max_tokens (شائع مع نماذج Groq الصغيرة/التجريبية،
    // انظر extractMaxTokensCeiling) يجب أن يظهر للسوبر أدمن بوضوح ليصحّح
    // الإعداد، لا أن يُخفى أو يُستبدَل صامتاً كما في محادثة الإنتاج.
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    let wroteAny = false;
    try {
      for await (const chunk of result.textStream) {
        wroteAny = true;
        res.write(chunk);
      }
      res.end();
    } catch (streamErr: any) {
      logger.error({ err: streamErr }, 'Assistant test stream error');
      if (wroteAny) {
        res.write(`\n\n[${streamErr.message || 'حدث خطأ أثناء توليد الرد'}]`);
        res.end();
        return;
      }
      const ceiling = extractMaxTokensCeiling(streamErr.message);
      if (ceiling !== null) {
        return res.status(400).json({
          error: `النموذج "${effectiveModelName}" يسمح بحد أقصى ${ceiling} توكن للإخراج، لكن "الحد الأقصى للتوكنز" هنا مضبوط على ${requestedMaxTokens}. قلّل القيمة إلى ${ceiling} أو أقل ثم أعد الاختبار.`,
        });
      }
      return res.status(502).json({ error: streamErr.message || 'Assistant model call failed' });
    }
  } catch (err: any) {
    logger.error({ err }, "Error in POST /api/super-admin/assistant-settings/test");
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || "Internal Server Error" });
    }
  }
});

app.post("/api/chat", authenticate, async (req: any, res) => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return res.status(401).json({ error: 'Unauthorized: No tenant ID found' });

    const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");
    const { data: settings, error: settingsErr } = await supabaseAdmin
      .from("assistant_settings")
      .select("*")
      .eq("id", "global")
      .maybeSingle();

    if (settingsErr || !settings) {
      return res.status(500).json({ error: "Assistant settings unavailable" });
    }
    if (!settings.is_enabled) {
      return res.status(403).json({ error: 'assistant_disabled', message: 'مساعد سين الذكي معطّل حالياً.' });
    }

    // تعطيل خاص بهذا المشترك (منفصل عن المفتاح العام أعلاه) -- طبقة حماية
    // ثانية على مستوى الخادم، لا تكتفِ بما يعرضه GET status للواجهة فقط.
    const { data: tenantRow, error: tenantErr } = await supabaseAdmin
      .from("tenants")
      .select("assistant_enabled, vertical")
      .eq("id", tenantId)
      .maybeSingle();
    if (tenantErr) return res.status(500).json({ error: "Assistant settings unavailable" });
    if (tenantRow?.assistant_enabled === false) {
      return res.status(403).json({ error: 'assistant_disabled', message: 'مساعد سين الذكي معطّل لحسابكم حالياً.' });
    }

    if (settings.daily_message_limit > 0) {
      const { data: newCount, error: usageErr } = await supabaseAdmin.rpc('increment_assistant_usage', { p_tenant_id: tenantId });
      if (usageErr) {
        logger.error({ err: usageErr }, 'increment_assistant_usage failed');
      } else if (typeof newCount === 'number' && newCount > settings.daily_message_limit) {
        return res.status(429).json({ error: 'daily_limit_reached', message: 'تم الوصول للحد الأقصى من الرسائل اليوم.' });
      }
    }

    const { messages, userName, page, conversationId, replyId } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Missing 'messages'" });
    }

    const roleLabels: Record<string, string> = {
      owner: 'صاحب المحل', admin: 'مدير', manager: 'مدير فرع', cashier: 'كاشير',
      tailor: 'خيّاط', super_admin: 'مسؤول المنصة',
    };
    const roleLabel = roleLabels[req.user?.role || ''] || 'مستخدم';
    const toolsAddendum = `

لديك أدوات وصول لبيانات حقيقية من نظام المتجر (مبيعات، فواتير، مخزون، عملاء، طلبات). استخدمها دائماً عندما يسأل المستخدم عن أرقام أو بيانات فعلية، بدل التخمين أو الإجابة من معرفة عامة. لخّص نتائج الأدوات بلغة عربية واضحة وودية، لا تكتفِ بإرجاع أرقام جافة فقط. أدواتك قراءة فقط تماماً: إذا طلب المستخدم تعديل أو حذف أي بيانات، وجّهه لاستخدام واجهة النظام العادية بدل محاولة تنفيذ ذلك. بعض الأدوات (التقارير المالية التفصيلية) متاحة فقط لأدوار الإدارة — إذا رفضتها الأداة، أخبر المستخدم بذلك بأدب دون محاولة الإلحاح أو الالتفاف على القيد مهما أعاد صياغة الطلب. إن أخطأت أداة أثناء التنفيذ (لا رفض صلاحية، بل خطأ فعلي)، قل للمستخدم صراحة أن البيانات تعذّر جلبها الآن وأن يحاول مرة أخرى — لا تُخمّن الرقم أو تُقدّره بنفسك مهما بدا قريباً من المعقول.`;
    // seen-ai-assistant-redesign-task.md 2-2: today's date in Riyadh and the
    // page the person has open (matched against a fixed list, never copied).
    const { buildMomentContext, buildVerticalContext } = await import('./src/server/assistantContext.ts');
    // The shop's activity and its stage names (seen-verticals-readiness-task.md Phase 7.3).
    const shopVertical = (tenantRow as any)?.vertical || 'mens_tailoring';
    const [{ data: verticalRow }, { data: stageRows }] = await Promise.all([
      supabaseAdmin.from('verticals').select('name_ar').eq('key', shopVertical).maybeSingle(),
      supabaseAdmin.from('vertical_workflow_stages').select('stage_key, label_ar, phase, sort').eq('vertical_key', shopVertical).order('sort'),
    ]);
    const verticalContext = buildVerticalContext((verticalRow as any)?.name_ar, (stageRows || []) as any[]);
    const contextualSystemPrompt = `${ASSISTANT_PERSONA_AND_KNOWLEDGE}\n\n${settings.system_prompt}${toolsAddendum}\n\nيتحدث معك الآن: ${userName || ''} (${roleLabel}).\n${buildMomentContext(page)}${verticalContext ? `\n${verticalContext}` : ''}`;

    // ترتيب المرشّحين: المزوّد النشط أولاً، ثم الترتيب الاحتياطي (بدون
    // تكرار المزوّد النشط)، بعد استبعاد أي مزوّد بلا مفتاح محفوظ فعلياً.
    const { PROVIDERS } = await import("./src/server/aiProviderRegistry.ts");
    // The same list the status route uses to decide whether to show the launcher.
    const { candidateProviderKeys } = await import("./src/server/assistantReadiness.ts");
    const candidateKeys = candidateProviderKeys(settings);

    const { data: credRows } = await supabaseAdmin
      .from("assistant_provider_credentials")
      .select("provider_key, api_key_encrypted, is_configured")
      .in("provider_key", candidateKeys);
    const credByKey = new Map((credRows || []).map((r: any) => [r.provider_key, r]));

    const { decryptApiKey } = await import("./src/server/assistantCrypto.ts");
    const candidates: Array<{ providerKey: string; modelName: string; apiKey: string }> = [];
    for (const key of candidateKeys) {
      const cred = credByKey.get(key);
      if (!cred || !cred.is_configured || !cred.api_key_encrypted) continue;
      let decrypted: string;
      try { decrypted = decryptApiKey(cred.api_key_encrypted); } catch { continue; }
      const modelName = key === settings.active_provider
        ? settings.active_model
        : (PROVIDERS[key]?.defaultModels?.[0] || settings.active_model);
      candidates.push({ providerKey: key, modelName, apiKey: decrypted });
    }

    if (candidates.length === 0) {
      return res.status(503).json({ error: 'assistant_not_configured', message: 'لم يتم إعداد مساعد سين الذكي بعد.' });
    }

    const { streamText, stepCountIs } = await import('ai');
    const { buildAssistantTools } = await import('./src/server/assistantTools.ts');
    const tools = await buildAssistantTools({
      tenantId,
      userId: req.user?.uid,
      userRole: req.user?.role,
      staffId: req.user?.staffId,
    });
    // seen-ai-assistant-zatca-cr-task.md #3: حد دفاعي على الخادم نفسه، بصرف
    // النظر عمّا يرسله العميل -- SeenAIFab.tsx يقتطع لآخر MAX_HISTORY_MESSAGES
    // (20) قبل الإرسال أصلاً، لكن هذا يبقى السد الفعلي ضد أي عميل آخر (أو
    // نسخة قديمة مخزَّنة محلياً) يرسل سجلاً كاملاً بلا قطع.
    const MAX_HISTORY_MESSAGES = 20;
    const conversationMessages: Array<{ role: 'assistant' | 'user'; content: string }> = messages
      .slice(-MAX_HISTORY_MESSAGES)
      .map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' as const : 'user' as const, content: String(m.content || '') }));

    // seen-ai-assistant-redesign-task.md 2-4: keep the conversation for this
    // person. A failure here never stops the answer -- history is a
    // convenience, the reply is the point.
    const history = await import('./src/server/assistantHistory.ts');
    const lastQuestion = [...conversationMessages].reverse().find((m) => m.role === 'user')?.content || '';
    let historyId: string | null = null;
    if (history.isConversationId(conversationId) && lastQuestion && req.user?.uid) {
      try {
        const owned = await history.storeQuestion(supabaseAdmin, { tenantId, userId: req.user.uid }, conversationId, lastQuestion);
        if (owned) historyId = conversationId;
        else logger.warn({ tenantId }, '[assistant-history] conversation id belongs to someone else; not stored');
      } catch (historyErr) {
        logger.error({ err: historyErr }, '[assistant-history] storing the question failed');
      }
    }
    // A reply the person stopped is not kept: they never saw the rest of it.
    let clientGone = false;
    res.on('close', () => { if (!res.writableFinished) clientGone = true; });

    const reply = await streamAssistantReply(
      candidates,
      (model, maxOutputTokensOverride) => streamText({
        model,
        system: contextualSystemPrompt,
        messages: conversationMessages,
        temperature: settings.temperature,
        maxOutputTokens: maxOutputTokensOverride ?? settings.max_tokens,
        tools,
        stopWhen: stepCountIs(5),
      }),
      res,
      async (failedProviderKey, reason, nextProviderKey) => {
        try {
          await supabaseAdmin.from('saas_security_logs').insert({
            user_id: req.user?.uid,
            user_email: req.user?.email,
            action: 'assistant_provider_auto_fallback',
            details: nextProviderKey
              ? `[tenant=${tenantId}] فشل المزوّد '${failedProviderKey}' (${reason}) -- تم التبديل تلقائياً إلى '${nextProviderKey}'`
              : `[tenant=${tenantId}] فشل المزوّد '${failedProviderKey}' (${reason}) -- لا يوجد مزوّد احتياطي آخر متاح`,
          });
        } catch (logErr) {
          logger.error({ err: logErr }, '[saas_security_logs] fallback log insert failed');
        }
      },
    );

    if (historyId && reply && !clientGone) {
      try {
        await history.storeReply(supabaseAdmin, historyId, reply, history.isReplyId(replyId) ? replyId : null);
      } catch (historyErr) {
        logger.error({ err: historyErr }, '[assistant-history] storing the reply failed');
      }
    }
  } catch (err: any) {
    logger.error({ err }, "Error in POST /api/chat");
    if (!res.headersSent) {
      res.status(500).json({ error: 'حدث خطأ أثناء التواصل مع المساعد، حاول مرة أخرى.' });
    }
  }
});

// =============================================================================
// ZATCA real onboarding (seen-zatca-real-onboarding-task.md), Phase ب step 6:
// called by POS.tsx right after create_pos_sale succeeds, for every sale.
// A complete no-op (the common case today -- no tenant has a production
// zatca_credentials row yet) until a tenant actually finishes real ZATCA
// onboarding; this endpoint is what activates per-tenant once that happens,
// with zero code changes needed elsewhere.
//
// The PIH chain (seen-readiness-fixes-task.md P2.2, ZATCA-07/08): the
// placeholder hash create_pos_sale writes is no longer what the chain hangs
// on. Each document is stamped at issue (ICV, UUID, lines), then signed by
// the server strictly in ICV order -- PIH = the previous document's real
// hash -- under one signing turn per shop (zatca_signing_begin/_store/_end,
// 20270103000001), and that signed XML is what is sent and resent.
// =============================================================================

// seen-readiness-fixes-task.md P2.4 -- the ZATCA send, shared by the routes and the queue.
type ZatcaSendResult = { status: number; body: any };
const reply = (status: number, body: any): ZatcaSendResult => ({ status, body });
function internalFailure(context: string, err: unknown): ZatcaSendResult {
  logger.error({ err }, context);
  captureServerException(err, { context });
  return { status: 500, body: { error: 'Internal Server Error' } };
}
/** ZATCA turned the document down (a 4xx other than 429); anything else is worth retrying. */
function isZatcaRejection(err: any): boolean {
  const code = Number(err?.status ?? err?.statusCode);
  return err?.name === 'ZatcaApiError' && code >= 400 && code < 500 && code !== 429;
}

// seen-readiness-fixes-task.md P2.4: the send of an invoice or a credit note,
// called by the routes (the cashier's device asking for an immediate send)
// and by the ZATCA queue worker (/api/cron/zatca-queue).
async function zatcaSendDocument(kind: 'invoice' | 'credit_note', tenantId: string, refId: string): Promise<ZatcaSendResult> {
  const route = kind === 'invoice' ? '/api/zatca/submit-invoice' : '/api/zatca/submit-credit-note';
  const table = kind === 'invoice' ? 'tax_invoices' : 'sales_returns';
  const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");

  const { data: prodCreds } = await supabaseAdmin
    .from('zatca_credentials')
    .select('certificate, private_key_encrypted, secret_encrypted, created_at')
    .eq('tenant_id', tenantId)
    .eq('csid_type', 'production')
    .maybeSingle();
  // No production certificate for this shop: nothing is sent.
  if (!prodCreds) return reply(200, { ok: true, status: 'not_applicable' });

  // seen-readiness-fixes-task.md P2.1/P2.2: what is sent is the document as
  // it was fixed at issue (ICV, UUID, date, lines) and signed in ICV order
  // (src/server/zatcaChain.ts) -- the same XML on every retry.
  const columns = 'id, tenant_id, icv, zatca_uuid, signed_xml, invoice_hash, zatca_status';
  const load = async () => {
    const q = supabaseAdmin.from(table).select(columns).eq('tenant_id', tenantId);
    const { data } = await (kind === 'invoice' ? q.eq('order_id', refId) : q.eq('id', refId)).maybeSingle();
    return data as any;
  };
  let doc = await load();
  if (!doc) return reply(404, { error: kind === 'invoice' ? 'Invoice not found for this order' : 'Credit note not found' });
  if (doc.zatca_status === 'cleared' || doc.zatca_status === 'reported') {
    return reply(200, { ok: true, status: doc.zatca_status, replayed: true });
  }
  if (doc.icv === null || doc.icv === undefined) {
    return reply(409, { error: 'Issued before the ZATCA chain -- not sent' });
  }

  const { decryptZatcaSecret } = await import('./src/server/zatcaCrypto.ts');
  if (!doc.signed_xml) {
    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('name, vat_number, commercial_register, address, city, postal_code')
      .eq('id', tenantId)
      .maybeSingle();
    if (!tenant?.vat_number || !tenant?.name) {
      return reply(409, { error: 'Tenant tax settings incomplete; cannot submit to ZATCA' });
    }
    const { signPendingDocuments } = await import('./src/server/zatcaChain.ts');
    const seller = {
      legalName: tenant.name,
      vatNumber: tenant.vat_number,
      crn: tenant.commercial_register || undefined,
      street: tenant.address || undefined,
      city: tenant.city || undefined,
      postalCode: tenant.postal_code || undefined,
      countryCode: 'SA',
    };
    const key = {
      privateKeyPem: decryptZatcaSecret(prodCreds.private_key_encrypted),
      certificate: prodCreds.certificate,
      since: prodCreds.created_at,
    };
    // Every earlier document of the shop is signed first, in order.
    for (let round = 0; round < 10 && !doc.signed_xml; round++) {
      const r = await signPendingDocuments(supabaseAdmin, tenantId, seller, key);
      if (r.error) return internalFailure(`Error in ${route} (signing):`, new Error(r.error));
      if (r.busy) return reply(409, { error: 'ZATCA signing in progress for this shop' });
      doc = await load();
      if (r.signed === 0) break;
    }
    // Still unsigned with nothing left to sign: issued before the shop's
    // production certificate, so outside its chain.
    if (!doc?.signed_xml) return reply(200, { ok: true, status: 'not_applicable' });
  }

  const { clearInvoice, reportInvoice, ZatcaApiError } = await import('./src/server/zatcaApiClient.ts');
  const { qrFromDocument } = await import('./src/server/zatcaXades.ts');
  const isB2B = doc.signed_xml.includes('<cbc:InvoiceTypeCode name="0100000">');
  const auth = { binarySecurityToken: prodCreds.certificate, secret: decryptZatcaSecret(prodCreds.secret_encrypted) };
  const submission = {
    invoiceHash: doc.invoice_hash,
    uuid: doc.zatca_uuid,
    invoiceBase64: Buffer.from(doc.signed_xml, 'utf8').toString('base64'),
  };
  const now = new Date();

  try {
    // Atomic claim: only one request sends a given document at a time.
    const { data: claimed, error: claimError } = await supabaseAdmin
      .from(table)
      .update({ zatca_status: 'pending' })
      .eq('id', doc.id)
      .not('zatca_status', 'in', '(cleared,reported,pending)')
      .select('id')
      .maybeSingle();
    if (claimError) return internalFailure(`Error in ${route} (claim):`, claimError);
    if (!claimed) {
      return reply(409, { error: `ZATCA submission already in progress or completed for this ${kind === 'invoice' ? 'invoice' : 'credit note'}` });
    }

    const result = isB2B
      ? await clearInvoice(submission, auth, 'production')
      : await reportInvoice(submission, auth, 'production');

    // ZATCA-09: a cleared (standard) document is printed with the QR ZATCA put in it.
    let clearedQr: string | null = null;
    if (isB2B) {
      let raw: any = result.raw;
      if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { raw = null; } }
      if (typeof raw?.clearedInvoice === 'string') {
        clearedQr = qrFromDocument(Buffer.from(raw.clearedInvoice, 'base64').toString('utf8'));
      }
    }

    await supabaseAdmin
      .from(table)
      .update({
        zatca_status: isB2B ? 'cleared' : 'reported',
        zatca_response: result.raw,
        zatca_submitted_at: now.toISOString(),
        ...(clearedQr ? { zatca_qr: clearedQr } : {}),
      })
      .eq('id', doc.id);

    return reply(200, { ok: true, status: isB2B ? 'cleared' : 'reported' });
  } catch (err: any) {
    const isZatcaError = err instanceof ZatcaApiError;
    // ZATCA-17: ZATCA turning the document down (4xx) is a rejection; a
    // network failure, a timeout or ZATCA being down (5xx, 429) is retried.
    const failedStatus = isZatcaRejection(err) ? 'rejected' : 'retry';
    await supabaseAdmin
      .from(table)
      .update({
        zatca_status: failedStatus,
        zatca_response: isZatcaError ? err.body : { message: String(err?.message || err) },
        zatca_submitted_at: now.toISOString(),
      })
      .eq('id', doc.id);

    logger.error({ err }, `[zatca${route.slice('/api/zatca'.length)}]`);
    // B2B rejection must never look like success to the caller -- POS.tsx
    // surfaces this to the cashier instead of treating the sale as done.
    return reply(502, { error: `ZATCA rejected or failed to process this ${kind === 'invoice' ? 'invoice' : 'credit note'}`, status: failedStatus, isB2B });
  }
}

const zatcaSendInvoice = (tenantId: string, orderId: string) => zatcaSendDocument('invoice', tenantId, orderId);
const zatcaSendCreditNote = (tenantId: string, creditNoteId: string) => zatcaSendDocument('credit_note', tenantId, creditNoteId);

app.post("/api/zatca/submit-invoice", authenticate, asyncHandler(async (req: any, res) => {
  const tenantId = req.user?.tenantId;
  const { orderId } = req.body || {};
  if (!tenantId) return res.status(401).json({ error: 'Unauthorized' });
  if (typeof orderId !== 'string' || !orderId) return res.status(400).json({ error: 'orderId is required' });
  const r = await zatcaSendInvoice(tenantId, orderId);
  return res.status(r.status).json(r.body);
}));

// =============================================================================
// seen-ai-assistant-zatca-cr-task.md, ZATCA #1: submits a credit note
// (sales_returns row, created today via CreditNotes.tsx) to ZATCA as type
// code 381, referencing the original invoice via cac:BillingReference.
// Mirrors /api/zatca/submit-invoice's shape closely on purpose (two-pass
// build -> hash -> sign -> rebuild, atomic claim, chain-tip swap) --
// deliberately NOT a shared helper with submit-invoice: the two pull from
// different source tables (sales_returns vs tax_invoices/orders) with just
// enough different field shapes that forcing one shared function would
// trade a little duplication for a worse, harder-to-follow abstraction.
//
// Debit notes (383) are NOT wired here -- there is no existing data model or
// UI anywhere in this project for "debit note" the way CreditNotes.tsx/
// sales_returns already exist for credit notes (a debit note is a merchant
// invoicing a customer for MORE after the fact, not a return -- a different
// business flow with no current anchor point). buildCreditNoteXml in
// zatcaInvoiceXml.ts already supports either via its invoiceTypeCode
// parameter, so adding a debit-note route later is mechanical once that
// workflow actually exists; inventing one now with no real entry point
// would just be dead, never-wired code.
// =============================================================================
app.post("/api/zatca/submit-credit-note", authenticate, asyncHandler(async (req: any, res) => {
  const tenantId = req.user?.tenantId;
  const { creditNoteId } = req.body || {};
  if (!tenantId) return res.status(401).json({ error: 'Unauthorized' });
  if (typeof creditNoteId !== 'string' || !creditNoteId) return res.status(400).json({ error: 'creditNoteId is required' });
  const r = await zatcaSendCreditNote(tenantId, creditNoteId);
  return res.status(r.status).json(r.body);
}));

// =============================================================================
// ZATCA merchant onboarding wizard (seen-zatca-service-process.md) -- the
// sequence a tenant runs ONCE to actually connect to ZATCA (CSR -> OTP ->
// Compliance CSID -> compliance tests -> Production CSID). Everything above
// this point (submit-invoice) only starts working for a tenant once this
// sequence has completed and a 'production' zatca_credentials row exists.
// Owner/admin only -- same gate as /api/tenant/settings, since this writes
// tenant-identifying certificates, not day-to-day sale data.
//
// seen-launch-readiness-report.md blocker #1: requestComplianceCsid/
// submitComplianceInvoice/requestProductionCsid were ALL hardcoded to
// 'sandbox' -- including Production CSID, which ZATCA's own process issues
// from the real production gateway (.../core), never the developer-portal
// sandbox. A CSID minted that way would fail on the very first real sale.
// zatcaTestEnvironment() below controls only the TEST phase (Compliance
// CSID + compliance test invoices); Production CSID issuance is hardcoded
// to 'production' just below, deliberately not tied to this variable.
// =============================================================================

function zatcaTestEnvironment(): 'sandbox' | 'simulation' {
  const raw = (process.env.ZATCA_TEST_ENVIRONMENT || 'sandbox').trim().toLowerCase();
  return raw === 'simulation' ? 'simulation' : 'sandbox';
}

app.get("/api/zatca/onboarding-status", authenticate, requirePermission('settings.tax'), asyncHandler(async (req: any, res) => {
  const tenantId = req.user?.tenantId;
  if (!tenantId) return res.status(401).json({ error: 'Unauthorized' });

  const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");
  const [{ data: pending }, { data: creds }] = await Promise.all([
    supabaseAdmin.from('zatca_pending_csr').select('created_at').eq('tenant_id', tenantId).maybeSingle(),
    supabaseAdmin.from('zatca_credentials').select('csid_type').eq('tenant_id', tenantId),
  ]);

  res.json({
    hasPendingCsr: !!pending,
    hasComplianceCsid: (creds || []).some((c: any) => c.csid_type === 'compliance'),
    hasProductionCsid: (creds || []).some((c: any) => c.csid_type === 'production'),
  });
}));

app.post("/api/zatca/generate-csr", authenticate, requirePermission('settings.tax'), asyncHandler(async (req: any, res) => {
  const tenantId = req.user?.tenantId;
  if (!tenantId) return res.status(401).json({ error: 'Unauthorized' });

  const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");
  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('name, vat_number, commercial_register, address, city')
    .eq('id', tenantId)
    .maybeSingle();

  // Mirrors the submit-invoice route's own guard: never build a CSR under
  // an incomplete/fabricated identity. The wizard's own "confirm data" step
  // (أ) is what should normally catch this before the user even reaches the
  // "generate CSR" button.
  if (!tenant?.name || !tenant?.vat_number || !tenant?.commercial_register || !tenant?.address || !tenant?.city) {
    return res.status(409).json({ error: 'بيانات المنشأة ناقصة (الاسم، الرقم الضريبي، السجل التجاري، العنوان، المدينة) -- أكمِلها من تبويب الملف الشخصي أولاً' });
  }

  const { generateTestKeyPair: generateEcKeyPair } = await import('./src/server/zatcaSigning.ts');
  const { generateZatcaCsr } = await import('./src/server/zatcaCsr.ts');
  const { encryptZatcaSecret } = await import('./src/server/zatcaCrypto.ts');

  const egsSerialNumber = `seen-${String(tenantId).slice(0, 8)}-${Date.now()}`;
  const { privateKeyPem, publicKeyPem } = generateEcKeyPair();
  // Phase 4 decision (seen-zatca-service-process.md): one CSID per TENANT,
  // not per branch -- zatca_credentials has no branch_id, UNIQUE(tenant_id,
  // csid_type) only. organizationUnitName is set to the tenant's own legal
  // name rather than a specific branch identifier on purpose; revisit only
  // if a real tenant explicitly needs per-branch invoice units.
  const { csrBase64 } = generateZatcaCsr(
    {
      countryCode: 'SA',
      organizationUnitName: tenant.name,
      organizationName: tenant.vat_number,
      commonName: `1-Seen|2-SeenPOS|3-${egsSerialNumber}`,
      vatNumber: tenant.vat_number,
      egsSerialNumber,
      location: tenant.city,
      businessCategory: 'Tailoring and Garment Services',
    },
    privateKeyPem,
    publicKeyPem
  );

  const { error } = await supabaseAdmin.from('zatca_pending_csr').upsert({
    tenant_id: tenantId,
    private_key_encrypted: encryptZatcaSecret(privateKeyPem),
    csr_base64: csrBase64,
    egs_serial_number: egsSerialNumber,
    created_at: new Date().toISOString(),
  });
  if (error) return internalError(res, "Error in POST /api/zatca/generate-csr:", error);

  res.json({ csrBase64 });
}));

app.post("/api/zatca/request-compliance-csid", authenticate, requirePermission('settings.tax'), asyncHandler(async (req: any, res) => {
  const tenantId = req.user?.tenantId;
  const otp = typeof req.body?.otp === 'string' ? req.body.otp.trim() : '';
  if (!tenantId) return res.status(401).json({ error: 'Unauthorized' });
  if (!otp) return res.status(400).json({ error: 'رمز OTP مطلوب' });

  const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");
  const { data: pending } = await supabaseAdmin
    .from('zatca_pending_csr')
    .select('csr_base64, private_key_encrypted')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (!pending) return res.status(409).json({ error: 'لا يوجد CSR معلَّق -- ولِّد واحداً أولاً (الخطوة ب)' });

  const { requestComplianceCsid, ZatcaApiError } = await import('./src/server/zatcaApiClient.ts');
  const { encryptZatcaSecret, extractCertificateExpiry } = await import('./src/server/zatcaCrypto.ts');

  try {
    const result = await requestComplianceCsid(pending.csr_base64, otp, zatcaTestEnvironment());
    const { error } = await supabaseAdmin.from('zatca_credentials').upsert(
      {
        tenant_id: tenantId,
        csid_type: 'compliance',
        certificate: result.binarySecurityToken,
        private_key_encrypted: pending.private_key_encrypted, // already encrypted -- same key pair the CSR was built with
        secret_encrypted: encryptZatcaSecret(result.secret),
        request_id: result.requestId,
        expires_at: extractCertificateExpiry(result.binarySecurityToken)?.toISOString() ?? null,
        expiry_alert_sent_at: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,csid_type' }
    );
    if (error) return internalError(res, "Error in POST /api/zatca/request-compliance-csid:", error);

    res.json({ ok: true });
  } catch (err: any) {
    if (err instanceof ZatcaApiError) {
      logger.error({ err }, '[zatca/request-compliance-csid]');
      return res.status(502).json({ error: 'رفضت زاتكا طلب Compliance CSID -- تحقَّق من صحة رمز OTP', details: err.body });
    }
    internalError(res, "Error in POST /api/zatca/request-compliance-csid:", err);
  }
}));

app.post("/api/zatca/run-compliance-tests", authenticate, requirePermission('settings.tax'), asyncHandler(async (req: any, res) => {
  const tenantId = req.user?.tenantId;
  if (!tenantId) return res.status(401).json({ error: 'Unauthorized' });

  const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");
  const [{ data: creds }, { data: tenant }] = await Promise.all([
    supabaseAdmin.from('zatca_credentials').select('certificate, private_key_encrypted, secret_encrypted').eq('tenant_id', tenantId).eq('csid_type', 'compliance').maybeSingle(),
    supabaseAdmin.from('tenants').select('name, vat_number, commercial_register, address, city').eq('id', tenantId).maybeSingle(),
  ]);
  if (!creds) return res.status(409).json({ error: 'لا توجد شهادة Compliance CSID بعد -- أكمِل خطوة OTP أولاً' });

  const { decryptZatcaSecret } = await import('./src/server/zatcaCrypto.ts');
  const { signZatcaDocument } = await import('./src/server/zatcaInvoiceXml.ts');
  const { ZATCA_FIRST_PIH, readZatcaCertificate } = await import('./src/server/zatcaXades.ts');
  const { riyadhDateTime } = await import('./src/server/zatcaChain.ts');
  const { submitComplianceInvoice, ZatcaApiError } = await import('./src/server/zatcaApiClient.ts');

  const privateKeyPem = decryptZatcaSecret(creds.private_key_encrypted);
  const auth = { binarySecurityToken: creds.certificate, secret: decryptZatcaSecret(creds.secret_encrypted) };
  const certificate = readZatcaCertificate(creds.certificate);
  const at = riyadhDateTime(new Date());
  const seller = {
    legalName: tenant?.name || 'Seen Test Merchant',
    vatNumber: tenant?.vat_number || '399999999900003',
    crn: tenant?.commercial_register || undefined,
    street: tenant?.address || undefined,
    city: tenant?.city || undefined,
    countryCode: 'SA',
  };
  const buyer = { legalName: 'Test Buyer', vatNumber: '399999999900003', street: 'Test Street', buildingNumber: '1234', district: 'Test', city: 'Riyadh', postalCode: '12345' };
  const lines = [{ id: '1', itemName: 'Test Item', quantity: 1, lineExtensionAmount: 100, taxAmount: 15, taxPercent: 15 }];

  // seen-readiness-fixes-task.md P2.3 (ZATCA-06): the six documents ZATCA's
  // compliance check asks for, chained like real ones (ICV 1-6, each PIH the
  // previous document's hash). Notes reference the invoice of their kind.
  const plan = [
    { name: 'standard invoice', type: 'invoice', simplified: false },
    { name: 'standard credit note', type: 'credit_note', simplified: false },
    { name: 'standard debit note', type: 'debit_note', simplified: false },
    { name: 'simplified invoice', type: 'invoice', simplified: true },
    { name: 'simplified credit note', type: 'credit_note', simplified: true },
    { name: 'simplified debit note', type: 'debit_note', simplified: true },
  ] as const;
  let pih = ZATCA_FIRST_PIH;
  const results: { type: string; status?: string; error?: unknown }[] = [];
  for (const [i, p] of plan.entries()) {
    try {
      const uuid = crypto.randomUUID();
      const doc = signZatcaDocument({
        type: p.type,
        simplified: p.simplified,
        invoiceNumber: `TEST-COMPLIANCE-${i + 1}`,
        uuid,
        issueDate: at.date,
        issueTime: at.time,
        icv: i + 1,
        pih,
        seller,
        buyer: p.simplified ? undefined : buyer,
        paymentMeansCode: '10',
        billingReference: p.type === 'invoice' ? undefined : (p.simplified ? 'TEST-COMPLIANCE-4' : 'TEST-COMPLIANCE-1'),
        reason: p.type === 'invoice' ? undefined : 'Compliance test',
        lines,
      }, { privateKeyPem, certificate, signingTime: `${at.date}T${at.time}` });
      pih = doc.invoiceHash;
      const invoiceBase64 = Buffer.from(doc.xml, 'utf8').toString('base64');
      const result = await submitComplianceInvoice({ invoiceHash: doc.invoiceHash, uuid, invoiceBase64 }, auth, zatcaTestEnvironment());
      results.push({ type: p.name, status: result.status });
    } catch (err: any) {
      logger.error({ err, kind: p.name }, '[zatca/run-compliance-tests]');
      results.push({ type: p.name, error: err instanceof ZatcaApiError ? err.body : String(err?.message || err) });
    }
  }

  res.json({ ok: results.length === plan.length && results.every(r => !r.error), results });
}));

app.post("/api/zatca/request-production-csid", authenticate, requirePermission('settings.tax'), asyncHandler(async (req: any, res) => {
  const tenantId = req.user?.tenantId;
  if (!tenantId) return res.status(401).json({ error: 'Unauthorized' });

  const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");
  const { data: creds } = await supabaseAdmin
    .from('zatca_credentials')
    .select('certificate, private_key_encrypted, secret_encrypted, request_id')
    .eq('tenant_id', tenantId)
    .eq('csid_type', 'compliance')
    .maybeSingle();
  if (!creds?.request_id) return res.status(409).json({ error: 'لا يوجد طلب Compliance CSID مكتمل -- أكمِل الخطوات السابقة أولاً' });

  const { decryptZatcaSecret, encryptZatcaSecret, extractCertificateExpiry } = await import('./src/server/zatcaCrypto.ts');
  const { requestProductionCsid, ZatcaApiError } = await import('./src/server/zatcaApiClient.ts');

  const auth = { binarySecurityToken: creds.certificate, secret: decryptZatcaSecret(creds.secret_encrypted) };

  try {
    // Deliberately NOT zatcaTestEnvironment() -- ZATCA issues the real
    // Production CSID from its production gateway (.../core) regardless of
    // which test environment the compliance phase used. This was the
    // launch-readiness report's #1 blocker: every CSID this route minted
    // was actually a sandbox credential, which real Clearance/Reporting
    // (already correctly hardcoded to 'production') would reject outright.
    const result = await requestProductionCsid(creds.request_id, auth, 'production');
    const { error } = await supabaseAdmin.from('zatca_credentials').upsert(
      {
        tenant_id: tenantId,
        csid_type: 'production',
        certificate: result.binarySecurityToken,
        private_key_encrypted: creds.private_key_encrypted, // same key pair throughout -- ZATCA re-certifies the same CSR's key, never a new one
        secret_encrypted: encryptZatcaSecret(result.secret),
        request_id: result.requestId,
        expires_at: extractCertificateExpiry(result.binarySecurityToken)?.toISOString() ?? null,
        expiry_alert_sent_at: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,csid_type' }
    );
    if (error) return internalError(res, "Error in POST /api/zatca/request-production-csid:", error);

    // Pending CSR row has now been fully promoted (compliance + production
    // both issued from it) -- nothing left to resume from it.
    await supabaseAdmin.from('zatca_pending_csr').delete().eq('tenant_id', tenantId);

    res.json({ ok: true });
  } catch (err: any) {
    if (err instanceof ZatcaApiError) {
      logger.error({ err }, '[zatca/request-production-csid]');
      return res.status(502).json({ error: 'رفضت زاتكا طلب Production CSID', details: err.body });
    }
    internalError(res, "Error in POST /api/zatca/request-production-csid:", err);
  }
}));

// =============================================================================
// seen-ai-assistant-zatca-cr-task.md, ZATCA #2: مراقبة انتهاء صلاحية شهادات
// زاتكا -- Vercel Cron يستدعي هذا المسار يومياً (vercel.json). لا جلسة
// مستخدم هنا (لا "authenticate" العادية) -- التحقق عبر CRON_SECRET فقط، بنفس
// الطريقة الموصى بها من Vercel نفسها لحماية مسارات الـcron من أي استدعاء
// عام غير مصرَّح به (vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs).
// يُنبِّه مرة واحدة فقط لكل شهادة (عبر expiry_alert_sent_at) -- لا نفس
// التنبيه كل يوم حتى يتجدد الاتصال.
// =============================================================================
const ZATCA_CERT_EXPIRY_ALERT_WINDOW_DAYS = 30;

app.get("/api/cron/zatca-cert-expiry-check", asyncHandler(async (req: any, res) => {
  // seen-status-fix-regressions-task.md item 8: constant-time secret
  // comparison, same pattern as /api/cron/blog-rebuild-sweep (SRV-10) --
  // a plain `!==` leaks timing information proportional to how many
  // leading characters match.
  const cronSecret = (process.env.CRON_SECRET || '').trim();
  const providedAuth = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  const expectedAuth = `Bearer ${cronSecret}`;
  const providedBuf = Buffer.from(providedAuth);
  const expectedBuf = Buffer.from(expectedAuth);
  const authMatches = cronSecret.length > 0
    && providedBuf.length === expectedBuf.length
    && crypto.timingSafeEqual(providedBuf, expectedBuf);
  if (!authMatches) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");
  const cutoff = new Date(Date.now() + ZATCA_CERT_EXPIRY_ALERT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: expiringSoon, error } = await supabaseAdmin
    .from('zatca_credentials')
    .select('tenant_id, csid_type, expires_at')
    .eq('csid_type', 'production')
    .not('expires_at', 'is', null)
    .lte('expires_at', cutoff)
    .is('expiry_alert_sent_at', null);
  if (error) return internalError(res, "Error in GET /api/cron/zatca-cert-expiry-check:", error);

  let alerted = 0;
  for (const row of expiringSoon || []) {
    const daysLeft = Math.max(0, Math.ceil((new Date(row.expires_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
    try {
      await supabaseAdmin.from('notifications').insert({
        tenant_id: row.tenant_id,
        title: 'شهادة زاتكا تقترب من انتهاء الصلاحية',
        message: `شهادة زاتكا (CSID) الخاصة بمتجرك ستنتهي خلال ${daysLeft} يوماً تقريباً. تواصل مع زاتكا لتجديدها قبل الانتهاء لتفادي توقف إصدار الفواتير الإلكترونية.`,
        type: 'alert',
        status: 'unread',
        metadata: { source: 'zatca_cert_expiry', expires_at: row.expires_at, days_left: daysLeft },
      });
      await supabaseAdmin
        .from('zatca_credentials')
        .update({ expiry_alert_sent_at: new Date().toISOString() })
        .eq('tenant_id', row.tenant_id)
        .eq('csid_type', 'production');
      alerted++;
    } catch (err) {
      logger.error({ err, tenantId: row.tenant_id }, '[cron/zatca-cert-expiry-check] failed to alert one tenant -- continuing with the rest');
    }
  }

  res.json({ ok: true, checked: (expiringSoon || []).length, alerted });
}));

// seen-readiness-fixes-task.md P2.4 -- the ZATCA queue worker. Sends the
// invoices and credit notes that are due (public.zatca_submissions), the same
// send the cashier's device asks for, and records the outcome: retried with a
// growing delay when ZATCA cannot be reached, kept with its reason when ZATCA
// rejects it. Scheduled by .github/workflows/zatca-queue.yml; CRON_SECRET only.
app.all("/api/cron/zatca-queue", asyncHandler(async (req: any, res) => {
  const cronSecret = (process.env.CRON_SECRET || '').trim();
  const providedAuth = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  const expectedAuth = `Bearer ${cronSecret}`;
  const providedBuf = Buffer.from(providedAuth);
  const expectedBuf = Buffer.from(expectedAuth);
  const authMatches = cronSecret.length > 0
    && providedBuf.length === expectedBuf.length
    && crypto.timingSafeEqual(providedBuf, expectedBuf);
  if (!authMatches) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");
  const { classifyZatcaSend } = await import('./src/server/zatcaQueue.ts');
  const { data: rows, error } = await supabaseAdmin.rpc('zatca_claim_submissions', { p_limit: 20 });
  if (error) return internalError(res, 'Error in /api/cron/zatca-queue (claim):', error);

  const summary: Record<string, number> = { sent: 0, retry: 0, rejected: 0, failed: 0, not_applicable: 0 };
  for (const row of (rows || []) as Array<{ id: string; tenant_id: string; kind: string; ref_id: string }>) {
    let outcome: { status: string; error: string | null };
    let result: ZatcaSendResult | null = null;
    try {
      result = row.kind === 'invoice'
        ? await zatcaSendInvoice(row.tenant_id, row.ref_id)
        : await zatcaSendCreditNote(row.tenant_id, row.ref_id);
      outcome = classifyZatcaSend(result);
    } catch (err: any) {
      outcome = { status: 'retry', error: String(err?.message || err).slice(0, 500) };
    }
    await supabaseAdmin.rpc('zatca_finish_submission', {
      p_id: row.id, p_status: outcome.status, p_error: outcome.error, p_result: result?.body ?? null,
    });
    summary[outcome.status] = (summary[outcome.status] || 0) + 1;
  }
  logger.info({ claimed: (rows || []).length, ...summary }, '[cron/zatca-queue]');
  return res.json({ ok: true, claimed: (rows || []).length, ...summary });
}));

// Vercel Cron يستدعي هذا المسار دورياً (vercel.json) ليدفع إعادة بناء الموقع
// بعد تعديلات المقالات المجمَّعة -- نفس نمط حماية CRON_SECRET أعلاه، بلا جلسة
// مستخدم (لا "authenticate" العادية).
//
// seen-cto-sprint0-critical-fixes-task.md item 10 (BLOG-01, BLOG-02):
// - الورك فلو الخارجي (.github/workflows/blog-rebuild-sweep.yml) يستدعي
//   هذا المسار بـ POST؛ كان مسجَّلاً GET فقط فيرجع 404 دائماً (ينشر
//   إخفاق ومنذ البداية لم يُشغِّل إعادة بناء واحدة) -- app.all يقبل الآن
//   كل الطرق (GET لأي استدعاء Cron مستقبلي، POST للورك فلو الحالي).
// - لا يُشغَّل إعادة بناء -- أي نشر كامل للتطبيق -- بلا شرط في كل استدعاء
//   (كل 15 دقيقة على مضيفين): نقرأ وقت آخر "sweep" ناجح من
//   saas_settings['blog_last_rebuild_sweep_at'] ولا نستدعي
//   triggerBlogRebuild() إلا إذا وُجدت مقالة واحدة على الأقل أصبح
//   publishDate لها مستحقاً (بين ذلك الوقت والآن) -- يطابق توصية المراجعة
//   نفسها: "fire hook only if due".
// - السر يُقارن بزمن ثابت (crypto.timingSafeEqual) بدل `!==` العادية (SRV-10).
app.all("/api/cron/blog-rebuild-sweep", asyncHandler(async (req: any, res) => {
  const cronSecret = (process.env.CRON_SECRET || '').trim();
  const providedAuth = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  const expectedAuth = `Bearer ${cronSecret}`;
  const providedBuf = Buffer.from(providedAuth);
  const expectedBuf = Buffer.from(expectedAuth);
  const authMatches = cronSecret.length > 0
    && providedBuf.length === expectedBuf.length
    && crypto.timingSafeEqual(providedBuf, expectedBuf);
  if (!authMatches) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  // This route's entire job IS the deploy hook -- unlike the save routes
  // (where a missing hook must stay non-fatal), a missing URL here must be a
  // clear 500 naming the variable, not a silent 200 that looks like success.
  if (!process.env.BLOG_DEPLOY_HOOK_URL) {
    return res.status(500).json({ error: 'Missing required environment variable: BLOG_DEPLOY_HOOK_URL' });
  }

  const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");
  const { data: lastSweepSetting } = await supabaseAdmin
    .from('saas_settings')
    .select('value')
    .eq('key', 'blog_last_rebuild_sweep_at')
    .maybeSingle();
  const lastSweepAt = typeof lastSweepSetting?.value === 'string' ? new Date(lastSweepSetting.value) : new Date(0);
  const now = new Date();

  const articles = await fetchAllArticles();
  const dueArticle = articles.find(article => {
    const publishDate = new Date(article.frontmatter.publishDate);
    return publishDate.getTime() > lastSweepAt.getTime() && publishDate.getTime() <= now.getTime();
  });

  if (!dueArticle) {
    res.status(200).json({ ok: true, rebuilt: false });
    return;
  }

  await triggerBlogRebuild();
  await supabaseAdmin
    .from('saas_settings')
    .upsert({ key: 'blog_last_rebuild_sweep_at', value: now.toISOString(), updated_at: now.toISOString() });

  res.status(200).json({ ok: true, rebuilt: true });
}));

// شبكة أمان أخيرة لما يفلت من كل شيء أعلاه (تسجيل فقط، بلا رد على العميل --
// الطلب الأصلي يبقى معلّقًا حتى وقت دالة Vercel). لا تستدعِ process.exit() في
// unhandledRejection/uncaughtException -- هذا التطبيق يعمل كدالة Vercel
// serverless (عبر api/index.js)، وإنهاء العملية غير مجدٍ/ضار في هذا السياق.
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logger.error({ err }, '[unhandledRejection]');
  captureServerException(err, { source: 'unhandledRejection' });
});
process.on('uncaughtException', (err) => {
  logger.error({ err }, '[uncaughtException]');
  captureServerException(err, { source: 'uncaughtException' });
});

// middleware معالجة أخطاء عام (4 معاملات) -- يجب أن يُسجَّل بعد كل مسارات
// /api/* أعلاه ليلتقط ما يُمرَّر إليه عبر next(err). لا يغيّر سلوك أي مسار
// يعالج أخطاءه بنفسه (الأغلبية هنا فعلياً يفعل). تنبيه: Express 4 لا يمرّر
// رفض Promise غير ملتقط من معالج async إلى هذا الـ middleware تلقائيًا --
// فقط الأخطاء المتزامنة أو تلك المُمرَّرة يدويًا عبر next(err) (أو معالج
// مُغلَّف بـ asyncHandler أعلاه) تصل إليه. مسار async جديد بلا try/catch
// وبلا asyncHandler سيُترك معلّقًا حتى وقت دالة Vercel، مسجَّلاً فقط عبر
// unhandledRejection أعلاه.
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  ((req as any).log || logger).error({ err }, `[globalErrorHandler] ${req.path}`);
  captureServerException(err, { path: req.path, method: req.method });
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'حدث خطأ غير متوقع، حاول لاحقًا' });
});

async function setupServer() {
  // Public marketing landing page served at the site root "/" for visitors.
  // The SPA (app) keeps handling /login, /dashboard, /orders, ... as usual.
  if (process.env.NODE_ENV !== "production") {
    // Loaded lazily -- this branch never runs under Vercel's serverless
    // Function (see the VERCEL !== '1' guard below), and a static import of
    // the whole Vite dev-server toolchain has no business being pulled into
    // that function's production bundle.
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);

    // Development catch-all route to serve index.html for client-side routing
    app.get('*', async (req, res, next) => {
      // Skip API requests and files with extensions
      if (req.path.startsWith('/api') || req.path.includes('.')) {
        return next();
      }
      try {
        const url = req.originalUrl;
        const indexHtml = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf-8');
        const html = await vite.transformIndexHtml(url, indexHtml);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
      } catch (e) {
        next(e);
      }
    });
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }
}

// Only start the listening server if we're not running as a Vercel function
if (process.env.VERCEL !== '1') {
  setupServer().then(() => {
    const PORT = 3000;
    app.listen(PORT, "0.0.0.0", () => {
      logger.info({ port: PORT }, `Server running on http://localhost:${PORT}`);
    });
  });
}

export default app;
