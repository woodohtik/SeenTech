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

async function buildAssistantModel(provider: string, modelName: string, apiKey: string) {
  if (provider === 'gemini') {
    const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
    return createGoogleGenerativeAI({ apiKey })(modelName);
  }
  const { createOpenAI } = await import('@ai-sdk/openai');
  return createOpenAI({ apiKey })(modelName);
}

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

// نسخة موسّعة من streamTextOrError لمحادثة /api/chat التي تستخدم أدوات
// (tools): بروتوكول NDJSON بسيط (سطر JSON واحد لكل جزء) بدل النص الخام، حتى
// يستطيع العميل تمييز نص الرد عن نتائج الأدوات ويعرضها كبطاقات/جداول بدل
// نص خام، ويعرض مؤشر "جارِ البحث..." أثناء تنفيذ الأداة بدل شاشة فارغة.
// كل سطر إما {"t":"text","v":"..."} أو {"t":"status","name":...} (بدأ تنفيذ
// أداة) أو {"t":"tool","name":...,"result":...} أو {"t":"tool-error",...}.
async function streamAssistantReply(result: any, res: any) {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  let wroteAny = false;
  try {
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
  } catch (err: any) {
    // المستخدم النهائي (Admin/Cashier في الـ Widget) لا يرى تفاصيل الخطأ
    // البرمجي أبداً (رسائل SDK/مزوّد الذكاء الاصطناعي الخام مثل quota/rate
    // limit) -- فقط سجل الخادم يحتفظ بها لأغراض التشخيص. نص عربي مفهوم
    // بدلاً منها، بنفس صياغة ai.error_generic في الواجهة.
    console.error('Assistant stream error:', err);
    const FRIENDLY_ERROR = 'حدث خطأ أثناء التواصل مع المساعد، حاول مرة أخرى.';
    if (!wroteAny && !res.headersSent) {
      res.status(502).json({ error: FRIENDLY_ERROR });
    } else {
      res.write(JSON.stringify({ t: 'text', v: `\n\n${FRIENDLY_ERROR}` }) + '\n');
      res.end();
    }
  }
}

// خفيف ومتاح لأي مستخدم مسجّل دخول (Admin/Cashier) — الـ Widget يسأله فقط
// "هل أعرض الزر العائم أصلاً؟"، بلا أي بيانات حساسة.
app.get("/api/assistant-settings/status", authenticate, async (req: any, res) => {
  try {
    const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");
    const { data, error } = await supabaseAdmin
      .from("assistant_settings")
      .select("is_enabled")
      .eq("id", "global")
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ isEnabled: Boolean(data?.is_enabled) });
  } catch (err: any) {
    console.error("Error in GET /api/assistant-settings/status:", err);
    res.status(500).json({ error: err.message || "Internal Server Error" });
  }
});

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

    const { decryptApiKey, maskApiKey } = await import("./src/server/assistantCrypto.ts");
    let apiKeyMasked = '';
    if (data.api_key_encrypted) {
      try {
        apiKeyMasked = maskApiKey(decryptApiKey(data.api_key_encrypted));
      } catch (e) {
        console.error("Failed to decrypt assistant API key for masking:", e);
        apiKeyMasked = '••••••••';
      }
    }

    res.json({
      isEnabled: data.is_enabled,
      aiProvider: data.ai_provider,
      modelName: data.model_name,
      apiKeyMasked,
      hasApiKey: Boolean(data.api_key_encrypted),
      systemPrompt: data.system_prompt,
      temperature: data.temperature,
      maxTokens: data.max_tokens,
      dailyMessageLimit: data.daily_message_limit,
      updatedAt: data.updated_at,
      updatedBy: data.updated_by,
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
    const { encryptApiKey } = await import("./src/server/assistantCrypto.ts");

    const updatePayload: any = {
      is_enabled: Boolean(data.isEnabled),
      ai_provider: data.aiProvider === 'gemini' ? 'gemini' : 'openai',
      model_name: String(data.modelName || 'gpt-4o-mini'),
      system_prompt: String(data.systemPrompt || ''),
      temperature: Math.min(1, Math.max(0, Number(data.temperature) || 0)),
      max_tokens: Math.max(1, parseInt(data.maxTokens, 10) || 500),
      daily_message_limit: Math.max(0, parseInt(data.dailyMessageLimit, 10) || 0),
      updated_at: new Date().toISOString(),
      updated_by: req.user?.email || req.user?.uid || null,
    };

    // حقل فارغ = "لم يتغيّر" — لا يُحذف المفتاح الحالي أبداً بالخطأ.
    if (typeof data.apiKey === 'string' && data.apiKey.trim().length > 0) {
      updatePayload.api_key_encrypted = encryptApiKey(data.apiKey.trim());
    }

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
      details: `isEnabled=${updatePayload.is_enabled}, provider=${updatePayload.ai_provider}, model=${updatePayload.model_name}`,
      created_at: new Date().toISOString(),
    }).then(({ error: logErr }: any) => {
      if (logErr) console.warn('[saas_security_logs] insert failed:', logErr.message);
    });

    const { decryptApiKey, maskApiKey } = await import("./src/server/assistantCrypto.ts");
    let apiKeyMasked = '';
    if (updated?.api_key_encrypted) {
      try { apiKeyMasked = maskApiKey(decryptApiKey(updated.api_key_encrypted)); } catch { apiKeyMasked = '••••••••'; }
    }

    res.json({
      isEnabled: updated.is_enabled,
      aiProvider: updated.ai_provider,
      modelName: updated.model_name,
      apiKeyMasked,
      hasApiKey: Boolean(updated.api_key_encrypted),
      systemPrompt: updated.system_prompt,
      temperature: updated.temperature,
      maxTokens: updated.max_tokens,
      dailyMessageLimit: updated.daily_message_limit,
      updatedAt: updated.updated_at,
      updatedBy: updated.updated_by,
    });
  } catch (err: any) {
    console.error("Error in PUT /api/super-admin/assistant-settings:", err);
    res.status(500).json({ error: err.message || "Internal Server Error" });
  }
});

