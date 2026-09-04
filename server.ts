import express from "express";
import path from "path";
import fs from "fs";
import dotenv from 'dotenv';
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { authenticate, authorize } from "./src/server/middleware/authMiddleware.ts";
import { registerPrintRelay } from "./src/server/printRelay.ts";

dotenv.config();

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

// E-2 (security-fix-tasklist.md): baseline HTTP security headers and a
// general per-IP rate limit, on top of the endpoint-specific limiter added
// for /api/staff/verify-pin (E-1) and the pre-existing pairAttempts one in
// printRelay.ts. CSP is left disabled for now -- this app pulls in Google
// OAuth/Identity Services, Moyasar (payments), and web fonts, all of which
// need to be allowlisted deliberately and tested before turning on a strict
// CSP; shipping a default-restrictive CSP without that pass would silently
// break login/payment for real users.
//
// crossOriginOpenerPolicy is explicitly relaxed to same-origin-allow-popups
// (Google's own recommendation for Identity Services): helmet's default
// same-origin COOP isolates the Google Sign-In popup from window.opener,
// breaking the postMessage-based credential handoff Login.tsx relies on.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
}));
app.use(rateLimit({ windowMs: 60_000, max: 120 }));

// حجم كبير لأن بيانات الرسم النقطي للفاتورة قد تصل لعدة ميغابايت
app.use(express.json({ limit: '25mb' }));

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

    const { data: orderData, error: orderError } = await supabaseAdmin
      .from('orders')
      .select('order_number, order_date, total_amount, tax_amount, tenant_id, customer_id')
      .eq('id', id)
      .maybeSingle();

    if (orderError || !orderData) {
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
    console.error("Error fetching invoice:", err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// صفحة تتبّع الطلب العامة (/track/:token في الواجهة) -- بلا مصادقة، رمز
// عشوائي غير قابل للتخمين (orders.tracking_token). نفس نمط
// /api/public/invoices/:id أعلاه: supabaseAdmin (يتجاوز RLS) مع اختيار
// الحقول المسموحة فقط يدوياً -- لا استعلام عام مباشر من المتصفح على
// orders، ولا RPC معرَّض لـanon (تفادياً للاعتماد على رؤية IP الحقيقي
// للعميل داخل Postgres خلف مجمِّع الاتصالات). التفاصيل الكاملة في
// PUBLIC_TRACKING_SPEC.md.
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

  const { data: orderData } = await supabaseAdmin
    .from('orders')
    .select('order_number, status, status_key, delivery_date, tenant_id')
    .eq('tracking_token', token)
    .maybeSingle();

  if (!orderData) {
    await recordFailure();
    return res.status(404).json({ error: 'Order not found' });
  }

  const { data: tenantData } = await supabaseAdmin
    .from('tenants')
    .select('name, logo_url')
    .eq('id', orderData.tenant_id)
    .maybeSingle();

  res.json({
    order_number: orderData.order_number,
    status: (orderData as any).status_key || orderData.status,
    shop_name: tenantData?.name || '',
    shop_logo_url: tenantData?.logo_url || null,
    delivery_date: orderData.delivery_date,
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
    console.error('[order-tracking/subscribe]', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }

  res.json({ ok: true });
}));

// نص عربي مبسّط لحالات الخياطة الرجالية القديمة (mens_tailoring) فقط --
// نفس فجوة STEPS الموثّقة في PUBLIC_TRACKING_SPEC.md: مستأجرو القطاعات
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
  const title = `طلبك رقم ${orderData.order_number}`;
  const body = `الحالة الآن: ${ORDER_STATUS_LABELS_AR[statusKey] || statusKey}`;
  const link = `${req.protocol}://${req.get('host')}/track/${orderData.tracking_token}`;

  const results = await Promise.allSettled(
    subs.map((s: { fcm_token: string }) => adminMessaging.send({
      token: s.fcm_token,
      notification: { title, body },
      webpush: { fcmOptions: { link } },
    }))
  );

  // ينظّف توكِنات FCM المنتهية/المُلغاة بدل تركها تفشل بصمت كل مرة.
  const deadTokens = results
    .map((r: PromiseSettledResult<any>, i: number) => ({ r, token: subs[i].fcm_token }))
    .filter(({ r }: any) => r.status === 'rejected' && r.reason?.code === 'messaging/registration-token-not-registered')
    .map(({ token }: any) => token);

  if (deadTokens.length) {
    await supabaseAdmin.from('order_push_subscriptions').delete().eq('tracking_token', orderData.tracking_token).in('fcm_token', deadTokens);
  }

  res.json({ ok: true, sent: results.filter((r: PromiseSettledResult<any>) => r.status === 'fulfilled').length });
}));

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
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
      return res.status(500).json({ error: error.message });
    }

    res.json(data || []);
  } catch (err: any) {
    console.error("Error in GET /api/inventory-adjustments:", err);
    res.status(500).json({ error: err.message || 'Internal Server Error' });
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
      return res.status(500).json({ error: error.message });
    }

    res.json(data || []);
  } catch (err: any) {
    console.error("Error in GET /api/inventory-adjustments/:id/items:", err);
    res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
});

