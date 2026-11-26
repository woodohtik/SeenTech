/**
 * A shop's order photos, removed from the private bucket when the shop is
 * deleted for good or its data is wiped (seen-order-images-upload-task.md,
 * phase 5). Service role: the bucket's own rules keep a browser to its own
 * shop, and the shop is gone by then.
 */
export interface StorageBucketApi {
  list: (prefix: string, options?: { limit?: number; offset?: number }) => Promise<{ data: Array<{ name: string; id: string | null }> | null; error: unknown }>;
  remove: (paths: string[]) => Promise<{ error: unknown }>;
}

const SAFE_FOLDER = /^[0-9a-zA-Z-]{8,64}$/;

async function listAll(api: StorageBucketApi, prefix: string) {
  const out: Array<{ name: string; id: string | null }> = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await api.list(prefix, { limit: 100, offset });
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 100) return out;
  }
}

export async function removeTenantOrderImages(api: StorageBucketApi, tenantId: string): Promise<number> {
  if (!SAFE_FOLDER.test(tenantId)) throw new Error('invalid tenant folder');
  let count = 0;
  for (const folder of await listAll(api, tenantId)) {
    if (folder.id) continue; // a stray file at the shop's level is not an order folder
    const prefix = `${tenantId}/${folder.name}`;
    const files = (await listAll(api, prefix)).filter((f) => f.id).map((f) => `${prefix}/${f.name}`);
    for (let i = 0; i < files.length; i += 100) {
      const { error } = await api.remove(files.slice(i, i + 100));
      if (error) throw error;
    }
    count += files.length;
  }
  return count;
}