// اختبار حي: يستخدم القيم غير المحفوظة القادمة من الفورم مباشرة، وليس من
// القاعدة، حتى يرى السوبر أدمن أثر تعديلاته فوراً قبل الحفظ. إن لم يُرسل
// حقل apiKey (المستخدم لم يغيّره)، يقع رجوعاً على المفتاح المحفوظ حالياً.
app.post("/api/super-admin/assistant-settings/test", authenticate, authorize(['super_admin']), async (req: any, res) => {
  try {
    const { aiProvider, modelName, apiKey, systemPrompt, temperature, maxTokens, message } = req.body || {};
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: "Missing 'message' to test with" });
    }

    let effectiveApiKey = typeof apiKey === 'string' && apiKey.trim().length > 0 ? apiKey.trim() : '';
    if (!effectiveApiKey) {
      const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");
      const { data } = await supabaseAdmin.from("assistant_settings").select("api_key_encrypted").eq("id", "global").maybeSingle();
      if (data?.api_key_encrypted) {
        const { decryptApiKey } = await import("./src/server/assistantCrypto.ts");
        effectiveApiKey = decryptApiKey(data.api_key_encrypted);
      }
    }
    if (!effectiveApiKey) {
      return res.status(400).json({ error: "No API key configured to test with" });
    }

    const { streamText } = await import('ai');
    const model = await buildAssistantModel(aiProvider === 'gemini' ? 'gemini' : 'openai', String(modelName || 'gpt-4o-mini'), effectiveApiKey);

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
    if (!settings.api_key_encrypted) {
      return res.status(503).json({ error: 'assistant_not_configured', message: 'لم يتم إعداد مساعد سين الذكي بعد.' });
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
    const contextualSystemPrompt = `${settings.system_prompt}${toolsAddendum}\n\nيتحدث معك الآن: ${userName || ''} (${roleLabel}).`;

    const { decryptApiKey } = await import("./src/server/assistantCrypto.ts");
    const apiKey = decryptApiKey(settings.api_key_encrypted);
    const model = await buildAssistantModel(settings.ai_provider, settings.model_name, apiKey);

    const { streamText, stepCountIs } = await import('ai');
    const { buildAssistantTools } = await import('./src/server/assistantTools.ts');
    const result = streamText({
      model,
      system: contextualSystemPrompt,
      messages: messages.map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') })),
      temperature: settings.temperature,
      maxOutputTokens: settings.max_tokens,
      tools: await buildAssistantTools({
        tenantId,
        userId: req.user?.uid,
        userRole: req.user?.role,
      }),
      stopWhen: stepCountIs(5),
    });

    await streamAssistantReply(result, res);
  } catch (err: any) {
    console.error("Error in POST /api/chat:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'حدث خطأ أثناء التواصل مع المساعد، حاول مرة أخرى.' });
    }
  }
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
