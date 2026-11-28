import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useDirection } from '../../lib/direction';
import { forgetOrderImageUrls, getOrderImageUrls, isStoredOrderImagePath } from '../../lib/orderImages';

/**
 * An order's photos, wherever they are shown (seen-order-images-upload-task.md,
 * phase 4): stored paths become signed links in one request; older orders'
 * links show as they are. A thumbnail opens the photo full size -- next and
 * previous, Esc or a downward swipe to close.
 */
export function useOrderImageLinks(images: string[] | null | undefined): string[] {
  const list = images || [];
  const [links, setLinks] = useState<Record<string, string>>({});
  const key = list.join('|');
  useEffect(() => {
    const paths = list.filter(isStoredOrderImagePath);
    if (!paths.length) return;
    let alive = true;
    getOrderImageUrls(paths).then((got) => { if (alive) setLinks(got); }).catch(() => undefined);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return list.map((img) => (isStoredOrderImagePath(img) ? links[img] || '' : img)).filter(Boolean);
}

export function OrderImageGallery({ images }: { images: string[] | null | undefined }) {
  const { t, dir } = useDirection();
  const urls = useOrderImageLinks(images);
  const [open, setOpen] = useState<number | null>(null);
  const touchY = useRef<number | null>(null);

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(null); }
      if (e.key === 'ArrowLeft') setOpen((i) => (i === null ? i : (i + (dir === 'rtl' ? 1 : -1) + urls.length) % urls.length));
      if (e.key === 'ArrowRight') setOpen((i) => (i === null ? i : (i + (dir === 'rtl' ? -1 : 1) + urls.length) % urls.length));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, urls.length, dir]);

  if (!urls.length) return null;
  const step = (delta: number) => setOpen((i) => (i === null ? i : (i + delta + urls.length) % urls.length));

  return (
    <>
      <ul className="grid grid-cols-4 main-640:grid-cols-6 gap-2" aria-label={t('orders.illustration_images')}>
        {urls.map((src, i) => (
          <li key={src}>
            <button type="button" onClick={() => setOpen(i)} aria-label={t('orders.images.open')}
              className="block w-full aspect-square rounded-xl overflow-hidden border border-border focus-visible:ring-2 focus-visible:ring-brand">
              <img src={src} alt="" loading="lazy" className="w-full h-full object-cover" referrerPolicy="no-referrer"
                // A link that stopped working on an open screen is asked for again.
                onError={() => { const p = (images || []).filter(isStoredOrderImagePath); if (p.length) forgetOrderImageUrls(p); }} />
            </button>
          </li>
        ))}
      </ul>
      {open !== null && typeof document !== 'undefined' && createPortal(
        <div role="dialog" aria-modal="true" aria-label={t('orders.illustration_images')} dir={dir}
          className="fixed inset-0 z-[200] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setOpen(null)}
          onTouchStart={(e) => { touchY.current = e.touches[0].clientY; }}
          onTouchEnd={(e) => { if (touchY.current !== null && e.changedTouches[0].clientY - touchY.current > 80) setOpen(null); touchY.current = null; }}>
          <img src={urls[open]} alt="" className="max-w-full max-h-full object-contain rounded-lg" referrerPolicy="no-referrer" onClick={(e) => e.stopPropagation()} />
          <button type="button" onClick={() => setOpen(null)} aria-label={t('orders.images.close')}
            className="absolute top-4 end-4 min-w-11 min-h-11 inline-flex items-center justify-center rounded-full bg-white/15 text-white"><X size={22} /></button>
          {urls.length > 1 && (
            <>
              <button type="button" onClick={(e) => { e.stopPropagation(); step(-1); }} aria-label={t('orders.images.prev')}
                className="absolute start-3 top-1/2 -translate-y-1/2 min-w-11 min-h-11 inline-flex items-center justify-center rounded-full bg-white/15 text-white">
                {dir === 'rtl' ? <ChevronRight size={24} /> : <ChevronLeft size={24} />}
              </button>
              <button type="button" onClick={(e) => { e.stopPropagation(); step(1); }} aria-label={t('orders.images.next')}
                className="absolute end-3 top-1/2 -translate-y-1/2 min-w-11 min-h-11 inline-flex items-center justify-center rounded-full bg-white/15 text-white">
                {dir === 'rtl' ? <ChevronLeft size={24} /> : <ChevronRight size={24} />}
              </button>
            </>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
