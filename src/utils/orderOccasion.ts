/**
 * An order's occasion (seen-open-verticals-task.md, wave 1): orders.occasion_date
 * and orders.is_urgent, read in either spelling (a row or a mapped order).
 */
export interface OccasionLike {
  occasion_date?: string | null;
  occasionDate?: string | null;
  is_urgent?: boolean | null;
  isUrgent?: boolean | null;
}

export function occasionOf(o: OccasionLike): { date: string | null; urgent: boolean } {
  const date = (o.occasionDate ?? o.occasion_date ?? null) || null;
  return { date: date ? String(date).slice(0, 10) : null, urgent: !!(o.isUrgent ?? o.is_urgent) };
}

/** "Nearest occasion first": dated orders by date (urgent first on the same day), then the rest in their order. */
export function sortByOccasion<T extends OccasionLike>(orders: readonly T[]): T[] {
  return orders
    .map((order, index) => ({ order, index, ...occasionOf(order) }))
    .sort((a, b) => {
      if (a.date && b.date) {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
        return a.index - b.index;
      }
      if (a.date) return -1;
      if (b.date) return 1;
      return a.index - b.index;
    })
    .map((x) => x.order);
}
