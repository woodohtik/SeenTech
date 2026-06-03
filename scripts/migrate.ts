import { createClient } from '@supabase/supabase-js';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

// Helper to deterministically convert Firebase ID strings to valid UUIDs
function toUUID(str: string | undefined): string;
function toUUID(str: null): null;
function toUUID(str: string | null | undefined): string | null {
  if (!str) return null;
  // If it's already a uuid, just return it
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str)) { return str; }
  const hash = crypto.createHash('md5').update(str).digest('hex');
  return `${hash.substr(0, 8)}-${hash.substr(8, 4)}-4${hash.substr(13, 3)}-a${hash.substr(17, 3)}-${hash.substr(20, 12)}`;
}

// Load environment variables
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath, override: true });
} else {
  dotenv.config({ override: true });
}

console.log('--- Starting Migration from Firebase to Supabase ---');

// 1. Initialize Firebase Admin
if (!admin.apps.length) {
  try {
    if (fs.existsSync(path.resolve(process.cwd(), 'firebase.json'))) {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = path.resolve(process.cwd(), 'firebase.json');
      admin.initializeApp({
        databaseURL: `https://ai-studio-applet-webapp-70fe5.firebaseio.com`
      });
      console.log('Firebase Admin initialized with firebase.json GOOGLE_APPLICATION_CREDENTIALS.');
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT && process.env.FIREBASE_SERVICE_ACCOUNT.startsWith('{')) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`
      });
      console.log('Firebase Admin initialized with Service Account from env.');
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.GOOGLE_APPLICATION_CREDENTIALS.includes('path/to/')) {
      admin.initializeApp();
      console.log('Firebase Admin initialized with GOOGLE_APPLICATION_CREDENTIALS.');
    } else if (process.env.VITE_FIREBASE_PROJECT_ID) {
      admin.initializeApp({ projectId: process.env.VITE_FIREBASE_PROJECT_ID });
      console.log('Firebase Admin initialized with Project ID only (limited).');
    } else {
      throw new Error('NO VALID FIREBASE CREDENTIALS FOUND. Please set FIREBASE_SERVICE_ACCOUNT JSON string.');
    }
  } catch (error) {
    console.error('Failed to initialize Firebase Admin:', error);
    process.exit(1);
  }
}
const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf-8')) : {};
const db = getFirestore(admin.app(), config.firestoreDatabaseId || '(default)');

// 2. Initialize Supabase Admin Client
let supabaseUrl = process.env.VITE_SUPABASE_URL;
if (supabaseUrl && supabaseUrl.includes('/rest/v1')) {
  supabaseUrl = supabaseUrl.replace('/rest/v1/', '').replace('/rest/v1', '');
}
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY / VITE_SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  }
});
console.log('Supabase client initialized.');

// Helper to batch insert
async function batchInsert(tableName: string, data: any[]) {
  if (data.length === 0) return;
  const chunkSize = 100;
  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, i + chunkSize);
    const { error } = await supabase.from(tableName).upsert(chunk, { ignoreDuplicates: true });
    if (error) {
      console.error(`Error inserting into ${tableName} at batch ${i}:`, error.message);
    } else {
      console.log(`Inserted ${chunk.length} records into ${tableName}.`);
    }
  }
}

// Map Firestore doc to proper format
const mapTimestamps = (data: any) => {
  const result: any = { ...data };
  for (const key in result) {
    if (result[key] && typeof result[key] === 'object' && 'toDate' in result[key]) {
      result[key] = result[key].toDate().toISOString(); // Convert Firestore timestamps
    } else if (key === 'createdAt' || key === 'updatedAt' || key.toLowerCase().endsWith('date') || key.toLowerCase().endsWith('at')) {
      if (typeof result[key] === 'string' || typeof result[key] === 'number') {
         try {
             result[key] = new Date(result[key]).toISOString();
         } catch(e) {}
      }
    }
  }
  return result;
};

// Main migration runner
async function runMigration() {
  try {
    console.log('\n--> Migrating Users to Supabase Auth...');
    const fbUsers = await admin.auth().listUsers(1000);
    const userIdMap = new Map<string, string>(); // fb uid -> supabase uuid

    for (const u of fbUsers.users) {
      if (!u.email) continue;
      
      let supUid: string;
      // check if user with this email already exists
      const { data: usersData, error: usersError } = await supabase.auth.admin.listUsers();
      let existing = null;
      if (!usersError && usersData && usersData.users) {
          existing = usersData.users.find((supU: any) => supU.email === u.email);
      }

      if (existing) {
          supUid = existing.id;
          console.log(`User ${u.email} already in Supabase Auth as ${supUid}`);
      } else {
          try {
              const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
                  email: u.email,
                  email_confirm: true,
                  password: 'TempPassword123!',
                  user_metadata: {
                     name: u.displayName || ''
                  }
              });
              if (createError || !newUser.user) {
                  console.error(`Error creating user ${u.email}:`, createError?.message);
                  continue;
              }
              supUid = newUser.user.id;
              console.log(`Created user ${u.email} in Supabase Auth: ${supUid}`);
          } catch(e: any) {
              console.error(`Failed to create user ${u.email}:`, e.message);
              continue;
          }
      }
      userIdMap.set(u.uid, supUid);
      userIdMap.set(u.email, supUid); // map by email too just in case
    }
    console.log(`Prepared user mapping for ${userIdMap.size} identifiers.`);

    // Migrate Tenants
    console.log('\\n--> Migrating Tenants...');
    const tenantsSnap = await db.collection('tenants').get();
    const tenants = tenantsSnap.docs.map(doc => {
      const data = mapTimestamps(doc.data());
      return {
        id: toUUID(doc.id),
        owner_uid: data.ownerEmail ? (userIdMap.get(data.ownerEmail) || null) : null,
        name: data.name || 'Unknown',
        owner_email: data.ownerEmail,
        phone: data.phone || '',
        status: data.status || 'active',
        plan_id: null,
        inventory_strategy: data.inventoryStrategy || 'centralized',
        default_layout: data.defaultLayout || 'sidebar',
        logo_url: data.logoUrl || null,
        created_at: data.createdAt || new Date().toISOString(),
        updated_at: data.updatedAt || new Date().toISOString(),
        is_test: data.isTest || false
      };
    });
    await batchInsert('tenants', tenants);

    // Migrate Staff
    console.log('\\n--> Migrating Staff...');
    const staffSnap = await db.collection('staff').get();
    const staffs = staffSnap.docs.map(doc => {
      const data = mapTimestamps(doc.data());
      const validRoles = ['admin', 'manager', 'cashier', 'tailor'];
      let role = data.role || 'cashier';
      if (!validRoles.includes(role)) {
        role = role.includes('المدير') || role.includes('admin') ? 'admin' : (role === 'staff' ? 'cashier' : 'cashier');
      }
      return {
        id: toUUID(doc.id),
        tenant_id: toUUID(data.tenantId),
        uid: data.email ? (userIdMap.get(data.email) || null) : null,
        name: data.name || 'Unknown',
        email: data.email || '',
        phone: data.phone || null,
        role: role,
        status: data.status || 'active',
        created_at: data.createdAt || new Date().toISOString()
      };
    });
    await batchInsert('staff', staffs);

    // Migrate Customers
    console.log('\\n--> Migrating Customers...');
    const customersSnap = await db.collection('customers').get();
    const customers = customersSnap.docs.map(doc => {
      const data = mapTimestamps(doc.data());
      return {
        id: toUUID(doc.id),
        tenant_id: toUUID(data.tenantId) || (tenants[0] ? tenants[0].id : null),
        name: data.name || 'Unknown',
        phone: data.phone || '',
        email: data.email || null,
        measurements: data.measurements || {},
        styles: data.styles || {},
        notes: data.notes || null,
        created_at: data.createdAt || new Date().toISOString()
      };
    });
    await batchInsert('customers', customers);

    console.log('\n--> Migrating Inventory Items...');
    const inventorySnap = await db.collection('inventory').get();
    const inventoryItems = inventorySnap.docs.map(doc => {
      const data = mapTimestamps(doc.data());
      return {
        id: toUUID(doc.id),
        tenant_id: toUUID(data.tenantId) || (tenants.length > 0 ? tenants[0].id : null),
        supplier_id: null, // toUUID(data.supplierId) || null, - Avoid supplier FK violation
        name: data.name || 'Unknown',
        description: data.description || null,
        category: data.category || 'other',
        unit: data.unit || 'piece',
        base_unit: data.baseUnit || 'piece',
        conversion_rate: data.conversionRate || 1,
        min_threshold: data.minThreshold || 0,
        price_per_unit: data.pricePerUnit || 0,
        sku: data.sku || doc.id,
        barcode: data.barcode || null,
        quantity: data.quantity || 0,
        images: data.images || [],
        created_at: data.createdAt || new Date().toISOString()
      };
    });
    await batchInsert('inventory_items', inventoryItems);

    const validInventoryIds = new Set(inventoryItems.map(i => i.id));

    console.log('\n--> Migrating Orders...');
    const ordersSnap = await db.collection('orders').get();
    const ordersItemRows: any[] = [];
    const tenantOrdersMap = new Map<string, number>();
    
    const orders = ordersSnap.docs.map(doc => {
      const data = mapTimestamps(doc.data());
      const tId = toUUID(data.tenantId) || (tenants.length > 0 ? tenants[0].id : null);
      
      let oNum = data.orderNumber;
      if (!oNum) {
        let current = tenantOrdersMap.get(tId as string) || 50000;
        current++;
        tenantOrdersMap.set(tId as string, current);
        oNum = current;
      } else {
        // Track the max to avoid collisions if we generate
        const current = tenantOrdersMap.get(tId as string) || 0;
        if (oNum > current) tenantOrdersMap.set(tId as string, oNum);
      }
      
      if (data.items && Array.isArray(data.items)) {
         data.items.forEach((item: any) => {
            const mappedItemId = toUUID(item.itemId);
            ordersItemRows.push({
               id: toUUID(item.id) || toUUID(Math.random().toString(36).substr(2, 9)),
               tenant_id: tId,
               order_id: toUUID(doc.id),
               type: item.type || 'custom',
               item_id: mappedItemId && validInventoryIds.has(mappedItemId) ? mappedItemId : null,
               name: item.name || null,
               quantity: item.quantity || 1,
               price: item.price || 0,
               measurements: item.measurements || {},
               created_at: data.createdAt || new Date().toISOString()
            });
         });
      }

      return {
        id: toUUID(doc.id),
        tenant_id: tId,
        customer_id: toUUID(data.customerId) || null,
        customer_name: data.customerName || 'Unknown',
        order_number: oNum,
        status: data.status || 'measurements_taken',
        payment_method: data.paymentMethod || 'cash',
        total_amount: data.totalAmount || 0,
        paid_amount: data.paidAmount || 0,
        tax_rate: data.taxRate || 0,
        tax_amount: data.taxAmount || 0,
        discount_amount: data.discountAmount || 0,
        order_date: data.orderDate || new Date().toISOString(),
        delivery_date: data.deliveryDate || new Date().toISOString(),
        qr_code: data.qrCode || null,
        notes: data.notes || null,
        is_test: data.isTest || false,
        created_at: data.createdAt || new Date().toISOString()
      };
    });
    
    await batchInsert('orders', orders);
    await batchInsert('order_items', ordersItemRows);

    console.log('\n--> Migrating Invoices...');
    const invoicesSnap = await db.collection('invoices').get();
    const invoices = invoicesSnap.docs.map(doc => {
      const data = mapTimestamps(doc.data());
      return {
        id: toUUID(doc.id),
        tenant_id: toUUID(data.tenantId) || (tenants.length > 0 ? tenants[0].id : null),
        order_id: toUUID(data.orderId) || null,
        invoice_number: data.invoiceNumber || 'INV-0',
        issued_at: data.issuedAt || new Date().toISOString(),
        status: data.status || 'issued',
        customer_id: toUUID(data.customerId) || null,
        customer_name: data.customerName || null,
        subtotal: data.subTotal || 0,
        tax_rate: data.taxRate || 0,
        tax_amount: data.taxAmount || 0,
        discount_amount: data.discountAmount || 0,
        total_amount: data.totalAmount || 0,
        paid_amount: data.paidAmount || data.totalAmount || 0,
        created_at: data.createdAt || new Date().toISOString()
      };
    });
    await batchInsert('tax_invoices', invoices);

    console.log('\\nMigration completed successfully! 🎉');
    process.exit(0);

  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

runMigration();
