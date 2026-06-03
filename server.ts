import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import dotenv from 'dotenv';
import { authenticate, authorize } from "./src/server/middleware/authMiddleware.ts";

dotenv.config();

const app = express();
app.use(express.json());

// API Routes
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
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
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
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
