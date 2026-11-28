import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, Loader2, RotateCcw, X } from 'lucide-react';
import { useDirection } from '../../lib/direction';
import { cn } from '../../lib/utils';
import { compressForOrder, OrderImageError } from '../../lib/compressImage';
import { deleteOrderImage, getOrderImageUrls, isStoredOrderImagePath, uploadOrderImage } from '../../lib/orderImages';

/**
 * Order photos (seen-order-images-upload-task.md, phase 3): take one with the
 * camera, pick from the gallery, drag them in, or paste -- each is compressed
 * (lib/compressImage) and uploaded to the private bucket (lib/orderImages)
 * straight away; the order keeps the paths. Older orders' links still show.
 */
export const ORDER_IMAGES_MAX = 6;

type Pending = { key: string; file: File; preview: string; status: 'working' | 'error'; message?: string };

export interface OrderImagesFieldProps {
  tenantId: string;
  orderId: string;
  /** Saved images: storage paths, or an older order's links. */
  value: string[];
  onChange: (next: string[]) => void;
  /** A photo is still being compressed or uploaded (the order must wait). */
  onBusyChange?: (busy: boolean) => void;
  /** A path uploaded in this form session (removed again if the form is abandoned). */
  onUploaded?: (path: string) => void;
  /**
   * Editing a saved order: a removed photo stays in storage until the order
   * is saved (the parent deletes it then) -- cancelling must not lose it.
   */
  deferDelete?: boolean;
}