app.post("/api/inventory-adjustments", authenticate, async (req: any, res) => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized: No tenant ID found' });
    }

    const { header, details, branchInventoryUpdates, ledgerPayloads } = req.body;
    if (!header || !details) {
      return res.status(400).json({ error: 'Missing header or details payload' });
    }

    const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");

    // 1. Insert header record with verified tenantId
    const headerPayload = {
      ...header,
      tenant_id: tenantId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data: headerData, error: headerErr } = await supabaseAdmin
      .from("inventory_adjustments")
      .insert(headerPayload)
      .select()
      .single();

    if (headerErr) {
      console.error("Error inserting adjustment header:", headerErr);
      return res.status(500).json({ error: `Header insert failed: ${headerErr.message}` });
    }

    const adjustmentId = headerData.id;

    // 2. Insert detail records
    const detailRows = details.map((d: any) => ({
      ...d,
      tenant_id: tenantId,
      adjustment_id: adjustmentId,
      created_at: new Date().toISOString(),
    }));

    const { error: detailsErr } = await supabaseAdmin
      .from("adjustment_items")
      .insert(detailRows);

    if (detailsErr) {
      console.error("Error inserting adjustment details:", detailsErr);
      // Clean up header to avoid dangling reference
      await supabaseAdmin.from("inventory_adjustments").delete().eq("id", adjustmentId);
      return res.status(500).json({ error: `Details insert failed: ${detailsErr.message}` });
    }

    // 3. If Approved, update branch inventories and insert stock ledger rows
    if (header.status === "Approved") {
      try {
        // 3a. Update branch inventories
        if (Array.isArray(branchInventoryUpdates)) {
          for (const update of branchInventoryUpdates) {
            if (update.has_existing) {
              const { error: stockUpdateErr } = await supabaseAdmin
                .from("branch_inventory")
                .update({
                  quantity: update.quantity,
                  updated_at: new Date().toISOString(),
                })
                .eq("tenant_id", tenantId)
                .eq("branch_id", update.branch_id)
                .eq("item_id", update.item_id);

              if (stockUpdateErr) {
                throw new Error(`Branch stock update failed: ${stockUpdateErr.message}`);
              }
            } else {
              const { error: stockInsertErr } = await supabaseAdmin
                .from("branch_inventory")
                .insert({
                  branch_id: update.branch_id,
                  item_id: update.item_id,
                  quantity: update.quantity,
                  tenant_id: tenantId,
                  updated_at: new Date().toISOString(),
                });

              if (stockInsertErr) {
                throw new Error(`Branch stock insert failed: ${stockInsertErr.message}`);
              }
            }
          }
        }

        // 3b. Insert stock ledger logs
        if (Array.isArray(ledgerPayloads) && ledgerPayloads.length > 0) {
          const loggedRows = ledgerPayloads.map((l: any) => {
            // Strip out notes or any other fields that aren't on the stock_ledger schema
            const { notes, ...rest } = l;
            return {
              ...rest,
              tenant_id: tenantId,
              reference_id: adjustmentId,
              reference_type: "adjustment",
              created_at: new Date().toISOString(),
            };
          });

          const { error: ledgerErr } = await supabaseAdmin
            .from("stock_ledger")
            .insert(loggedRows);

          if (ledgerErr) {
            throw new Error(`Stock ledger write failed: ${ledgerErr.message}`);
          }
        }
      } catch (innerErr: any) {
        console.error("Error in stock update/ledger steps, rolling back adjustment records:", innerErr);
        // Clean up both header and details (cascaded delete)
        await supabaseAdmin.from("inventory_adjustments").delete().eq("id", adjustmentId);
        return res.status(500).json({ error: innerErr.message });
      }
    }

    res.json(headerData);
  } catch (err: any) {
    console.error("Error in POST /api/inventory-adjustments:", err);
    res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
});

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
    console.error("Error updating temp password status:", err);
    res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
});

