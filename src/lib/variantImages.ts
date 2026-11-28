import { supabase } from './supabase/client';

/**
 * A variant's photo (seen-product-variants-barcode-po-price-task.md, phase
 * 2): the public `uploads` bucket, folder products/<shop>/variants/ (allowed
 * by uploads_scoped_insert). Unlike uploadImageToSupabase there is no Base64
 * fallback: a failed upload is an error the picker offers to retry.
 */
export interface VariantImageDeps {
  upload: (path: string, blob: Blob) => Promise<string>;
}

const defaultDeps: VariantImageDeps = {
  upload: async (path, blob) => {
    const { error } = await supabase.storage.from('uploads').upload(path, blob, {
      cacheControl: '31536000', upsert: false, contentType: blob.type || 'image/webp',
    });
    if (error) throw error;
    const { data } = supabase.storage.from('uploads').getPublicUrl(path);
    if (!data?.publicUrl) throw new Error('no_public_url');
    return data.publicUrl;
  },
};

export async function uploadVariantImage(blob: Blob, tenantId: string, deps: VariantImageDeps = defaultDeps): Promise<string> {
  const ext = blob.type === 'image/jpeg' ? 'jpg' : 'webp';
  return deps.upload(`products/${tenantId}/variants/${crypto.randomUUID()}.${ext}`, blob);
}
