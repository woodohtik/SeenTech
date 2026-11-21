/**
 * seen-permissions-fix-task.md Phase 3: server routes check the permission
 * the settings screen shows, not a fixed list of roles.
 *
 * The decision is the database's own -- public.app_effective_permissions for
 * the employee authenticate() resolved (after a PIN switch, that employee;
 * see actingSession.ts) -- so a route and an RPC can never disagree.
 * The owner and the platform admin pass, as with app_has_permission.
 */
import type { NextFunction, Response } from 'express';
import type { AuthRequest } from './authMiddleware.ts';

export type PermissionMap = Record<string, boolean>;
export type PermissionLoader = (staffId: string) => Promise<PermissionMap>;

/** Loads the employee's map with the service role (the function is closed to the browser). */
export const loadEffectivePermissions: PermissionLoader = async (staffId) => {
  const { supabaseAdmin } = await import('../supabase-admin.ts');
  const { data, error } = await supabaseAdmin.rpc('app_effective_permissions', { p_staff_id: staffId });
  if (error) throw error;
  return (data ?? {}) as PermissionMap;
};

/** Does the request's employee hold `key`? Cached on the request for the routes that ask twice. */
export async function hasPermission(req: AuthRequest, key: string, load: PermissionLoader = loadEffectivePermissions): Promise<boolean> {
  const role = req.user?.role;
  if (role === 'super_admin' || role === 'owner') return true;
  const staffId = req.user?.staffId;
  if (!staffId) return false;
  const cache = req as AuthRequest & { _permissions?: PermissionMap };
  cache._permissions ??= await load(staffId);
  return cache._permissions[key] === true;
}

export function requirePermission(keys: string | string[], opts: { anyOf?: boolean; load?: PermissionLoader } = {}) {
  const list = Array.isArray(keys) ? keys : [keys];
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const results = await Promise.all(list.map((k) => hasPermission(req, k, opts.load)));
      const ok = opts.anyOf ? results.some(Boolean) : results.every(Boolean);
      if (!ok) return res.status(403).json({ error: 'forbidden', permission: list.join(opts.anyOf ? '|' : '+') });
      return next();
    } catch {
      return res.status(500).json({ error: 'permission_check_failed' });
    }
  };
}

type TaxRow = {
  vat_number?: string | null;
  is_tax_enabled?: boolean | null;
  default_tax_rate?: number | string | null;
  tax_settings?: Record<string, unknown> | null;
};

/**
 * What the tax settings amount to, normalised so that saving the profile with
 * the tax fields as they were loaded is not "a tax change" (an empty TRN and
 * a missing one are the same, the JSON keys mirror the columns, the default
 * tax type is "exclusive"). The settings screen sends the whole document on
 * every save; only a real difference needs settings.tax.
 */
export function taxFingerprint(row: TaxRow): string {
  const ts = (row.tax_settings ?? {}) as Record<string, any>;
  const enabled = Boolean(row.is_tax_enabled);
  const vat = String(row.vat_number ?? '').trim();
  const rate = Number(row.default_tax_rate ?? 15);
  return JSON.stringify({
    vat,
    enabled,
    rate,
    tsEnabled: ts.enabled === undefined ? enabled : Boolean(ts.enabled),
    tsTrn: ts.trn === undefined ? vat : String(ts.trn ?? '').trim(),
    tsRate: ts.vatRate === undefined || ts.vatRate === null || ts.vatRate === '' ? rate : Number(ts.vatRate),
    legalName: String(ts.legalName ?? '').trim(),
    tailoringTaxType: ts.tailoringTaxType ?? 'exclusive',
  });
}
