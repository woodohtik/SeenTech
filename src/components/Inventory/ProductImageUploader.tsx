import React, { useState, useCallback } from 'react';
import { Upload, X, Image as ImageIcon, Loader2 } from 'lucide-react';
import imageCompression from 'browser-image-compression';
import { uploadImageToSupabase } from '../../lib/supabase/storage';
import { cn } from '../../lib/utils';

interface ProductImageUploaderProps {
  tenantId: string;
  onUploadComplete: (url: string) => void;
  initialImageUrl?: string;
  className?: string;
}

export default function ProductImageUploader({
  tenantId,
  onUploadComplete,
  initialImageUrl,
  className
}: ProductImageUploaderProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(initialImageUrl || null);
  const [error, setError] = useState<string | null>(null);

  const convertToBase64 = useCallback((blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve(reader.result as string);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }, []);

  const handleUpload = useCallback(async (file: File) => {
    if (!file) return;

    // Validate type
    if (!file.type.startsWith('image/')) {
      setError('يرجى اختيار ملف صورة صالح');
      return;
    }

    try {
      setIsUploading(true);
      setError(null);
      setProgress(10); // Start progress

      // Instant Preview
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreviewUrl(reader.result as string);
      };
      reader.readAsDataURL(file);

      // Compression options - optimize for fast base64 fallback / storage size
      const options = {
        maxSizeMB: 0.15, // Max 150KB
        maxWidthOrHeight: 800,
        useWebWorker: true,
      };

      const compressedFile = await imageCompression(file, options);
      setProgress(30);

      let publicUrl = '';

      try {
        const uploadPromise = (async () => {
          const url = await uploadImageToSupabase(compressedFile, `products/${tenantId}`);
          setProgress(80);
          return url;
        })();

        const timeoutPromise = new Promise<string>((_, reject) => {
          setTimeout(() => reject(new Error('TIMEOUT')), 3000);
        });

        publicUrl = await Promise.race([uploadPromise, timeoutPromise]);
      } catch (uploadErr: any) {
        console.warn('Supabase Storage upload timed out or failed, falling back to Base64:', uploadErr);
        publicUrl = await convertToBase64(compressedFile);
      }

      onUploadComplete(publicUrl);
      setProgress(100);
      setIsUploading(false);
    } catch (err: any) {
      console.error('Upload error:', err);
      setError(err.message || 'فشل في رفع الصورة');
      setIsUploading(false);
    }
  }, [tenantId, onUploadComplete, convertToBase64]);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleUpload(file);
  };

  const clearImage = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPreviewUrl(null);
    onUploadComplete('');
  };

  return (
    <div className={cn("space-y-2", className)}>
      <label className="block text-sm font-bold text-content mb-1">صورة المنتج</label>
      
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        className={cn(
          "relative group cursor-pointer border-2 border-dashed rounded-2xl transition-all duration-300 flex flex-col items-center justify-center min-h-[160px] p-4 bg-surface-muted",
          previewUrl ? "border-brand/30" : "border-border hover:border-brand/50 hover:bg-brand/5"
        )}
        onClick={() => document.getElementById('image-upload-input')?.click()}
      >
        <input
          id="image-upload-input"
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onFileChange}
          disabled={isUploading}
        />

        {previewUrl ? (
          <div className="relative w-full h-full flex items-center justify-center">
            <img
              src={previewUrl}
              alt="Product Preview"
              className="max-h-[140px] rounded-xl object-contain shadow-sm"
            />
            {!isUploading && (
              <button
                onClick={clearImage}
                className="absolute -top-2 -right-2 p-1.5 bg-red-500 text-white rounded-full shadow-lg hover:scale-110 transition-transform z-10"
              >
                <X size={16} />
              </button>
            )}
            {isUploading && (
              <div className="absolute inset-0 bg-surface/60 backdrop-blur-[2px] rounded-xl flex flex-col items-center justify-center p-4">
                <Loader2 className="w-8 h-8 text-brand animate-spin mb-2" />
                <div className="w-full bg-border rounded-full h-1.5 overflow-hidden">
                  <div 
                    className="bg-brand h-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <span className="text-[10px] font-bold text-brand mt-1">{Math.round(progress)}%</span>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center">
            <div className="w-12 h-12 bg-surface rounded-2xl shadow-sm flex items-center justify-center mx-auto mb-3 text-content-muted">
              {isUploading ? <Loader2 className="animate-spin text-brand" /> : <Upload size={24} />}
            </div>
            <p className="text-sm font-bold text-content">اسحب وأفلت صورة المنتج هنا</p>
            <p className="text-xs text-content-muted mt-1 underline">أو انقر للاختيار من جهازك</p>
          </div>
        )}

        {error && (
          <p className="text-xs text-red-500 font-bold mt-2">{error}</p>
        )}
      </div>

      <p className="text-[10px] text-content-muted flex items-center gap-1">
        <ImageIcon size={10} />
        تنسيقات مدعومة: JPG, PNG. سيتم ضغط الصورة تلقائياً لسرعة التحميل.
      </p>
    </div>
  );
}
