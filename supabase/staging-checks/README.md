# Staging checks

SQL checks that run against the **staging** database (the linked project), each inside one transaction that is always rolled back: nothing stays.

```
npx supabase db query --linked --file supabase/staging-checks/<file>.sql
```

The result is the error message itself:

- `PASS: n checks` on success.
- `FAIL ...` naming what broke.
- `MATRIX:{...}` for `permissions_matrix.sql`, which `scripts/permissions/verify-matrix.ts` reads.

They are not pgTAP tests. Some use staging's real shops and orders, so they live outside `supabase/tests/`. CI's `supabase test db` runs every file in that folder against a fresh local database.

The checks don't create login accounts or passwords (project rule). Employees are `staff` rows named in `request.jwt.claims`, the way PostgREST names the caller.
