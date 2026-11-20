import React, { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowUpLeft, Compass, Lock, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '../../lib/utils';
import { localeOf, normalizeLang } from '../../lib/direction';
import { getUnitLabel } from '../../utils/fabricUomConverter';
import { CurrencySymbol } from '../CurrencySymbol';
import { CatalogIcon } from './parts';
import { TOOLS, openRouteFor, type AssistantAccess, type IconKey, type PageKey } from './catalog';
import { rangeScope, relativeDay, type RelativeDay } from './formatters';

// ---- small building blocks -------------------------------------------------

/** 4,850 or 632.61: no trailing ".00", Latin digits like the rest of the app's money. */
function formatAmount(value: unknown): string {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function Money({ amount, className, unitClassName }: { amount: unknown; className?: string; unitClassName?: string }) {
  const { i18n } = useTranslation();
  const isAr = normalizeLang(i18n.language) === 'ar';
  return (
    <span className={cn("inline-flex items-baseline gap-1.5 tabular-nums", className)} dir={isAr ? 'rtl' : 'ltr'}>
      {!isAr && <span className={cn("text-sm font-medium text-content-muted", unitClassName)}>SAR</span>}
      <span>{formatAmount(amount)}</span>
      {isAr && <CurrencySymbol className={cn("h-[0.7em] w-auto shrink-0 self-center text-content-muted", unitClassName)} />}
    </span>
  );
}

function useDayText() {
  const { t } = useTranslation();
  return (day: RelativeDay | null): string => {
    if (!day) return '';
    return 'text' in day ? day.text : t(`ai.day.${day.kind}`);
  };
}

/** One template for every tool's card: header, body, footer. */
function CardFrame({
  icon, title, scope, children, footerText, footerAction, route, onNavigate,
}: {
  icon: IconKey;
  title: string;
  /** The small tag beside the title: the period or the sort order the data covers. */
  scope?: string;
  children: React.ReactNode;
  /** The count on the footer's start side ("12 invoices"). */
  footerText?: string;
  /** Takes the count's place when the list can be expanded. */
  footerAction?: React.ReactNode;
  route?: { path: string; page: PageKey };
  onNavigate: () => void;
}) {
  const { t } = useTranslation();
  const hasFooter = Boolean(footerText || footerAction || route);
  return (
    <section className="border border-border rounded-[12px] overflow-hidden bg-surface text-[15px] leading-[1.65] text-content">
      <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-surface-muted">
        <h4 className="m-0 flex items-center gap-2 font-sans text-[15px] font-semibold min-w-0">
          <CatalogIcon name={icon} size={20} className="shrink-0 text-content-muted" />
          <span className="truncate">{title}</span>
        </h4>
        {scope && (
          <span className="shrink-0 inline-flex items-center h-7 px-2.5 rounded-[6px] bg-surface-muted text-sm font-medium">
            {scope}
          </span>
        )}
      </header>
      {children}
      {hasFooter && (
        <footer className="flex items-center justify-between gap-2 ps-2 pe-2 py-1 border-t border-surface-muted">
          <div className="min-w-0">
            {footerAction ?? (footerText && <span className="ps-2 text-sm text-content-muted">{footerText}</span>)}
          </div>
          {route && (
            <Link
              to={route.path}
              onClick={onNavigate}
              className="shrink-0 inline-flex items-center gap-1 min-h-11 px-2 rounded-[12px] text-[15px] font-semibold text-brand hover:bg-surface-muted"
            >
              <span>{t('ai.open_in', { page: t(`ai.page.${route.page}`) })}</span>
              <ArrowUpLeft size={18} className="ltr:-scale-x-100" aria-hidden="true" />
            </Link>
          )}
        </footer>
      )}
    </section>
  );
}

function Kpi({ label, children, primary }: { label: string; children: React.ReactNode; primary?: boolean }) {
  return (
    <div className="flex flex-col min-w-0">
      <span className="text-sm leading-normal text-content-muted">{label}</span>
      <span className={primary
        ? "font-heading font-bold text-[22px] leading-[1.3] tabular-nums"
        : "font-semibold text-base leading-normal tabular-nums"}>
        {children}
      </span>
    </div>
  );
}

function KpiGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-3 gap-y-4 p-4">{children}</div>;
}

interface RowData {
  key: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  end?: React.ReactNode;
}

function Row({ title, subtitle, end }: Omit<RowData, 'key'>) {
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-surface-muted last:border-b-0">
      <div className="min-w-0 flex flex-col">
        <span className="font-semibold leading-normal truncate">{title}</span>
        {subtitle && <span className="text-sm leading-normal text-content-muted tabular-nums">{subtitle}</span>}
      </div>
      {end && <div className="shrink-0">{end}</div>}
    </li>
  );
}

