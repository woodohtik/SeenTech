import React from 'react';
import { InventoryItem } from '../../types/supabase';
import { ShoppingBag, Ruler } from 'lucide-react';
import { PriceDisplay } from '../PriceDisplay';

interface ProductsGridProps {
  inventory: InventoryItem[];
  onAddToCart: (item: InventoryItem, qty?: number) => void;
}

export default function ProductsGrid({ inventory, onAddToCart }: ProductsGridProps) {
  
  return (
    <div className="bg-surface rounded-2xl shadow-sm border border-border p-4 flex-1 overflow-y-auto">
      <h2 className="text-lg font-bold text-content flex items-center gap-2 mb-4">
        <ShoppingBag className="text-brand" size={20} />
        الأقمشة والخدمات المجردة
      </h2>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {inventory.length === 0 ? (
           <div className="col-span-full py-12 text-center text-content-muted text-sm">
             لا توجد منتجات مسجلة في المخزون
           </div>
        ) : (
          inventory.map(item => (
            <button
              key={item.id}
              onClick={() => onAddToCart(item)}
              className="flex flex-col items-center p-4 border border-border rounded-2xl hover:border-brand hover:shadow-md transition-all group bg-surface-muted hover:bg-surface"
            >
              <div className="w-16 h-16 bg-surface rounded-full flex items-center justify-center mb-3 shadow-sm group-hover:scale-110 transition-transform border border-border">
                {item.category === 'fabric' ? (
                   <Ruler size={28} className="text-brand/60 group-hover:text-brand" />
                ) : (
                   <ShoppingBag size={28} className="text-content-muted group-hover:text-brand" />
                )}
              </div>
              <span className="font-bold text-content text-center line-clamp-2 md:text-sm text-xs mb-1">
                {item.name}
              </span>
              <div className="flex flex-col items-center w-full mt-auto pt-2 border-t border-border">
                <span className="text-brand font-black"><PriceDisplay amount={Number(item.price_per_unit || 0)} /></span>
                <span className="text-[10px] text-content-muted mt-0.5">المتوفر: {item.quantity} {item.unit}</span>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
