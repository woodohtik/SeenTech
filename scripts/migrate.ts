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

// CLI flags (parsed up-front since Firebase Admin init below depends on
// whether --export was given, and the Firestore data-migration section is
// opt-in -- see the "Stage 2 user migration" comment block further down).
const DRY_RUN = process.argv.includes('--dry-run');
const EXPORT_ARG = process.argv.find(a => a.startsWith('--export='));
const FIREBASE_EXPORT_PATH = EXPORT_ARG ? EXPORT_ARG.slice('--export='.length) : (process.env.FIREBASE_AUTH_EXPORT_PATH || '');
const INCLUDE_FIRESTORE_DATA = process.argv.includes('--include-firestore-data');

// 1. Initialize Firebase Admin.
// Strictly required only when no --export file is given (the fallback path
// calls admin.auth().listUsers()) or when --include-firestore-data is passed.
// When an export file is provided, a failure here is non-fatal -- the whole
// user-migration path can run off the export file alone.
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
    if (FIREBASE_EXPORT_PATH) {
      console.warn('Firebase Admin failed to initialize; continuing since --export/FIREBASE_AUTH_EXPORT_PATH was provided:', error);
    } else {
      console.error('Failed to initialize Firebase Admin:', error);
      process.exit(1);
    }
  }
}
const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf-8')) : {};
// Firestore access is only needed for the legacy, opt-in data-migration
// section below -- constructed lazily so an unreachable/decommissioned
// Firestore project doesn't block the (now primary) auth-migration path.
function getDb() {
  return getFirestore(admin.app(), config.firestoreDatabaseId || '(default)');
}

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

// =============================================================================
// Stage 2 (Firebase Auth -> Supabase Auth) user migration
//
// Usage:
//   tsx scripts/migrate.ts --export=./firebase-users-export.json [--dry-run]
//
// The export file is produced by:
//   firebase auth:export firebase-users-export.json --format=json --project <project-id>
// which prints out the project's scrypt hash parameters (signer key, salt
// separator, rounds, mem cost) needed below. Provide them via
// FIREBASE_SCRYPT_SIGNER_KEY / FIREBASE_SCRYPT_SALT_SEPARATOR /
// FIREBASE_SCRYPT_ROUNDS / FIREBASE_SCRYPT_MEM_COST if the export JSON
// itself doesn't embed a `hash_config` object.
//
// Without --export, this falls back to enumerating via the Admin SDK
// (no password hashes available — every account gets a random temp password
// and is queued in the report file for a manual password-reset email).
//
// Pass --include-firestore-data to also run the legacy one-time Firestore ->
// Supabase data migration further below (tenants/staff/customers/inventory/
// orders/invoices) -- that migration already ran against production; it's
// opt-in here so re-running this script for the auth migration doesn't touch
// it or require Firestore to still be reachable.
// =============================================================================

interface FirebaseExportUser {
  localId: string;
  email?: string;
  displayName?: string;
  passwordHash?: string;
  salt?: string;
}

interface FirebaseScryptConfig {
  memCost: number;
  rounds: number;
  saltSeparator: string; // base64
  signerKey: string;     // base64
}

function loadFirebaseExport(exportPath: string): { users: FirebaseExportUser[]; hashConfig: FirebaseScryptConfig | null } {
  const raw = JSON.parse(fs.readFileSync(exportPath, 'utf-8'));
  const users: FirebaseExportUser[] = raw.users || [];

  const rawConfig = raw.hash_config || raw.passwordHashes || null;
  let hashConfig: FirebaseScryptConfig | null = null;
  if (rawConfig) {
    hashConfig = {
      memCost: Number(rawConfig.mem_cost ?? rawConfig.memCost),
      rounds: Number(rawConfig.rounds),
      saltSeparator: rawConfig.base64_salt_separator ?? rawConfig.saltSeparator,
      signerKey: rawConfig.base64_signer_key ?? rawConfig.signerKey,
    };
  } else if (process.env.FIREBASE_SCRYPT_SIGNER_KEY) {
    hashConfig = {
      memCost: Number(process.env.FIREBASE_SCRYPT_MEM_COST),
      rounds: Number(process.env.FIREBASE_SCRYPT_ROUNDS),
      saltSeparator: process.env.FIREBASE_SCRYPT_SALT_SEPARATOR!,
      signerKey: process.env.FIREBASE_SCRYPT_SIGNER_KEY!,
    };
  }

  return { users, hashConfig };
}

