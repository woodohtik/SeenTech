import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import dotenv from 'dotenv';
import { authenticate, authorize } from "./src/server/middleware/authMiddleware.ts";
import { registerPrintRelay } from "./src/server/printRelay.ts";

dotenv.config();

const app = express();
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

app.get("/api/public/invoices/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    // Lazy import to ensure supabaseAdmin is initialized
    const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");
    
    const { data: orderData, error: orderError } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('id', id)
      .maybeSingle();
      
    if (orderError || !orderData) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    
    const { data: tenantData } = await supabaseAdmin
      .from('tenants')
      .select('*')
      .eq('id', orderData.tenant_id)
      .maybeSingle();
      
    const { data: customerData } = await supabaseAdmin
      .from('customers')
      .select('*')
      .eq('id', orderData.customer_id)
      .maybeSingle();

    res.json({
      order: {
        ...orderData,
        orderNumber: orderData.order_number,
        orderDate: orderData.order_date,
        totalAmount: orderData.total_amount,
        paidAmount: orderData.paid_amount,
        vatAmount: orderData.vat_amount,
        paymentMethod: orderData.payment_method,
        tenantId: orderData.tenant_id,
      },
      tenant: tenantData ? {
        ...tenantData,
        storeName: tenantData.store_name,
        storeNameEn: tenantData.store_name_en,
        vatNumber: tenantData.vat_number,
        address: tenantData.address,
        logoUrl: tenantData.logo_url
      } : null,
      customer: customerData || null
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
      return res.status(404).json({ matched: false });
    }

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

    res.json({ pins: (data || []).map((s: any) => ({ id: s.id, pin: s.pin_hash })) });
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

async function setupServer() {
  // Public marketing landing page served at the site root "/" for visitors.
  // The SPA (app) keeps handling /login, /dashboard, /orders, ... as usual.
  if (process.env.NODE_ENV !== "production") {
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
