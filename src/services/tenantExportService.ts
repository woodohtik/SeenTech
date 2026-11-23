import { supabase } from '../lib/supabase/client';

/**
 * seen-readiness-fixes-task.md P5 (PLATFORM-08): export one shop's records.
 * The server keeps a copy (tenant_data_exports -- it outlives the shop, and
 * the permanent delete requires one), and the browser saves the same JSON.
 */
export async function exportTenantData(tenantId: string, tenantName?: string | null): Promise<void> {
  const { data, error } = await supabase.rpc('export_tenant_data', { p_tenant_id: tenantId });
  if (error) throw error;
  const payload = (data as { data?: unknown } | null)?.data ?? data;
  downloadFile(
    `seen-export-${slug(tenantName) || tenantId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(payload, null, 2),
    'application/json',
  );
}

export function slug(v?: string | null): string {
  return (v || '').trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

/**
 * CSV with every cell quoted and a BOM so Excel reads Arabic. A cell that
 * starts like a formula (= + - @, tab, CR) gets a leading ' -- shop names are
 * typed by shop owners, and this file is opened by the platform admin.
 */
export function toCsv(rows: Array<Record<string, unknown>>, columns: string[]): string {
  const cell = (v: unknown) => {
    const text = String(v ?? '');
    const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return '\uFEFF' + [columns.map(cell).join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\r\n');
}

export function downloadFile(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