const VISIBLE_ROWS = 3;

/** The first three rows, with "show the rest" that opens the others in place. */
function useExpandableRows(rows: RowData[]) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const hidden = rows.length - VISIBLE_ROWS;
  const visible = expanded ? rows : rows.slice(0, VISIBLE_ROWS);

  const list = (
    <ul id={listId} className="m-0 p-0 list-none">
      {visible.map(({ key, ...row }) => <Row key={key} {...row} />)}
    </ul>
  );
  const toggle = hidden > 0 ? (
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls={listId}
      onClick={() => setExpanded((v) => !v)}
      className="min-h-11 px-2 rounded-[12px] text-sm font-semibold text-content hover:bg-surface-muted"
    >
      {expanded ? t('ai.show_less') : t('ai.show_rest', { count: hidden })}
    </button>
  ) : undefined;

  return { list, toggle };
}

function ListCard({
  name, rows, scope, countText, access, onNavigate,
}: {
  name: string; rows: RowData[]; scope?: string; countText?: string; access: AssistantAccess; onNavigate: () => void;
}) {
  const { t } = useTranslation();
  const meta = TOOLS[name];
  const { list, toggle } = useExpandableRows(rows);
  return (
    <CardFrame
      icon={meta.icon}
      title={t(meta.titleKey)}
      scope={scope}
      footerText={countText}
      footerAction={toggle}
      route={openRouteFor(name, access)}
      onNavigate={onNavigate}
    >
      {list}
    </CardFrame>
  );
}

function EmptyCard({ name, text, access, onNavigate }: { name: string; text: string; access: AssistantAccess; onNavigate: () => void }) {
  const { t } = useTranslation();
  const meta = TOOLS[name];
  return (
    <CardFrame icon={meta.icon} title={t(meta.titleKey)} route={openRouteFor(name, access)} onNavigate={onNavigate}>
      <p className="m-0 px-4 py-3 text-content-muted">{text}</p>
    </CardFrame>
  );
}

function Chip({ tone, icon, children }: { tone: 'neutral' | 'info' | 'warning' | 'success' | 'danger'; icon?: React.ReactNode; children: React.ReactNode }) {
  const tones = {
    neutral: 'bg-surface-muted text-content',
    info: 'bg-info/10 text-info',
    warning: 'bg-warning/10 text-warning',
    success: 'bg-success/10 text-success',
    danger: 'bg-danger/10 text-danger',
  } as const;
  return (
    <span className={cn("inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-sm font-medium whitespace-nowrap", tones[tone])}>
      {icon}
      {children}
    </span>
  );
}

// The stage's Arabic name comes from the same keys the Orders screen uses
// (STATUS_CONFIG there: common.status_<key>). Importing that file here would
// pull the whole Orders screen into the app shell, so only the keys are shared.
// An activity's own stage key has no entry and is shown as it arrives.
const ORDER_STAGE_TONE: Record<string, 'info' | 'warning' | 'success' | 'neutral' | 'danger'> = {
  measurements_taken: 'info',
  cutting: 'warning',
  sewing: 'info',
  embroidery: 'info',
  ironing_packaging: 'info',
  ready: 'success',
  partial_delivered: 'info',
  delivered: 'neutral',
  cancelled: 'danger',
};

function OrderStageChip({ status }: { status: string }) {
  const { t } = useTranslation();
  return (
    <Chip tone={ORDER_STAGE_TONE[status] ?? 'info'}>
      {t(`common.status_${status}`, { defaultValue: status })}
    </Chip>
  );
}

// ---- the tour and refusal cards ---------------------------------------------

