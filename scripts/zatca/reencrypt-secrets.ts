/**
 * seen-readiness-fixes-task.md P6 (ZATCA-20): move the stored ZATCA secrets
 * onto the current encryption key version, after a rotation.
 *
 *   npx tsx scripts/zatca/reencrypt-secrets.ts            # report only
 *   npx tsx scripts/zatca/reencrypt-secrets.ts --apply    # write
 *
 * Needs, in the environment: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * the old key (ZATCA_ENCRYPTION_KEY for version 1), the new one
 * (ZATCA_ENCRYPTION_KEY_V<N>) and ZATCA_ENCRYPTION_KEY_VERSION=<N>.
 * Run it against staging first. Each value is decrypted with the key of the
 * version it carries and encrypted again with the current one; a value that
 * does not open is reported and left as it is. Secrets are never printed.
 */
import { supabaseAdmin } from '../../src/server/supabase-admin.ts';
import { currentZatcaKeyVersion, decryptZatcaSecret, reencryptZatcaSecret, zatcaSecretKeyVersion } from '../../src/server/zatcaCrypto.ts';

const TARGETS: Array<{ table: string; key: string[]; columns: string[] }> = [
  { table: 'zatca_credentials', key: ['tenant_id', 'csid_type'], columns: ['private_key_encrypted', 'secret_encrypted'] },
  { table: 'zatca_pending_csr', key: ['tenant_id'], columns: ['private_key_encrypted'] },
];

async function main() {
  const apply = process.argv.includes('--apply');
  const target = currentZatcaKeyVersion();
  console.log(`Current key version: ${target}. ${apply ? 'Writing.' : 'Report only (add --apply to write).'}`);
  let moved = 0, already = 0, failed = 0;

  for (const t of TARGETS) {
    const { data, error } = await supabaseAdmin.from(t.table).select([...t.key, ...t.columns].join(', '));
    if (error) throw new Error(`${t.table}: ${error.message}`);
    for (const row of (data || []) as unknown as Array<Record<string, string | null>>) {
      const update: Record<string, string> = {};
      for (const col of t.columns) {
        const stored = row[col];
        if (!stored) continue;
        try {
          const next = reencryptZatcaSecret(stored);
          if (next === null) { already++; continue; }
          // The new value opens to the same secret, before anything is written.
          if (decryptZatcaSecret(next) !== decryptZatcaSecret(stored)) throw new Error('re-encrypted value does not match');
          update[col] = next;
          moved++;
        } catch (err) {
          failed++;
          console.error(`  ${t.table} ${t.key.map((k) => row[k]).join('/')} ${col}: version ${zatcaSecretKeyVersion(stored)} did not open (${(err as Error).message})`);
        }
      }
      if (apply && Object.keys(update).length > 0) {
        let q = supabaseAdmin.from(t.table).update(update);
        for (const k of t.key) q = q.eq(k, row[k] as string);
        const { error: writeError } = await q;
        if (writeError) throw new Error(`${t.table}: ${writeError.message}`);
      }
    }
  }

  console.log(`${apply ? 'Moved' : 'Would move'}: ${moved}. Already on version ${target}: ${already}. Could not open: ${failed}.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
