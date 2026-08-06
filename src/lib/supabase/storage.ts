import { supabase } from './client';

const BUCKET = 'uploads';

const convertToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      resolve(reader.result as string);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

/**
 * Uploads an image to the Supabase Storage bucket "uploads" and returns its public URL.
 *
 * NOTE (Stage 1 migration): only NEW uploads go through Supabase Storage.
 * Pre-existing Firebase Storage URLs stored in the database keep working as-is.
 *
 * Requires a public-read bucket named "uploads" to exist in the Supabase project.
 *
 * @param file   The image file or blob to upload (e.g. a compressed blob).
 * @param folder Logical folder prefix inside the bucket (e.g. `tenants/<id>`, `products/<id>`, `logos`).
 * @returns The public URL of the uploaded file or Base64 data URL fallback.
 */
export async function uploadImageToSupabase(file: File | Blob, folder: string): Promise<string> {
  const rawName = file instanceof File && file.name ? file.name : 'image.jpg';
  // Sanitize: Supabase Storage object keys only accept a restricted character set.
  const filename = rawName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${folder}/${crypto.randomUUID()}-${filename}`;

  try {
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || undefined,
    });

    if (error) {
      throw new Error(`Supabase Storage upload failed: ${error.message}`);
    }

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    if (!data?.publicUrl) {
      throw new Error('Supabase Storage upload succeeded but no public URL was returned');
    }

    return data.publicUrl;
  } catch (error: any) {
    console.warn('Supabase Storage upload failed, falling back to Base64:', error);
    try {
      const base64 = await convertToBase64(file);
      return base64;
    } catch (fallbackError) {
      console.error('Base64 fallback conversion failed:', fallbackError);
      throw error;
    }
  }
}