// Creates a Supabase Auth account for a new staff/team member. This must be
// server-side: supabaseAdmin.auth.admin.createUser() requires the
// service-role key, which must never reach the browser. Replaces the old
// client-side "spin up a secondary Firebase app" trick used by
// SaaSTeamManagement.tsx / AddEmployeeModal.tsx / Staff.tsx.
app.post("/api/staff/create-account", authenticate, authorize(['super_admin', 'owner', 'admin', 'manager']), async (req: any, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");
    const normalizedEmail = String(email).toLowerCase();

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: name || '' },
    });

    if (error) {
      const alreadyRegistered = /already been registered|already registered/i.test(error.message || '');
      if (alreadyRegistered) {
        // SECURITY: do NOT use auth.admin.listUsers() here — it would let any
        // manager/admin/owner enumerate every registered email on the whole
        // platform (and learn other tenants'/SaaS staff's raw Auth UIDs).
        // Only resolve via this app's own `users` mirror table, which is the
        // same lookup the original client-side fallback used.
        const { data: match } = await supabaseAdmin
          .from('users')
          .select('id')
          .eq('email', normalizedEmail)
          .maybeSingle();
        if (match) {
          return res.json({ uid: match.id, alreadyExisted: true });
        }
        return res.status(409).json({ error: 'email_already_in_use_no_match' });
      }
      return res.status(400).json({ error: error.message });
    }

    res.json({ uid: data.user!.id, alreadyExisted: false });
  } catch (err: any) {
    console.error("Error creating staff account:", err);
    res.status(500).json({ error: err.message || 'Internal Server Error' });
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
// requests. In-memory counter keyed by tenant+caller, same pattern as
// pairAttempts in src/server/printRelay.ts: 5 failed attempts locks out for
// an escalating window (1, 2, 4, 8, capped at 15 minutes), reset entirely on
// a successful match.
const verifyPinAttempts = new Map<string, { failCount: number; lockUntil: number; lockMinutes: number }>();
const VERIFY_PIN_MAX_ATTEMPTS = 5;
const VERIFY_PIN_MAX_LOCK_MINUTES = 15;
setInterval(() => {
  const now = Date.now();
  for (const [key, rec] of verifyPinAttempts) {
    if (now > rec.lockUntil && rec.failCount === 0) verifyPinAttempts.delete(key);
  }
}, 5 * 60_000);

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

    // check-unique (used while an admin sets someone else's PIN, not a
    // login attempt) is exempt from this limiter -- it's not a path an
    // attacker could use to brute-force their way into another account.
    const attemptKey = mode === 'check-unique' ? null : `${tenantId}:${req.user?.uid}`;
    if (attemptKey) {
      const rec = verifyPinAttempts.get(attemptKey);
      if (rec && Date.now() < rec.lockUntil) {
        return res.status(429).json({
          error: 'محاولات كثيرة جداً. يرجى الانتظار قبل إعادة المحاولة.',
          retryAfterSeconds: Math.ceil((rec.lockUntil - Date.now()) / 1000),
        });
      }
    }

    const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");

    const [{ data: staffData }, { data: rolesData }] = await Promise.all([
      supabaseAdmin.from('staff').select('*').eq('tenant_id', tenantId).eq('status', 'active'),
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
        const rec = verifyPinAttempts.get(attemptKey) || { failCount: 0, lockUntil: 0, lockMinutes: 1 };
        rec.failCount += 1;
        if (rec.failCount >= VERIFY_PIN_MAX_ATTEMPTS) {
          rec.lockUntil = Date.now() + rec.lockMinutes * 60_000;
          rec.lockMinutes = Math.min(rec.lockMinutes * 2, VERIFY_PIN_MAX_LOCK_MINUTES);
          rec.failCount = 0;
        }
        verifyPinAttempts.set(attemptKey, rec);
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

    if (attemptKey) verifyPinAttempts.delete(attemptKey);

    const actualRole = matched.role_id ? (rolesMap.get(matched.role_id) || matched.role) : matched.role;
    res.json({
      matched: true,
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
    console.error("Error verifying staff PIN:", err);
    res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
});

// Returns every active staff member's plain-text PIN for this tenant, so an
// admin/owner can look one up to hand out or resolve a "PIN doesn't work"
// report. Restricted to admin-level roles server-side: the `staff` table's
// RLS only scopes SELECT by tenant, not by role, so a plain client-side
// query (or any staff member with devtools) would otherwise let any staff
// member -- down to a cashier -- read every coworker's, and the owner's,
// login PIN directly.
app.get("/api/staff/pins", authenticate, authorize(['super_admin', 'owner', 'admin', 'manager']), async (req: any, res) => {
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
    console.error("Error fetching staff pins:", err);
    res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
});

// Example Protected Route: Only accessible by Super Admin
app.get("/api/admin/stats", authenticate, authorize(['super_admin']), (req, res) => {
  res.json({
    message: "Welcome Super Admin",
    stats: { totalTenants: 10, revenue: 50000 }
  });
});

// Example Protected Route: Accessible by Owners and Admins (and managers for GET)
app.get("/api/tenant/settings", authenticate, authorize(['owner', 'admin', 'manager']), async (req: any, res) => {
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
        console.warn("Failed to parse tenant.legacy_id JSON:", e);
      }
    }

    const hasVat = Boolean(tenant.vat_number && tenant.vat_number.trim().length > 0);
    const rawTax = parsedMeta.tax_settings || parsedMeta;

    const taxSettings = rawTax ? {
      ...rawTax,
      enabled: rawTax.enabled ?? (hasVat || Boolean(rawTax.trn)),
      trn: rawTax.trn || tenant.vat_number || '',
      legalName: rawTax.legalName || tenant.name || '',
      vatRate: rawTax.vatRate ?? 15,
      tailoringTaxType: rawTax.tailoringTaxType || 'exclusive'
    } : {
      enabled: hasVat,
      trn: tenant.vat_number || '',
      legalName: tenant.name || '',
      vatRate: 15,
      tailoringTaxType: 'exclusive'
    };

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
      logoUrl: tenant.logo_url || '',
      taxSettings,
      notificationSettings
    });
  } catch (err: any) {
    console.error("Error in GET /api/tenant/settings:", err);
    res.status(500).json({ error: err.message || "Internal Server Error" });
  }
});

