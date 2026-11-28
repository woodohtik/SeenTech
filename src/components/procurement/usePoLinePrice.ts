import { useEffect, useRef, useState } from 'react';
import { decodeInventoryDescription } from '../../utils/b2bHelper';
import { costFromLinePrice, linePriceChanged, linePriceFromCost } from '../../utils/poLinePrice';

/**
 * A purchase line's price (seen-product-variants-barcode-po-price-task.md,
 * phase 4): on picking a product it starts at the product's purchase price
 * (x the roll's metres for fabric by the roll) and follows the roll content
 * until the merchant types a price. A typed price that differs offers to
 * update the product's purchase price when the order is confirmed (ticked by
 * default). Returns keep the price actually paid -- this does nothing there.
 */
export function usePoLinePrice({ item, rate, isPurchase, price, setPrice }: {
  /** The raw product row (description holds its cost), or undefined. */
  item: any;
  /** Base units in one line unit (a roll of 10 m = 10). */
  rate: number;
  isPurchase: boolean;
  price: number;
  setPrice: (n: number) => void;
}) {
  const itemId: string = item?.id || '';
  const costPerBase = item
    ? Number(item.costPrice ?? decodeInventoryDescription(item.description ?? null).costPrice ?? 0) || 0
    : 0;
  const sellingPerBase = Number(item?.price_per_unit ?? item?.pricePerUnit ?? 0) || 0;
  const suggested = linePriceFromCost(costPerBase, rate);

  const [touched, setTouched] = useState(false);
  const [updateCost, setUpdateCost] = useState(true);
  const lastItem = useRef('');

  useEffect(() => {
    if (!isPurchase || !itemId) { lastItem.current = itemId; return; }
    const newItem = lastItem.current !== itemId;
    lastItem.current = itemId;
    if (newItem) { setTouched(false); setUpdateCost(true); setPrice(suggested); return; }
    if (!touched) setPrice(suggested);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, suggested, isPurchase]);

  const newCost = costFromLinePrice(price, rate);
  const changed = isPurchase && !!itemId && touched && price > 0 && rate > 0 && linePriceChanged(suggested, price);
  return {
    costPerBase,
    newCost,
    changed,
    /** The line should carry "update the product's price" to the confirm. */
    updateItemCost: changed && updateCost,
    updateCost,
    setUpdateCost,
    markTouched: () => setTouched(true),
    /** The new purchase price is above the selling price -- a warning only. */
    aboveSellingPrice: changed && sellingPerBase > 0 && newCost > sellingPerBase,
  };
}