export function OrderImagesField({ tenantId, orderId, value, onChange, onBusyChange, onUploaded, deferDelete }: OrderImagesFieldProps) {
  const { t } = useDirection();
  const [pending, setPending] = useState<Pending[]>([]);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const [notice, setNotice] = useState('');
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const valueRef = useRef(value);
  valueRef.current = value;
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  useEffect(() => { onBusyChange?.(pending.some((p) => p.status === 'working')); }, [pending, onBusyChange]);

  // Signed links for the saved paths (older links show as they are).
  useEffect(() => {
    const paths = value.filter(isStoredOrderImagePath).filter((p) => !links[p]);
    if (!paths.length) return;
    getOrderImageUrls(paths).then((got) => setLinks((prev) => ({ ...prev, ...got }))).catch(() => undefined);
  }, [value, links]);

  const messageFor = (e: unknown) => {
    const code = e instanceof OrderImageError ? e.code : 'upload';
    return t(`orders.images.error_${code}`);
  };

  const run = useCallback(async (item: Pending) => {
    setPending((prev) => prev.map((p) => (p.key === item.key ? { ...p, status: 'working', message: undefined } : p)));
    try {
      const small = await compressForOrder(item.file);
      const path = await uploadOrderImage(small, tenantId, orderId);
      setSizes((prev) => ({ ...prev, [path]: small.size }));
      setLinks((prev) => ({ ...prev, [path]: item.preview }));
      onUploaded?.(path);
      onChange([...valueRef.current, path]);
      setPending((prev) => prev.filter((p) => p.key !== item.key));
    } catch (e) {
      setPending((prev) => prev.map((p) => (p.key === item.key ? { ...p, status: 'error', message: messageFor(e) } : p)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, orderId, onChange, onUploaded]);

  const addFiles = (files: File[]) => {
    setNotice('');
    if (!online) { setNotice(t('orders.images.offline')); return; }
    const images = files.filter((f) => f.type.startsWith('image/') || /\.(hei[cf]|jpe?g|png|webp|gif)$/i.test(f.name));
    const room = ORDER_IMAGES_MAX - valueRef.current.length - pending.length;
    if (images.length > room) setNotice(t('orders.images.too_many', { max: ORDER_IMAGES_MAX }));
    const items = images.slice(0, Math.max(0, room)).map((file) => ({
      key: globalThis.crypto.randomUUID(), file, preview: URL.createObjectURL(file), status: 'working' as const,
    }));
    if (!items.length) return;
    setPending((prev) => [...prev, ...items]);
    items.forEach((item) => void run(item));
  };

  const removeSaved = (path: string) => {
    onChange(valueRef.current.filter((p) => p !== path));
    if (!deferDelete && isStoredOrderImagePath(path)) void deleteOrderImage(path).catch(() => undefined);
  };

  const full = value.length + pending.length >= ORDER_IMAGES_MAX;
  const disabled = !online || full;

  return (
    <div
      className="space-y-3"
      onDragOver={(e) => { e.preventDefault(); }}
      onDrop={(e) => { e.preventDefault(); addFiles(Array.from(e.dataTransfer.files || [])); }}
      onPaste={(e) => {
        const files = Array.from(e.clipboardData?.files || []);
        if (files.length) { e.preventDefault(); addFiles(files); }
      }}
    >
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={disabled} onClick={() => cameraRef.current?.click()}
          className="min-h-11 inline-flex items-center gap-2 px-4 rounded-xl bg-brand text-white font-bold text-sm disabled:opacity-50">
          <Camera size={18} aria-hidden="true" />{t('orders.images.take_photo')}
        </button>
        <button type="button" disabled={disabled} onClick={() => galleryRef.current?.click()}
          className="min-h-11 inline-flex items-center gap-2 px-4 rounded-xl border border-border bg-surface text-content font-bold text-sm disabled:opacity-50">
          <ImagePlus size={18} aria-hidden="true" />{t('orders.images.from_gallery')}
        </button>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true"
          onChange={(e) => { addFiles(Array.from(e.target.files || [])); e.target.value = ''; }} />
        <input ref={galleryRef} type="file" accept="image/*" multiple className="sr-only" tabIndex={-1} aria-hidden="true" data-testid="order-images-input"
          onChange={(e) => { addFiles(Array.from(e.target.files || [])); e.target.value = ''; }} />
      </div>
      <p className="text-sm text-content-muted">
        {!online ? t('orders.images.offline') : t('orders.images.hint', { max: ORDER_IMAGES_MAX })}
      </p>
      {notice && <p role="status" className="text-sm font-bold text-warning">{notice}</p>}

      {(value.length > 0 || pending.length > 0) && (
        <ul className="grid grid-cols-3 main-640:grid-cols-6 gap-2" aria-label={t('orders.illustration_images')}>
          {value.map((img) => {
            const src = isStoredOrderImagePath(img) ? links[img] : img;
            return (
              <li key={img} className="relative">
                <div className="aspect-square rounded-xl border border-border overflow-hidden bg-surface-muted">
                  {src && <img src={src} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />}
                </div>
                {sizes[img] !== undefined && (
                  <span className="block text-sm text-content-muted text-center">{t('orders.images.size_kb', { kb: Math.round(sizes[img] / 1024) })}</span>
                )}
                <button type="button" onClick={() => removeSaved(img)} aria-label={t('orders.images.remove')}
                  className="absolute top-0 end-0 min-w-11 min-h-11 inline-flex items-center justify-center">
                  <span className="bg-danger text-white rounded-full p-1 shadow"><X size={14} aria-hidden="true" /></span>
                </button>
              </li>
            );
          })}
          {pending.map((p) => (
            <li key={p.key} className="relative">
              <div className={cn('aspect-square rounded-xl border overflow-hidden bg-surface-muted', p.status === 'error' ? 'border-danger' : 'border-border')}>
                <img src={p.preview} alt="" className="w-full h-full object-cover opacity-60" />
              </div>
              {p.status === 'working' ? (
                <span role="status" className="absolute inset-0 flex items-center justify-center">
                  <Loader2 size={22} className="animate-spin text-brand" aria-hidden="true" />
                  <span className="sr-only">{t('orders.images.uploading')}</span>
                </span>
              ) : (
                <div className="mt-1 space-y-1">
                  <p className="text-sm font-bold text-danger leading-tight">{p.message}</p>
                  <div className="flex gap-1">
                    <button type="button" onClick={() => void run(p)} className="min-h-11 flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-border text-sm font-bold">
                      <RotateCcw size={14} aria-hidden="true" />{t('orders.images.retry')}
                    </button>
                    <button type="button" aria-label={t('orders.images.remove')} onClick={() => setPending((prev) => prev.filter((x) => x.key !== p.key))}
                      className="min-w-11 min-h-11 inline-flex items-center justify-center rounded-lg border border-border">
                      <X size={14} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
