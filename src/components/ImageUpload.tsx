import React, { useState, useRef } from 'react';
import { UploadCloud, X, Loader2 } from 'lucide-react';
import { compressImage } from '../lib/imageOptimization';
import { uploadImageToSupabase } from '../lib/supabase/storage';

interface ImageUploadProps {
  tenantId: string;
  onImageUploaded: (url: string) => void;
  onImageRemoved: () => void;
  currentImage?: string;
}

export default function ImageUpload({ tenantId, onImageUploaded, onImageRemoved, currentImage }: ImageUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(currentImage || null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    await processAndUpload(file);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    await processAndUpload(file);
  };

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

  const processAndUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('يرجى رفع ملف صورة صالح');
      return;
    }

    try {
      setIsUploading(true);
      setError(null);
      // Client-side preview
      const localUrl = URL.createObjectURL(file);
      setPreview(localUrl);

      // Compress image
      const compressedFile = await compressImage(file, 800, 0.7);

      let publicUrl = '';

      try {
        const uploadPromise = uploadImageToSupabase(compressedFile, `tenants/${tenantId}`);

        const timeoutPromise = new Promise<string>((_, reject) => {
          setTimeout(() => reject(new Error('TIMEOUT')), 3000);
        });

        publicUrl = await Promise.race([uploadPromise, timeoutPromise]);
      } catch (uploadErr: any) {
        console.warn('Supabase Storage upload timed out or failed, falling back to Base64:', uploadErr);
        publicUrl = await convertToBase64(compressedFile);
      }

      onImageUploaded(publicUrl);
    } catch (err: any) {
      console.error('Error uploading image:', err);
      setError('فشل في رفع الصورة.');
      setPreview(null);
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemove = () => {
    setPreview(null);
    onImageRemoved();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="w-full">
      <label className="block text-sm font-medium text-gray-500 mb-2">صورة المنتج</label>
      
      {preview ? (
        <div className="relative w-32 h-32 rounded-xl border border-gray-200 overflow-hidden shadow-sm group">
          <img src={preview} alt="Preview" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <button
              type="button"
              onClick={handleRemove}
              className="bg-white/20 hover:bg-red-500 text-white rounded-full p-1.5 transition-colors"
            >
              <X size={18} />
            </button>
          </div>
          {isUploading && (
            <div className="absolute inset-0 bg-white/60 backdrop-blur-sm flex items-center justify-center">
              <Loader2 className="animate-spin text-brand" size={24} />
            </div>
          )}
        </div>
      ) : (
        <div 
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className="w-full border-2 border-dashed border-gray-200 rounded-2xl p-6 flex flex-col items-center justify-center text-gray-400 hover:border-brand hover:bg-brand/5 hover:text-brand transition-colors cursor-pointer"
        >
          <UploadCloud size={32} className="mb-2" />
          <span className="text-sm font-bold">اسحب الصورة هنا أو اضغط للاختيار</span>
          <span className="text-xs text-gray-400 mt-1">يتم ضغط الصورة تلقائياً</span>
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileChange} 
            accept="image/*" 
            className="hidden" 
          />
        </div>
      )}
      {error && <p className="text-red-500 text-xs font-bold mt-2">{error}</p>}
    </div>
  );
}