// GoTrue's Firebase-scrypt import format: $fbscrypt$v=1,n=<memCost>,r=<rounds>,p=1,ss=<b64 salt_separator>,sk=<b64 signer_key>$<b64 salt>$<b64 hash>
function buildFirebaseScryptHash(passwordHashB64: string, saltB64: string, cfg: FirebaseScryptConfig): string {
  return `$fbscrypt$v=1,n=${cfg.memCost},r=${cfg.rounds},p=1,ss=${cfg.saltSeparator},sk=${cfg.signerKey}$${saltB64}$${passwordHashB64}`;
}

async function migrateUsersToSupabaseAuth(): Promise<{ userIdMap: Map<string, string>; fbUidToSupabaseUid: Map<string, string> }> {
  const userIdMap = new Map<string, string>(); // fb uid AND email -> supabase uuid (kept for the Firestore sections below)
  const fbUidToSupabaseUid = new Map<string, string>(); // fb uid ONLY -> supabase uuid (used for the RLS uid remap)
  const needsPasswordReset: Array<{ uid: string; email: string; reason: string }> = [];

  let sourceUsers: FirebaseExportUser[];
  let hashConfig: FirebaseScryptConfig | null = null;

  if (FIREBASE_EXPORT_PATH) {
    console.log(`Loading Firebase user export from ${FIREBASE_EXPORT_PATH} ...`);
    const loaded = loadFirebaseExport(FIREBASE_EXPORT_PATH);
    sourceUsers = loaded.users;
    hashConfig = loaded.hashConfig;
    if (!hashConfig) {
      console.warn('No scrypt hash_config found in the export file or FIREBASE_SCRYPT_* env vars -- passwords will NOT be imported; every account will need a password-reset email.');
    }
  } else {
    console.warn('No --export=<path>/FIREBASE_AUTH_EXPORT_PATH provided -- falling back to Admin SDK listUsers() (no password hashes available; every account gets a random temp password and needs a reset).');
    const fbUsers = await admin.auth().listUsers(1000);
    sourceUsers = fbUsers.users.map(u => ({ localId: u.uid, email: u.email, displayName: u.displayName }));
  }

  console.log(`\n--> Migrating ${sourceUsers.length} users to Supabase Auth...`);

  // Fetch existing Supabase Auth users once (not per-user, unlike the prior version of this script).
  const { data: existingUsersData, error: existingUsersError } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (existingUsersError) console.error('Failed to list existing Supabase Auth users:', existingUsersError.message);
  const existingByEmail = new Map((existingUsersData?.users || []).map((u: any) => [u.email?.toLowerCase(), u]));

  for (const u of sourceUsers) {
    if (!u.email) continue;
    const emailLower = u.email.toLowerCase();

    let supUid: string;
    const existing = existingByEmail.get(emailLower);

    if (existing) {
      supUid = existing.id;
      console.log(`User ${u.email} already in Supabase Auth as ${supUid}`);
    } else if (DRY_RUN) {
      const hasHash = !!(hashConfig && u.passwordHash && u.salt);
      console.log(`[dry-run] Would create Supabase Auth user for ${u.email} (password hash import: ${hasHash})`);
      continue;
    } else {
      try {
        const hasHash = !!(hashConfig && u.passwordHash && u.salt);
        const createPayload: any = {
          email: u.email,
          email_confirm: true,
          user_metadata: { name: u.displayName || '' },
        };
        if (hasHash) {
          createPayload.password_hash = buildFirebaseScryptHash(u.passwordHash!, u.salt!, hashConfig!);
        } else {
          // Google-only accounts don't need a password (they'll use
          // signInWithOAuth); non-Google accounts with no exportable hash get
          // a random temp password and are queued for a reset email below.
          createPayload.password = crypto.randomBytes(18).toString('base64url');
        }

        const { data: newUser, error: createError } = await supabase.auth.admin.createUser(createPayload);
        if (createError || !newUser.user) {
          console.error(`Error creating user ${u.email}:`, createError?.message);
          needsPasswordReset.push({ uid: u.localId, email: u.email, reason: createError?.message || 'account creation failed' });
          continue;
        }
        supUid = newUser.user.id;
        if (!hasHash) {
          needsPasswordReset.push({ uid: u.localId, email: u.email, reason: 'no exportable password hash -- temp password set, needs reset email' });
        }
        console.log(`Created user ${u.email} in Supabase Auth: ${supUid}`);
      } catch (e: any) {
        console.error(`Failed to create user ${u.email}:`, e.message);
        needsPasswordReset.push({ uid: u.localId, email: u.email, reason: e.message });
        continue;
      }
    }

    fbUidToSupabaseUid.set(u.localId, supUid);
    userIdMap.set(u.localId, supUid);
    userIdMap.set(u.email, supUid); // map by email too just in case
  }

  if (needsPasswordReset.length > 0) {
    const reportPath = path.resolve(process.cwd(), 'migration-hash-import-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(needsPasswordReset, null, 2));
    console.warn(`\n${needsPasswordReset.length} account(s) need a follow-up password-reset email -- see ${reportPath}`);
  }

  console.log(`Prepared user mapping for ${userIdMap.size} identifiers.`);
  return { userIdMap, fbUidToSupabaseUid };
}

// Re-points every TEXT-uid column (users.id, tenants.owner_uid, staff.uid,
// saas_users.uid, etc.) from the old Firebase uid to the new Supabase Auth
// uuid, via the remap_user_uid() Postgres function (see
// supabase/migrations/20260815_remap_user_uid_function.sql) so the whole
// per-user column set is repointed atomically. Safe to re-run: the function
// is a no-op for any old uid that's already been remapped.
async function remapUserUids(fbUidToSupabaseUid: Map<string, string>): Promise<void> {
  console.log('\n--> Remapping uid columns (users.id, tenants.owner_uid, staff.uid, ...)...');

  let remapped = 0, failed = 0;
  for (const [oldUid, newUid] of fbUidToSupabaseUid.entries()) {
    if (DRY_RUN) {
      console.log(`[dry-run] Would remap uid ${oldUid} -> ${newUid}`);
      remapped++;
      continue;
    }

    const { error } = await supabase.rpc('remap_user_uid', { p_old_uid: oldUid, p_new_uid: newUid });
    if (error) {
      console.error(`Failed to remap uid ${oldUid} -> ${newUid}:`, error.message);
      failed++;
    } else {
      remapped++;
    }
  }

  console.log(`Remap complete: ${remapped} remapped, ${failed} failed.`);
}

// Main migration runner
async function runMigration() {
  try {
    const { userIdMap, fbUidToSupabaseUid } = await migrateUsersToSupabaseAuth();
    await remapUserUids(fbUidToSupabaseUid);

    if (!INCLUDE_FIRESTORE_DATA) {
      console.log('\nSkipping legacy Firestore data migration (pass --include-firestore-data to run it).');
      console.log('\nMigration completed successfully! 🎉');
      process.exit(0);
    }

    if (DRY_RUN) {
      console.warn('\n[dry-run] NOTE: --dry-run only applies to the user/uid migration above -- the legacy Firestore data migration below does NOT check --dry-run and will write data (it is idempotent via upsert/ignoreDuplicates, so re-running it is safe, but it is not a no-op).');
    }

    // Migrate Tenants
    console.log('\\n--> Migrating Tenants...');
    const tenantsSnap = await getDb().collection('tenants').get();
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
    const staffSnap = await getDb().collection('staff').get();
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
    const customersSnap = await getDb().collection('customers').get();
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
    const inventorySnap = await getDb().collection('inventory').get();
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
    const ordersSnap = await getDb().collection('orders').get();
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
    const invoicesSnap = await getDb().collection('invoices').get();
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
