/**
 * seen-permissions-fix-task.md Phase 0 / Phase 7: measure who may do what on
 * the server, and compare it with what the UI promises.
 *
 *   npx tsx scripts/permissions/verify-matrix.ts [--out docs/permissions/matrix-before.md] [--check]
 *
 * Runs supabase/staging-checks/permissions_matrix.sql against the linked project
 * (staging) -- one rolled-back transaction, no accounts created -- and writes:
 *   - the measured matrix (--out, default docs/permissions/matrix-after.md);
 *   - docs/permissions/matrix-expected.md: what each role should be able to
 *     do, from src/shared/permissionsMatrix.json (the UI's defaults), the
 *     test's custom role and the test's personal exception.
 * --check exits 1 if any cell differs from the expected one.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import matrix from '../../src/shared/permissionsMatrix.json';

type Outcome = string; // allow | deny | error:...
type Measured = Record<'a' | 'b', Record<string, Record<string, Outcome>>>;

/** Which permission(s) each measured action needs (all of them). */
export const ACTION_RULES: Record<string, { label: string; needs: string[] | 'always' | 'never'; anyOf?: boolean }> = {
  'orders.create': { label: 'إنشاء طلب', needs: ['orders.create'] },
  'orders.edit': { label: 'تعديل طلب', needs: ['orders.edit'] },
  'orders.update_status': { label: 'تغيير حالة طلب', needs: ['orders.update_status'] },
  'order.payment': { label: 'استلام دفعة', needs: ['payments.collect'] },
  'pos.sale': { label: 'بيع POS', needs: ['payments.collect'] },
  'pos.discount': { label: 'بيع POS بخصم', needs: ['payments.collect', 'action.discount'] },
  'pos.sale_attributed_to_actor': { label: 'البيع يُنسب للموظف نفسه', needs: ['payments.collect'] },
  'action.refund': { label: 'مرتجع', needs: ['action.refund'] },
  'orders.delete': { label: 'حذف طلب', needs: ['orders.delete'] },
  'customers.delete': { label: 'حذف عميل', needs: ['customers.delete'] },
  'inventory.delete': { label: 'حذف صنف', needs: ['inventory.delete'] },
  'customers.create': { label: 'إضافة عميل', needs: ['customers.create'] },
  'customers.edit': { label: 'تعديل عميل', needs: ['customers.edit'] },
  'inventory.create': { label: 'إضافة صنف', needs: ['inventory.create'] },
  'inventory.edit': { label: 'تعديل صنف', needs: ['inventory.edit'] },
  'inventory.reconcile': { label: 'اعتماد جرد', needs: ['inventory.reconcile'] },
  'inventory.transfer': { label: 'تحويل مخزون', needs: ['inventory.transfer'] },
  // Closing one's own shift: shifts.manage or payments.collect (20270101000003).
  'shifts.close': { label: 'إغلاق وردية (ورديته)', needs: ['shifts.manage', 'payments.collect'], anyOf: true },
  'read.financial_summary': { label: 'قراءة الملخص المالي', needs: ['dashboard.revenue', 'reports.financial'], anyOf: true },
  'read.dashboard_money': { label: 'مبالغ اللوحة', needs: ['dashboard.revenue', 'reports.financial'], anyOf: true },
  'read.customers_page': { label: 'صفحة العملاء', needs: ['customers.view'] },
  'staff.create': { label: 'إضافة موظف', needs: ['staff.create'] },
  'staff.permissions': { label: 'تعديل صلاحيات', needs: ['staff.permissions'] },
  'suppliers.manage': { label: 'إضافة مورد', needs: ['suppliers.manage'] },
  'supplier.payment': { label: 'سند صرف لمورد', needs: ['suppliers.manage'] },
  'settings.billing': { label: 'طلب اشتراك (الفوترة)', needs: ['settings.billing'] },
  'settings.direct_edit': { label: 'تعديل إعدادات المحل مباشرة', needs: ['settings.edit'] },
  'settings.direct_tax': { label: 'تعديل الرقم الضريبي مباشرة', needs: ['settings.edit', 'settings.tax'] },
  'customers.save_measurements': { label: 'حفظ مقاسات من نموذج الطلب', needs: ['customers.edit', 'orders.create'], anyOf: true },
  'isolation.other_shop_customer_edit': { label: 'تعديل عميل محل آخر', needs: 'never' },
};

// The test's custom role and personal exception (supabase/staging-checks/permissions_matrix.sql).
const CUSTOM_SENIOR_CASHIER = [
  'orders.view', 'orders.create', 'orders.update_status', 'payments.collect', 'action.discount',
  'action.refund', 'shifts.manage', 'customers.view', 'customers.create', 'customers.edit',
];
const CASHIER_OVERRIDE: Record<string, boolean> = { 'action.refund': true, 'action.discount': false };

const ROLES = matrix.roles as Record<string, string[]>;

export function permissionsOf(label: string): Set<string> {
  if (label === 'custom:senior_cashier') return new Set(CUSTOM_SENIOR_CASHIER);
  if (label === 'cashier+override') {
    const s = new Set(ROLES.cashier);
    for (const [k, v] of Object.entries(CASHIER_OVERRIDE)) (v ? s.add(k) : s.delete(k));
    return s;
  }
  return new Set(ROLES[label] ?? []);
}