app.post("/api/tenant/settings", authenticate, authorize(['owner', 'admin']), async (req: any, res) => {
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

    const tax_settings = {
      ...data.taxSettings,
      notificationSettings: data.notificationSettings
    };

    const updatePayload: any = {
      name: data.name,
      phone: data.phone ? formatSaudiPhone(data.phone) : '',
      address: data.address,
      inventory_strategy: 'decentralized',
      logo_url: data.logoUrl,
      vat_number: data.taxSettings?.trn || '',
      is_tax_enabled: Boolean(data.taxSettings?.enabled),
      default_tax_rate: data.taxSettings?.vatRate || 15,
      legacy_id: JSON.stringify(tax_settings), // Store the complete JSON metadata in legacy_id
      updated_at: new Date().toISOString()
    };

    const { error } = await supabaseAdmin
      .from("tenants")
      .update(updatePayload)
      .eq("id", tenantId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error("Error in POST /api/tenant/settings:", err);
    res.status(500).json({ error: err.message || "Internal Server Error" });
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
async function streamTextOrError(result: any, res: any) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  let wroteAny = false;
  try {
    for await (const chunk of result.textStream) {
      wroteAny = true;
      res.write(chunk);
    }
    res.end();
  } catch (err: any) {
    console.error('Assistant stream error:', err);
    if (!wroteAny && !res.headersSent) {
      res.status(502).json({ error: err.message || 'Assistant model call failed' });
    } else {
      res.write(`\n\n[${err.message || 'حدث خطأ أثناء توليد الرد'}]`);
      res.end();
    }
  }
}

const ASSISTANT_FRIENDLY_ERROR = 'حدث خطأ أثناء التواصل مع المساعد، حاول مرة أخرى.';

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

// نسخة موسّعة من streamTextOrError لمحادثة /api/chat التي تستخدم أدوات
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
  buildResult: (model: any) => any,
  res: any,
  onFallback: (failedProviderKey: string, reason: string, nextProviderKey: string | null) => Promise<void>,
) {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  const { buildModelForProvider } = await import('./src/server/aiProviderRegistry.ts');

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    let wroteAny = false;
    try {
      const model = await buildModelForProvider(candidate.providerKey, candidate.modelName, candidate.apiKey);
      const result = buildResult(model);
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          wroteAny = true;
          res.write(JSON.stringify({ t: 'text', v: part.text }) + '\n');
        } else if (part.type === 'tool-call') {
          wroteAny = true;
          res.write(JSON.stringify({ t: 'status', name: part.toolName }) + '\n');
        } else if (part.type === 'tool-result') {
          wroteAny = true;
          res.write(JSON.stringify({ t: 'tool', name: part.toolName, result: part.output }) + '\n');
        } else if (part.type === 'tool-error') {
          wroteAny = true;
          console.error('[assistant-tool-error]', part.toolName, part.error);
          res.write(JSON.stringify({ t: 'tool-error', name: part.toolName, message: 'تعذّر تنفيذ الأداة' }) + '\n');
        } else if (part.type === 'error') {
          throw part.error instanceof Error ? part.error : new Error(String(part.error));
        }
      }
      res.end();
      return;
    } catch (err: any) {
      // المستخدم النهائي (Admin/Cashier في الـ Widget) لا يرى تفاصيل الخطأ
      // البرمجي أبداً (رسائل SDK/مزوّد الذكاء الاصطناعي الخام مثل quota/rate
      // limit) -- فقط سجل الخادم يحتفظ بها لأغراض التشخيص.
      console.error(`Assistant stream error [provider=${candidate.providerKey}]:`, err);

      if (wroteAny) {
        // بدأ العميل بالفعل يستلم جزءاً من الرد -- لا تبديل ممكن الآن.
        res.write(JSON.stringify({ t: 'text', v: `\n\n${ASSISTANT_FRIENDLY_ERROR}` }) + '\n');
        res.end();
        return;
      }

      const nextCandidate = candidates[i + 1];
      await onFallback(candidate.providerKey, err.message || 'unknown error', nextCandidate?.providerKey || null);
      // لم يُكتب شيء للعميل بعد -- آمن للمتابعة للمرشّح التالي في الحلقة.
    }
  }

  // فشلت كل المرشّحين المتاحين بلا أي إخراج على الإطلاق.
  if (!res.headersSent) {
    res.status(502).json({ error: ASSISTANT_FRIENDLY_ERROR });
  } else {
    res.end();
  }
}

