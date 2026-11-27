import React, { useRef, useState } from 'react';
import { Camera, Loader2, RotateCcw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { compressForVariant, OrderImageError } from '../../lib/compressImage';
import { uploadVariantImage } from '../../lib/variantImages';

/**
 * A variant's photo (seen-product-variants-barcode-po-price-task.md, phase
 * 2): a 56px square beside the variant's name. Tapping it opens the phone's
 * camera or gallery; the photo is made 800px WebP <= 150 KB and uploaded.
 * A failed upload keeps the photo and offers "retry" -- never Base64.
 */
export function VariantImagePicker({ tenantId, value, onChange, label }: {
  tenantId: string;
  value: string;
  onChange: (url: string) => void;
  /** The variant's name, for the button's spoken label. */
  label: string;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [failed, setFailed] = useState<Blob | null>(null);
  const [preview, setPreview] = useState('');

  const upload = async (blob: Blob) => {
    setBusy(true);
    setError('');
    try {
      const url = await uploadVariantImage(blob, tenantId);
      setFailed(null);
      onChange(url);
    } catch {
      setFailed(blob);
      setError(t('orders.images.error_upload'));
    } finally {
      setBusy(false);
    }
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    let blob: Blob;
    try {
      blob = await compressForVariant(file);
    } catch (e) {
      const code = e instanceof OrderImageError ? e.code : 'compress_failed';
      setError(t(`orders.images.error_${code}`));
      return;
    }
    setPreview((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(blob); });
    await upload(blob);
  };

  const shown = value || (failed ? preview : '');
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={() => input.current?.click()} disabled={busy}
        aria-label={t('inventory.variants.photo_for', { name: label })}
        className="relative w-14 h-14 shrink-0 rounded-lg border border-dashed border-border bg-surface-muted overflow-hidden flex items-center justify-center text-content-muted hover:border-brand disabled:opacity-60">
        {shown ? <img src={shown} alt="" className="w-full h-full object-cover" /> : <Camera size={18} aria-hidden="true" />}
        {busy && <span className="absolute inset-0 bg-black/40 flex items-center justify-center"><Loader2 size={18} className="animate-spin text-white" aria-hidden="true" /></span>}
      </button>
      <input ref={input} type="file" accept="image/*" className="hidden"
        onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
      {failed && !busy && (
        <button type="button" onClick={() => void upload(failed)} className="min-h-11 inline-flex items-center gap-1 px-2 text-sm font-bold text-brand">
          <RotateCcw size={14} aria-hidden="true" />{t('orders.images.retry')}
        </button>
      )}
      {value && !busy && (
        <button type="button" onClick={() => onChange('')} aria-label={t('orders.images.remove')}
          className="min-w-11 min-h-11 inline-flex items-center justify-center rounded-lg text-content-muted hover:bg-surface-muted">
          <X size={14} aria-hidden="true" />
        </button>
      )}
      {error && <p role="alert" className="text-sm font-bold text-danger">{error}</p>}
    </div>
  );
}