// بطاقة "جولة تعليمية مخصّصة" — تظهر بعد شرح المساعد لأي "كيف أضيف/أنشئ..."
// (guidedTour tool, action="offer") بزر توجيه فعلي للمستخدم، أو كإشعار عابر
// عندما يوافق المستخدم نصياً على عرض سابق (action="start").
function GuidedTourCard({ topic, action, onStartTour }: { topic: string; action: string; onStartTour: (topic: string) => void }) {
  const { t } = useTranslation();
  const [choice, setChoice] = useState<'pending' | 'accepted' | 'dismissed'>('pending');

  if (action === 'start' || choice === 'accepted') {
    return (
      <div role="status" className="border border-border rounded-[12px] px-4 py-3.5 flex items-center gap-3 text-[15px] font-semibold text-content">
        <Compass size={22} className="shrink-0 text-brand" aria-hidden="true" />
        <span>{t('ai.guided_tour_starting')}</span>
      </div>
    );
  }
  if (choice === 'dismissed') return null;

  return (
    <section className="border border-border rounded-[12px] p-4 flex flex-col gap-3 text-[15px] text-content">
      <h4 className="m-0 flex items-center gap-2 font-sans text-[15px] font-semibold">
        <Compass size={22} className="shrink-0 text-brand" aria-hidden="true" />
        <span>{t('ai.tour_question')}</span>
      </h4>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => { setChoice('accepted'); onStartTour(topic); }}
          className="min-h-12 px-5 rounded-[12px] bg-brand text-white text-[15px] font-semibold hover:bg-brand/90"
        >
          {t('ai.guided_tour_yes')}
        </button>
        <button
          type="button"
          onClick={() => setChoice('dismissed')}
          className="min-h-12 px-4 rounded-[12px] text-[15px] font-semibold text-brand hover:bg-surface-muted"
        >
          {t('ai.guided_tour_no')}
        </button>
      </div>
    </section>
  );
}

function DeniedCard({ message }: { message?: string }) {
  const { t } = useTranslation();
  return (
    <div className="border border-border rounded-[12px] px-4 py-3.5 flex gap-3 text-[15px] text-content">
      <Lock size={22} className="shrink-0 mt-1 text-content-muted" aria-hidden="true" />
      <span>{message || t('ai.denied_default')}</span>
    </div>
  );
}

// ---- one card per tool -------------------------------------------------------

export interface ToolResultCardProps {
  name: string;
  result: any;
  access: AssistantAccess;
  /** Called when a link inside the card is followed (the phone sheet closes itself). */
  onNavigate: () => void;
  onStartTour: (topic: string) => void;
}

/**
 * عرض توليدي (Generative UI): كل أداة بيانات تُعرض كبطاقة حسب نوعها بدل نص
 * خام فقط، مبني على toolName + result القادمين من بروتوكول NDJSON في
 * server.ts (streamAssistantReply). كل البطاقات على قالب واحد (CardFrame).
 */
