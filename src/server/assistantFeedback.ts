/**
 * Checking a rating sent from the assistant panel before it is stored
 * (seen-ai-assistant-redesign-task.md 2-1). Pure, so it is tested alone.
 */
import { knownPage } from './assistantContext.ts';

/** The tools assistantTools.ts defines; anything else in a rating is dropped. */
export const KNOWN_TOOL_NAMES = new Set([
  'getSalesSummary', 'searchInvoices', 'getInventoryStatus', 'getLowStockAlerts', 'getTopSellingItems',
  'getCustomerHistory', 'getPendingOrders', 'getRevenueReport', 'getDailyClosingReport',
  'getSupplierBalance', 'comparePeriods', 'getCustomerStats', 'guidedTour',
]);

export interface FeedbackInput {
  messageKey: string;
  rating: 1 | -1;
  comment: string | null;
  question: string | null;
  toolNames: string[];
  page: string | null;
}

const clip = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
};

export function parseFeedback(body: any): { ok: true; value: FeedbackInput } | { ok: false; error: string } {
  const messageKey = typeof body?.messageKey === 'string' ? body.messageKey.trim() : '';
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(messageKey)) return { ok: false, error: 'invalid_message_key' };

  const rating = body?.rating === 'up' ? 1 : body?.rating === 'down' ? -1 : null;
  if (rating === null) return { ok: false, error: 'invalid_rating' };

  const toolNames: string[] = Array.isArray(body?.toolNames)
    ? Array.from(new Set<string>((body.toolNames as unknown[]).filter((n): n is string => typeof n === 'string' && KNOWN_TOOL_NAMES.has(n)))).slice(0, 12)
    : [];

  return {
    ok: true,
    value: {
      messageKey,
      rating,
      // A comment only goes with "not useful".
      comment: rating === -1 ? clip(body?.comment, 500) : null,
      question: clip(body?.question, 1000),
      toolNames,
      page: knownPage(body?.page),
    },
  };
}
