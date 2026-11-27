import React from 'react';
import type { ProductVariant } from '../../types';

/**
 * Up to three variant photos beside a product's name in the stock list
 * (seen-product-variants-barcode-po-price-task.md, phase 2.4), each titled
 * with its variant's name.
 */
export function VariantThumbs({ variants }: { variants?: ProductVariant[] }) {
  const withPhoto = (variants || []).filter((v) => v.imageUrl).slice(0, 3);
  if (withPhoto.length === 0) return null;
  return (
    <span className="inline-flex -space-x-2 rtl:space-x-reverse">
      {withPhoto.map((v) => (
        <img key={v.id} src={v.imageUrl} alt={v.name} title={v.name} loading="lazy"
          className="w-7 h-7 rounded-full object-cover border-2 border-surface" />
      ))}
    </span>
  );
}
