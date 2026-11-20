/**
 * How each order stage looks (label key, icon, colours). Moved out of
 * Orders.tsx (seen-performance-first-open-login-task.md Phase 4) so the
 * dashboard can use it without pulling the whole orders page -- and with it
 * the scanner and the PDF generator -- into its own download. Orders.tsx
 * re-exports everything here, so existing imports keep working.
 */
import { User, Scissors, Clock, CheckSquare, Package, CheckCircle2, Truck, X } from 'lucide-react';
import type { OrderStatus } from '../types';
import type { WorkflowStage } from '../types/expansion';

export const STATUS_CONFIG: Record<OrderStatus, { labelKey: string, icon: any, color: string, bgColor: string }> = {
  'measurements_taken': { labelKey: 'common.status_measurements_taken', icon: User, color: 'text-info', bgColor: 'bg-info/10' },
  'cutting': { labelKey: 'common.status_cutting', icon: Scissors, color: 'text-warning', bgColor: 'bg-warning/10' },
  'sewing': { labelKey: 'common.status_sewing', icon: Clock, color: 'text-info', bgColor: 'bg-info/10' },
  'embroidery': { labelKey: 'common.status_embroidery', icon: CheckSquare, color: 'text-brand', bgColor: 'bg-brand/10' },
  'ironing_packaging': { labelKey: 'common.status_ironing_packaging', icon: Package, color: 'text-info', bgColor: 'bg-info/10' },
  'ready': { labelKey: 'common.status_ready', icon: CheckCircle2, color: 'text-success', bgColor: 'bg-success/10' },
  'partial_delivered': { labelKey: 'common.status_partial_delivered', icon: Package, color: 'text-info', bgColor: 'bg-info/10' },
  'delivered': { labelKey: 'common.status_delivered', icon: Truck, color: 'text-content-muted', bgColor: 'bg-surface-muted' },
  'cancelled': { labelKey: 'common.status_cancelled', icon: X, color: 'text-danger', bgColor: 'bg-danger/10' }
};

export type StatusVisual = { labelKey: string; icon: any; color: string; bgColor: string };

const GENERIC_IN_PROGRESS: Omit<StatusVisual, 'labelKey'> = { icon: Clock, color: 'text-info', bgColor: 'bg-info/10' };
const GENERIC_DONE: Omit<StatusVisual, 'labelKey'> = { icon: CheckCircle2, color: 'text-success', bgColor: 'bg-success/10' };
const GENERIC_CANCELLED: Omit<StatusVisual, 'labelKey'> = { icon: X, color: 'text-danger', bgColor: 'bg-danger/10' };

/**
 * بديل آمن لـ STATUS_CONFIG[key] يعمل لأي نشاط. لمستأجري mens_tailoring
 * (وأي مفتاح يطابق enum order_status الأصلي حرفياً) يرجع نفس القيمة الثابتة
 * كما هي تماماً — صفر تغيير سلوكي. لأي stage_key آخر من نشاط آخر، يبني عرضاً
 * عاماً من بيانات vertical_workflow_stages نفسها (لا حاجة لجدول ثابت لكل
 * نشاط). labelKey هنا قد يكون نص عربي حرفي (label_ar) بدل مفتاح ترجمة —
 * تمريره لـ t() آمن: i18next يرجع النص كما هو عند عدم وجود مفتاح مطابق.
 */
export function getOrderStatusDisplay(key: string, workflowStages: WorkflowStage[]): StatusVisual {
  const legacy = STATUS_CONFIG[key as OrderStatus];
  if (legacy) return legacy;

  const stage = workflowStages.find((s) => s.stage_key === key);
  if (!stage) return { labelKey: key, ...GENERIC_IN_PROGRESS };

  if (stage.is_terminal) {
    return { labelKey: stage.label_ar, ...(key === 'cancelled' ? GENERIC_CANCELLED : GENERIC_DONE) };
  }
  return { labelKey: stage.label_ar, ...GENERIC_IN_PROGRESS };
}
