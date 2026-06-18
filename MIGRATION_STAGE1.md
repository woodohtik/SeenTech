# Firebase → Supabase Migration — Stage 1 (Storage + Server Role Lookups)

Stage 1 migrates only the low-risk, isolated Firebase usages to Supabase.
**Authentication stays on Firebase Auth** — the auth provider and RLS migration are Stage 2.

## What changed

| Area | Before | After |
|---|---|---|
| Image uploads (`ImageUpload.tsx`, `Inventory/ProductImageUploader.tsx`, `Onboarding.tsx`) | Firebase Storage (`ref`/`uploadBytes`/`getDownloadURL`) | Supabase Storage via `uploadImageToSupabase()` (`src/types/lib/supabase/storage.ts`), bucket `uploads` |
| Server role/tenant lookup (`src/server/middleware/authMiddleware.ts`) | Firestore `saas_users` / `staff` collections via `adminDb` | Supabase tables `saas_users` / `staff` via `supabaseAdmin` (`src/server/supabase-admin.ts`) |
| Server security logging | Firestore `security_logs` collection | Supabase `security_logs` table insert, wrapped in try/catch (graceful no-op if the table doesn't exist) |
| `src/types/lib/firebase.ts` | Exported `auth`, `db` (Firestore), `storage` | Exports `auth` only — Firebase is now auth-only |
| `src/App.tsx` | Imported `db` + `firebase/firestore` symbols (dead code — never called) | Imports removed; all data reads already go through Supabase |
| `src/server/firebase-admin.ts` | Exported `adminAuth` + `adminDb` | Exports `adminAuth` only (`verifyIdToken` stays on Firebase in Stage 1) |

Image-compression logic (`compressImage` / `browser-image-compression`) is unchanged; the **compressed** blob is what gets uploaded. The 3-second timeout + Base64 fallback behavior in the two product-image components is preserved as-is.

## Required setup

### 1. Supabase Storage bucket `uploads` (public read)
Create a bucket named **`uploads`** in the Supabase dashboard (Storage → New bucket) and mark it **Public** so `getPublicUrl()` links resolve. Uploads land under prefixes: `tenants/<tenantId>/…`, `products/<tenantId>/…`, `logos/…`.

You will also need a storage policy allowing inserts into the bucket for app users, e.g. (adjust to your security model — tightened properly in Stage 2 with RLS):

```sql
create policy "allow uploads to uploads bucket"
on storage.objects for insert
with check (bucket_id = 'uploads');
```

### 2. Server env var: `SUPABASE_SERVICE_ROLE_KEY`
The Express server (`src/server/supabase-admin.ts`) needs:

```
VITE_SUPABASE_URL=...            # already present (shared with the frontend)
SUPABASE_SERVICE_ROLE_KEY=...    # SERVER-SIDE ONLY — never prefix with VITE_
```

The service role key bypasses RLS. A `VITE_`-prefixed variable would be bundled into the browser build — do not do that.

### 3. Optional: `security_logs` table
The auth middleware writes audit events to a `security_logs` table. If it doesn't exist, writes are skipped gracefully (logged as a warning). To enable:

```sql
create table if not exists security_logs (
  id bigint generated always as identity primary key,
  type text,
  uid text,
  email text,
  role text,
  required_roles jsonb,
  path text,
  method text,
  reason text,
  created_at timestamptz default now()
);
```

(Note: a `saas_security_logs` table already exists in the schema with a different shape; it was left untouched.)

## Backward compatibility — existing images
Image URLs already stored in the database (pointing at `firebasestorage.googleapis.com`) **keep working** — nothing about how URLs are read/displayed changed. Only **new** uploads go to Supabase Storage. Old Firebase-hosted images can be backfilled later or left until the Firebase project is decommissioned (post-Stage 2).

## What remains for Stage 2
- **Auth provider migration**: replace Firebase Auth (`src/types/lib/firebase.ts`, login screens, `onIdTokenChanged` listeners in `App.tsx`, `contexts/AuthContext.tsx`) with Supabase Auth.
- **Server token verification**: `adminAuth.verifyIdToken` in `src/server/middleware/authMiddleware.ts` still verifies Firebase ID tokens; switch to Supabase JWT verification.
- **RLS**: move from Firebase-JWT-based RLS claims (see `fix-rls.sql` / `setSupabaseAuthToken`) to native Supabase Auth RLS; tighten the `uploads` bucket policies per tenant.
- **Decommission**: remove `firebase` / `firebase-admin` dependencies, Firebase env vars, `firestore.rules`, and optionally migrate old Firebase Storage images.