export function expectedOutcome(label: string, action: string): 'allow' | 'deny' {
  const rule = ACTION_RULES[action];
  if (!rule) throw new Error(`no rule for ${action}`);
  if (rule.needs === 'always') return 'allow';
  if (rule.needs === 'never') return 'deny';
  const perms = permissionsOf(label);
  const ok = rule.anyOf ? rule.needs.some((k) => perms.has(k)) : rule.needs.every((k) => perms.has(k));
  return ok ? 'allow' : 'deny';
}

function runMatrix(): Measured {
  const r = spawnSync('npx', ['supabase', 'db', 'query', '--linked', '--file', 'supabase/staging-checks/permissions_matrix.sql'], {
    encoding: 'utf-8', shell: true, maxBuffer: 64 * 1024 * 1024,
  });
  // The CLI prints the error JSON on one stream and "Initialising..." on the other.
  const out = [r.stdout, r.stderr].find((s) => s && s.includes('MATRIX:'));
  if (!out) throw new Error(`the matrix did not run:\n${r.stdout}\n${r.stderr}`);
  const outer = JSON.parse(out.slice(out.indexOf('{')).trim());
  const msg: string = outer.error.message;
  const inner: string = JSON.parse(msg.slice(msg.indexOf('{'))).message;
  const raw = inner.slice(inner.indexOf('MATRIX:') + 7);
  // The JSON is followed by the error's context lines: cut at the matching brace.
  let depth = 0; let end = 0; let inStr = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === '{') depth++; else if (c === '}' && --depth === 0) { end = i + 1; break; }
  }
  return JSON.parse(raw.slice(0, end));
}

const cell = (o: string) => (o === 'allow' ? '✅' : o === 'deny' ? '⛔' : `⚠️ ${o.replace(/^error:/, '').replace(/\|/g, '/')}`);

function table(title: string, rows: Record<string, Record<string, Outcome>>, staff: string[]): string {
  const actions = Object.keys(ACTION_RULES);
  let md = `### ${title}\n\n| الإجراء | ${staff.join(' | ')} |\n|---|${staff.map(() => '---').join('|')}|\n`;
  for (const a of actions) md += `| ${ACTION_RULES[a].label} \`${a}\` | ${staff.map((s) => cell(rows[s]?.[a] ?? '—')).join(' | ')} |\n`;
  return md + '\n';
}

function main() {
  const args = process.argv.slice(2);
  const outPath = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'docs/permissions/matrix-after.md';
  const measured = runMatrix();
  const staff = Object.keys(measured.a).sort((x, y) => (x === 'owner' ? -1 : y === 'owner' ? 1 : x.localeCompare(y)));
  const today = new Date().toISOString().slice(0, 10);

  const expected: Record<string, Record<string, Outcome>> = {};
  for (const s of staff) {
    expected[s] = {};
    for (const a of Object.keys(ACTION_RULES)) expected[s][a] = expectedOutcome(s, a);
  }

  const diffs: string[] = [];
  for (const mode of ['a', 'b'] as const) {
    for (const s of staff) for (const a of Object.keys(ACTION_RULES)) {
      const got = measured[mode][s]?.[a] ?? '—';
      if (got !== expected[s][a]) diffs.push(`| ${mode} | ${s} | ${ACTION_RULES[a].label} \`${a}\` | ${cell(expected[s][a])} | ${cell(got)} |`);
    }
  }

  const header = (what: string) => `# مصفوفة الصلاحيات — ${what} (${today})\n\n`
    + 'مقيسة على Staging بـ `supabase/staging-checks/permissions_matrix.sql` (معاملة واحدة تُلغى بالكامل، بلا حسابات دخول). '
    + 'الوضع (أ): الموظف بهويته. الوضع (ب): جهاز بحساب المالك والموظف داخل بالـ PIN.\n\n'
    + '✅ سماح · ⛔ منع · ⚠️ خطأ (بنصّه)\n\n';
  const measuredMd = header('النتيجة الفعلية')
    + table('الوضع (أ) — الموظف بهويته', measured.a, staff)
    + table('الوضع (ب) — جهاز المالك + الموظف بالـ PIN', measured.b, staff)
    + `## الفرق عن المتوقع (${diffs.length} خانة)\n\n| الوضع | الموظف | الإجراء | المتوقع | الفعلي |\n|---|---|---|---|---|\n${diffs.join('\n')}\n`;
  const expectedMd = `# مصفوفة الصلاحيات — المتوقع من الواجهة (${today})\n\n`
    + 'من `src/shared/permissionsMatrix.json` (القيم الافتراضية للأدوار)، ودور الاختبار المخصص «كاشير أول»، '
    + 'واستثناء الكاشير الفردي (مرتجع ✅، خصم ⛔). الوضعان (أ) و(ب) متوقعان متطابقين.\n\n'
    + table('المتوقع (لكلا الوضعين)', expected, staff);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, measuredMd);
  fs.writeFileSync('docs/permissions/matrix-expected.md', expectedMd);
  console.log(`wrote ${outPath} and docs/permissions/matrix-expected.md -- ${diffs.length} cells differ from expected`);
  if (args.includes('--check') && diffs.length > 0) process.exit(1);
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/permissions/verify-matrix.ts')) main();