// خفيف ومتاح لأي مستخدم مسجّل دخول (Admin/Cashier) — الـ Widget يسأله فقط
// "هل أعرض الزر العائم أصلاً؟"، بلا أي بيانات حساسة. يجمع بين المفتاح العام
// (assistant_settings.is_enabled، يُطفئ المساعد للمنصة بأكملها) وتعطيل خاص
// بهذا المشترك تحديداً (tenants.assistant_enabled، يديره السوبر أدمن لكل
// مشترك على حدة من لوحة إدارة المشتركين) -- كلاهما يجب أن يكون مفعّلاً.
app.get("/api/assistant-settings/status", authenticate, async (req: any, res) => {
  try {
    const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");
    const [{ data, error }, { data: tenant, error: tenantErr }] = await Promise.all([
      supabaseAdmin.from("assistant_settings").select("is_enabled").eq("id", "global").maybeSingle(),
      req.user?.tenantId
        ? supabaseAdmin.from("tenants").select("assistant_enabled").eq("id", req.user.tenantId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (error) return res.status(500).json({ error: error.message });
    if (tenantErr) return res.status(500).json({ error: tenantErr.message });
    const isEnabled = Boolean(data?.is_enabled) && tenant?.assistant_enabled !== false;
    res.json({ isEnabled });
  } catch (err: any) {
    console.error("Error in GET /api/assistant-settings/status:", err);
    res.status(500).json({ error: err.message || "Internal Server Error" });
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
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Assistant settings not found" });

    const { data: credRows, error: credErr } = await supabaseAdmin.from("assistant_provider_credentials").select("*");
    if (credErr) return res.status(500).json({ error: credErr.message });

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
    console.error("Error in GET /api/super-admin/assistant-settings:", err);
    res.status(500).json({ error: err.message || "Internal Server Error" });
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
    if (credErr) return res.status(500).json({ error: credErr.message });
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

    if (error) return res.status(500).json({ error: error.message });

    await supabaseAdmin.from('saas_security_logs').insert({
      user_id: req.user?.uid,
      user_email: req.user?.email,
      action: 'assistant_settings_updated',
      details: `isEnabled=${updatePayload.is_enabled}, activeProvider=${updatePayload.active_provider}, activeModel=${updatePayload.active_model}, fallbackOrder=${JSON.stringify(updatePayload.fallback_order)}`,
    }).then(({ error: logErr }: any) => {
      if (logErr) console.warn('[saas_security_logs] insert failed:', logErr.message);
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
    console.error("Error in PUT /api/super-admin/assistant-settings:", err);
    res.status(500).json({ error: err.message || "Internal Server Error" });
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
      if (upsertErr) return res.status(500).json({ error: upsertErr.message });
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
    if (updateErr) console.error('[assistant_provider_credentials] test-status update failed:', updateErr.message);

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
    console.error("Error in POST /api/super-admin/assistant-settings/providers/:providerKey/test:", err);
    res.status(500).json({ error: err.message || "Internal Server Error" });
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

    const result = streamText({
      model,
      system: String(systemPrompt || ''),
      messages: [{ role: 'user', content: message }],
      temperature: Math.min(1, Math.max(0, Number(temperature) || 0.7)),
      maxOutputTokens: Math.max(1, parseInt(maxTokens, 10) || 500),
    });

    await streamTextOrError(result, res);
  } catch (err: any) {
    console.error("Error in POST /api/super-admin/assistant-settings/test:", err);
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
      .select("assistant_enabled")
      .eq("id", tenantId)
      .maybeSingle();
    if (tenantErr) return res.status(500).json({ error: "Assistant settings unavailable" });
    if (tenantRow?.assistant_enabled === false) {
      return res.status(403).json({ error: 'assistant_disabled', message: 'مساعد سين الذكي معطّل لحسابكم حالياً.' });
    }

    if (settings.daily_message_limit > 0) {
      const { data: newCount, error: usageErr } = await supabaseAdmin.rpc('increment_assistant_usage', { p_tenant_id: tenantId });
      if (usageErr) {
        console.error('increment_assistant_usage failed:', usageErr.message);
      } else if (typeof newCount === 'number' && newCount > settings.daily_message_limit) {
        return res.status(429).json({ error: 'daily_limit_reached', message: 'تم الوصول للحد الأقصى من الرسائل اليوم.' });
      }
    }

    const { messages, userName } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Missing 'messages'" });
    }

    const roleLabels: Record<string, string> = {
      owner: 'صاحب المحل', admin: 'مدير', manager: 'مدير فرع', cashier: 'كاشير',
      tailor: 'خيّاط', super_admin: 'مسؤول المنصة',
    };
    const roleLabel = roleLabels[req.user?.role || ''] || 'مستخدم';
    const toolsAddendum = `

لديك أدوات وصول لبيانات حقيقية من نظام المتجر (مبيعات، فواتير، مخزون، عملاء، طلبات). استخدمها دائماً عندما يسأل المستخدم عن أرقام أو بيانات فعلية، بدل التخمين أو الإجابة من معرفة عامة. لخّص نتائج الأدوات بلغة عربية واضحة وودية، لا تكتفِ بإرجاع أرقام جافة فقط. أدواتك قراءة فقط تماماً: إذا طلب المستخدم تعديل أو حذف أي بيانات، وجّهه لاستخدام واجهة النظام العادية بدل محاولة تنفيذ ذلك. بعض الأدوات (التقارير المالية التفصيلية) متاحة فقط لأدوار الإدارة — إذا رفضتها الأداة، أخبر المستخدم بذلك بأدب دون محاولة الإلحاح أو الالتفاف على القيد مهما أعاد صياغة الطلب.`;
    const contextualSystemPrompt = `${ASSISTANT_PERSONA_AND_KNOWLEDGE}\n\n${settings.system_prompt}${toolsAddendum}\n\nيتحدث معك الآن: ${userName || ''} (${roleLabel}).`;

    // ترتيب المرشّحين: المزوّد النشط أولاً، ثم الترتيب الاحتياطي (بدون
    // تكرار المزوّد النشط)، بعد استبعاد أي مزوّد بلا مفتاح محفوظ فعلياً.
    const { PROVIDERS } = await import("./src/server/aiProviderRegistry.ts");
    const candidateKeys = Array.from(new Set([
      settings.active_provider,
      ...(Array.isArray(settings.fallback_order) ? settings.fallback_order : []),
    ].filter(Boolean)));

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
    });
    const conversationMessages: Array<{ role: 'assistant' | 'user'; content: string }> = messages.map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' as const : 'user' as const, content: String(m.content || '') }));

    await streamAssistantReply(
      candidates,
      (model) => streamText({
        model,
        system: contextualSystemPrompt,
        messages: conversationMessages,
        temperature: settings.temperature,
        maxOutputTokens: settings.max_tokens,
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
          console.error('[saas_security_logs] fallback log insert failed:', logErr);
        }
      },
    );
  } catch (err: any) {
    console.error("Error in POST /api/chat:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'حدث خطأ أثناء التواصل مع المساعد، حاول مرة أخرى.' });
    }
  }
});

// شبكة أمان أخيرة لما يفلت من كل شيء أعلاه (تسجيل فقط، بلا رد على العميل --
// الطلب الأصلي يبقى معلّقًا حتى وقت دالة Vercel). لا تستدعِ process.exit() في
// unhandledRejection/uncaughtException -- هذا التطبيق يعمل كدالة Vercel
// serverless (عبر api/index.js)، وإنهاء العملية غير مجدٍ/ضار في هذا السياق.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason instanceof Error ? reason : new Error(String(reason)));
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
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
  console.error(`[globalErrorHandler] ${req.path}:`, err);
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
      console.log(`Server running on http://localhost:${PORT}`);
    });
  });
}

export default app;
