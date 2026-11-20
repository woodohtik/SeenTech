/**
 * Checks that the browser and the database read every shop's tax settings
 * the same way (team review M-8 / action 17), on the linked Supabase project:
 *   npx tsx scripts/check-tax-rules.ts
 *
 * For each shop: public.tenant_tax_rules (what create_tailoring_order uses)
 * against src/utils/tailoringOrder.ts resolveTailoringTax on the row as the
 * app reads it (tax_settings, or what the fetch layer parses out of
 * legacy_id). Also reports shops whose POS columns (is_tax_enabled /
 * default_tax_rate) say something else. Read only; exits 1 on a difference.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveTailoringTax } from '../src/utils/tailoringOrder';

function query(sql: string): any[] {
  const file = path.join(os.tmpdir(), `tax-check-${process.pid}.sql`);
  fs.writeFileSync(file, sql);
  const out = execFileSync('npx', ['supabase', 'db', 'query', '--linked', '--file', file], { encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 });
  fs.unlinkSync(file);
  return JSON.parse(out.slice(out.indexOf('{'))).rows;
}

const rows = query(`
  SELECT t.id::text AS id, t.vat_number, t.is_tax_enabled, t.default_tax_rate,
         coalesce(t.tax_settings, public.tax_settings_from_legacy(t.legacy_id)) AS tax_settings,
         r.enabled, r.tax_type, r.rate_pct
    FROM public.tenants t, LATERAL public.tenant_tax_rules(t.id) r
   ORDER BY t.created_at;`);

let differ = 0;
let posDiffer = 0;
for (const row of rows) {
  const settings = typeof row.tax_settings === 'string' ? JSON.parse(row.tax_settings) : row.tax_settings;
  const app = resolveTailoringTax({ vat_number: row.vat_number, tax_settings: settings });
  const db = { enabled: row.enabled === true || row.enabled === 'true', vatRatePercentage: Number(row.rate_pct), taxType: row.tax_type };
  const same = app.enabled === db.enabled && app.vatRatePercentage === db.vatRatePercentage && app.taxType === db.taxType;
  const posSame = (row.is_tax_enabled === true || row.is_tax_enabled === 'true') === db.enabled
    && Number(row.default_tax_rate) === db.vatRatePercentage;
  if (!same) differ++;
  if (!posSame) posDiffer++;
  console.log(`${same ? 'SAME' : 'DIFF'} ${posSame ? '     ' : 'POS≠ '} ${row.id}  db=${JSON.stringify(db)}${same ? '' : `  app=${JSON.stringify(app)}`}${posSame ? '' : `  pos=${row.is_tax_enabled}/${row.default_tax_rate}`}`);
}
console.log(`\n${rows.length} shops: ${differ} differ between the app and the database; ${posDiffer} have POS columns that say otherwise.`);
process.exit(differ ? 1 : 0);
