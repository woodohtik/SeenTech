import { supabase } from './supabase/client';

/**
 * Order images (seen-order-images-upload-task.md, phase 1): in the private
 * bucket `order-images` (20270122000000), one folder per shop and order --
 * <tenantId>/<orderId>/<uuid>.webp. The order keeps the PATHS; screens ask
 * for signed links that last an hour. A failed upload is an error the screen
 * shows -- never a Base64 copy in the database.
 */
export const ORDER_IMAGES_BUCKET = 'order-images';
export const ORDER_IMAGE_LINK_SECONDS = 3600;

const bucket = () => supabase.storage.from(ORDER_IMAGES_BUCKET);

/** A stored order image (a path), as opposed to an older link or Base64. */
export function isStoredOrderImagePath(value: string): boolean {
  return !!value && !/^https?:\/\//i.test(value) && !value.startsWith('data:');
}

export async function uploadOrderImage(image: Blob, tenantId: string, orderId: string): Promise<string> {
  const ext = image.type === 'image/jpeg' ? 'jpg' : 'webp';
  const path = `${tenantId}/${orderId}/${globalThis.crypto.randomUUID()}.${ext}`;
  const { error } = await bucket().upload(path, image, {
    contentType: image.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp',
    cacheControl: '31536000',
    upsert: false,
  });
  if (error) throw Object.assign(new Error('order_image_upload_failed'), { cause: error });
  return path;
}

// Signed links, kept a little under their hour.
const cache = new Map<string, { url: string; until: number }>();

export async function getOrderImageUrls(paths: string[]): Promise<Record<string, string>> {
  const now = Date.now();
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const p of paths) {
    const hit = cache.get(p);
    if (hit && hit.until > now) out[p] = hit.url;
    else missing.push(p);
  }
  if (missing.length) {
    const { data, error } = await bucket().createSignedUrls(missing, ORDER_IMAGE_LINK_SECONDS);
    if (error) throw Object.assign(new Error('order_image_links_failed'), { cause: error });
    for (const row of data || []) {
      if (row.path && row.signedUrl) {
        out[row.path] = row.signedUrl;
        cache.set(row.path, { url: row.signedUrl, until: now + (ORDER_IMAGE_LINK_SECONDS - 300) * 1000 });
      }
    }
  }
  return out;
}

/** Forget cached links (a link that stopped working on an open screen). */
export function forgetOrderImageUrls(paths?: string[]): void {
  if (!paths) cache.clear();
  else paths.forEach((p) => cache.delete(p));
}

export async function deleteOrderImage(path: string): Promise<void> {
  const { error } = await bucket().remove([path]);
  if (error) throw Object.assign(new Error('order_image_delete_failed'), { cause: error });
  cache.delete(path);
}

/** An order's whole folder -- when the order is deleted for good. */
export async function deleteOrderImageFolder(tenantId: string, orderId: string): Promise<void> {
  const folder = `${tenantId}/${orderId}`;
  const { data, error } = await bucket().list(folder, { limit: 100 });
  if (error) throw Object.assign(new Error('order_image_list_failed'), { cause: error });
  const paths = (data || []).map((f: { name: string }) => `${folder}/${f.name}`);
  if (paths.length) {
    const { error: rmError } = await bucket().remove(paths);
    if (rmError) throw Object.assign(new Error('order_image_delete_failed'), { cause: rmError });
  }
}
