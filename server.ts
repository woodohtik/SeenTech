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

// Example Protected Route: Only accessible by Super Admin
app.get("/api/admin/stats", authenticate, authorize(['super_admin']), (req, res) => {
  res.json({
    message: "Welcome Super Admin",
    stats: { totalTenants: 10, revenue: 50000 }
  });
});

// Example Protected Route: Accessible by Owners and Admins
app.get("/api/tenant/settings", authenticate, authorize(['owner', 'admin']), (req, res) => {
  res.json({
    message: "Tenant Settings",
    tenantId: (req as any).user.tenantId
  });
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