export function ToolResultCard({ name, result, access, onNavigate, onStartTour }: ToolResultCardProps) {
  const { t, i18n } = useTranslation();
  const dayText = useDayText();
  const locale = localeOf(i18n.language);
  if (!result) return null;
  if (result.denied) return <DeniedCard message={result.message} />;
  if (name === 'guidedTour') return <GuidedTourCard topic={result.topic} action={result.action} onStartTour={onStartTour} />;

  const meta = TOOLS[name];
  if (!meta) return null;
  const common = { access, onNavigate };

  const scopeText = (start: unknown, end: unknown): string | undefined => {
    const scope = rangeScope(start, end, locale);
    if (!scope) return undefined;
    if (scope.kind === 'range') return t('ai.day.range', { from: scope.from, to: scope.to });
    // "Today · 19 November"; for a plain date the date alone is enough.
    return scope.day.kind === 'date' ? scope.date : t('ai.day.day_with_date', { day: dayText(scope.day), date: scope.date });
  };

  switch (name) {
    case 'getSalesSummary':
    case 'getRevenueReport':
    case 'getDailyClosingReport': {
      return (
        <CardFrame
          icon={meta.icon}
          title={t(meta.titleKey)}
          scope={scopeText(result.appliedStartDate ?? result.startDate ?? result.date, result.appliedEndDate ?? result.endDate ?? result.date)}
          footerText={typeof result.invoiceCount === 'number' ? t('ai.field.invoice_count', { count: result.invoiceCount }) : undefined}
          route={openRouteFor(name, access)}
          onNavigate={onNavigate}
        >
          <KpiGrid>
            <Kpi primary label={t('ai.field.total_sales')}><Money amount={result.totalSales} /></Kpi>
            <Kpi primary label={t('ai.field.collected')}><Money amount={result.totalRevenueCollected} /></Kpi>
            {result.totalTax !== undefined && <Kpi label={t('ai.field.tax')}><Money amount={result.totalTax} /></Kpi>}
            {result.totalDiscount !== undefined && <Kpi label={t('ai.field.discount')}><Money amount={result.totalDiscount} /></Kpi>}
          </KpiGrid>
        </CardFrame>
      );
    }

    case 'searchInvoices': {
      const invoices: any[] = result.invoices || [];
      if (invoices.length === 0) return <EmptyCard name={name} text={t('ai.card_no_results')} {...common} />;
      const rows: RowData[] = invoices.map((inv, i) => ({
        key: `${inv.order_number}-${i}`,
        title: inv.customer_name,
        subtitle: [t('ai.field.invoice_line', { number: inv.order_number }), dayText(relativeDay(inv.order_date, locale))].filter(Boolean).join(' · '),
        end: <Money amount={inv.total_amount} className="font-semibold" />,
      }));
      return <ListCard name={name} rows={rows} countText={t('ai.field.invoice_count', { count: invoices.length })} {...common} />;
    }

    case 'getTopSellingItems': {
      const items: any[] = result.items || [];
      if (items.length === 0) return <EmptyCard name={name} text={t('ai.card_no_sales_data')} {...common} />;
      const rows: RowData[] = items.map((it, i) => ({
        key: `${it.name}-${i}`,
        title: it.name,
        subtitle: t('ai.field.sold_quantity'),
        end: <span className="font-semibold tabular-nums">{formatAmount(it.total_quantity)}</span>,
      }));
      return <ListCard name={name} rows={rows} countText={t('ai.field.item_count', { count: items.length })} {...common} />;
    }

    case 'getLowStockAlerts': {
      const items: any[] = result.items || [];
      if (items.length === 0) return <EmptyCard name={name} text={t('ai.card_no_low_stock')} {...common} />;
      const rows: RowData[] = items.map((it, i) => {
        const isOut = Number(it.current_quantity) <= 0;
        return {
          key: `${it.name}-${i}`,
          title: it.name,
          subtitle: t('ai.field.stock_now_and_min', { current: formatAmount(it.current_quantity), min: formatAmount(it.min_threshold) }),
          end: (
            <Chip tone={isOut ? 'danger' : 'warning'} icon={<TrendingDown size={16} aria-hidden="true" />}>
              {t(isOut ? 'ai.field.out_of_stock' : 'ai.field.low')}
            </Chip>
          ),
        };
      });
      return <ListCard name={name} rows={rows} countText={t('ai.field.item_count', { count: items.length })} {...common} />;
    }

    case 'getInventoryStatus': {
      const items: any[] = result.items || [];
      if (!result.found || items.length === 0) return <EmptyCard name={name} text={t('ai.card_item_not_found')} {...common} />;
      const rows: RowData[] = items.map((it, i) => {
        const unit = getUnitLabel(it.unit, i18n.language) || it.unit || '';
        return {
          key: `${it.sku || it.name}-${i}`,
          title: it.name,
          subtitle: `${formatAmount(it.currentQuantity)} ${unit}`.trim(),
          end: <Money amount={it.pricePerUnit} className="font-semibold" />,
        };
      });
      return <ListCard name={name} rows={rows} countText={t('ai.field.item_count', { count: items.length })} {...common} />;
    }

    case 'getCustomerHistory': {
      const customers: any[] = result.customers || [];
      if (!result.found || customers.length === 0) return <EmptyCard name={name} text={t('ai.card_customer_not_found')} {...common} />;
      const rows: RowData[] = customers.flatMap((c, ci) => {
        const orders: any[] = c.orders || [];
        if (orders.length === 0) {
          return [{ key: `c${ci}`, title: c.name, subtitle: [c.phone, t('ai.field.no_orders_yet')].filter(Boolean).join(' · ') }];
        }
        return orders.map((o, oi) => ({
          key: `c${ci}-o${oi}`,
          title: c.name,
          subtitle: [t('ai.field.order_line', { number: o.order_number }), dayText(relativeDay(o.order_date, locale))].filter(Boolean).join(' · '),
          end: <Money amount={o.total_amount} className="font-semibold" />,
        }));
      });
      return <ListCard name={name} rows={rows} countText={t('ai.field.row_count', { count: rows.length })} {...common} />;
    }

    case 'getPendingOrders': {
      const orders: any[] = result.orders || [];
      if (orders.length === 0) return <EmptyCard name={name} text={t('ai.card_no_pending_orders')} {...common} />;
      const rows: RowData[] = orders.map((o, i) => {
        const remaining = Number(o.remaining_amount) || 0;
        return {
          key: `${o.order_number}-${i}`,
          title: o.customer_name,
          subtitle: (
            <>
              {[t('ai.field.order_line', { number: o.order_number }), dayText(relativeDay(o.delivery_date, locale))].filter(Boolean).join(' · ')}
              {remaining > 0 && <> · {t('ai.field.remaining', { amount: formatAmount(remaining) })}</>}
            </>
          ),
          end: <OrderStageChip status={String(o.status || '')} />,
        };
      });
      return (
        <ListCard
          name={name}
          rows={rows}
          scope={t('ai.field.sorted_by_due')}
          countText={t('ai.field.order_count', { count: orders.length })}
          {...common}
        />
      );
    }

    case 'getSupplierBalance': {
      const suppliers: any[] = result.suppliers || [];
      if (!result.found || suppliers.length === 0) return <EmptyCard name={name} text={t('ai.card_supplier_not_found')} {...common} />;
      const rows: RowData[] = suppliers.map((s, i) => ({
        key: `${s.name}-${i}`,
        title: s.name,
        subtitle: s.pendingPurchaseOrders > 0 ? t('ai.card_pending_pos', { count: s.pendingPurchaseOrders }) : t('ai.field.balance_owed'),
        end: <Money amount={s.balanceOwed} className="font-semibold" />,
      }));
      return <ListCard name={name} rows={rows} {...common} />;
    }

    case 'comparePeriods': {
      if (!result.periodA || !result.periodB) return null;
      const change = Number(result.changeAmount) || 0;
      const direction = change > 0 ? 'up' : change < 0 ? 'down' : 'none';
      const DirectionIcon = direction === 'up' ? TrendingUp : direction === 'down' ? TrendingDown : Minus;
      const percent = result.changePercent === null || result.changePercent === undefined
        ? '' : ` ${Math.abs(Number(result.changePercent))}%`;
      return (
        <CardFrame icon={meta.icon} title={t(meta.titleKey)} route={openRouteFor(name, access)} onNavigate={onNavigate}>
          <KpiGrid>
            <Kpi primary label={scopeText(result.periodA.startDate, result.periodA.endDate) || t('ai.field.period_current')}>
              <Money amount={result.periodA.totalSales} />
            </Kpi>
            <Kpi primary label={scopeText(result.periodB.startDate, result.periodB.endDate) || t('ai.field.period_previous')}>
              <Money amount={result.periodB.totalSales} />
            </Kpi>
          </KpiGrid>
          {/* The direction is a word and an icon, never colour alone. */}
          <div className="flex flex-wrap items-center gap-2 px-4 pb-4">
            <Chip
              tone={direction === 'up' ? 'success' : direction === 'down' ? 'danger' : 'neutral'}
              icon={<DirectionIcon size={16} aria-hidden="true" />}
            >
              {t(`ai.field.change_${direction}`)}{percent}
            </Chip>
            {direction !== 'none' && <Money amount={Math.abs(change)} className="font-semibold" />}
          </div>
        </CardFrame>
      );
    }

    case 'getCustomerStats': {
      return (
        <CardFrame
          icon={meta.icon}
          title={t(meta.titleKey)}
          scope={scopeText(result.appliedStartDate, result.appliedEndDate)}
          route={openRouteFor(name, access)}
          onNavigate={onNavigate}
        >
          <KpiGrid>
            <Kpi primary label={t('ai.field.total_customers')}>{formatAmount(result.totalCustomers)}</Kpi>
            {typeof result.newCustomersInPeriod === 'number' && (
              <Kpi primary label={t('ai.field.new_customers')}>{formatAmount(result.newCustomersInPeriod)}</Kpi>
            )}
          </KpiGrid>
        </CardFrame>
      );
    }

    default:
      return null;
  }
}
