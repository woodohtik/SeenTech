/**
 * DashboardToday — شاشة «اليوم» التشغيلية (بيت الخياط/الكاشير).
 * أفعال لا تحليلات: تسليم اليوم، نقل المراحل، طلب جديد. مبوّبة بالصلاحيات.
 * Responsive: عمود واحد على الجوال → عمودان من sm، أزرار لمس كبيرة (≥48px).
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase/client';
import { useStaff } from '../contexts/StaffContext';
import { usePermissions } from '../hooks/usePermissions';
import ExpansionPrompt from './ExpansionPrompt';
import UsageGuide from './UsageGuide';
import { PriceDisplay } from './PriceDisplay';
import { HelpCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDirection } from '../lib/direction';


const STAGES = ['measurements_taken','cutting','sewing','embroidery','ironing_packaging','ready','delivered'];
const STAGE_AR: Record<string,string> = {
  measurements_taken:'أخذ المقاسات', cutting:'قص', sewing:'خياطة', embroidery:'تطريز',
  ironing_packaging:'كي وتغليف', ready:'جاهز', delivered:'تم التسليم'
};
/** Display-only labels. STAGE_AR above is kept because it feeds the persisted `history.notes` payload. */
const STAGE_LABEL_KEYS: Record<string,string> = {
  measurements_taken:'common.status_measurements_taken', cutting:'dashboard.today.stage_cutting',
  sewing:'common.status_sewing', embroidery:'common.status_embroidery',
  ironing_packaging:'dashboard.today.stage_ironing_packaging', ready:'dashboard.ready',
  delivered:'common.status_delivered'
};
const nextStage = (s: string) => STAGES[Math.min(STAGES.indexOf(s) + 1, STAGES.length - 1)];

export default function DashboardToday({ tenantId }: { tenantId: string }) {
  const { t, dir, locale } = useDirection();
  const navigate = useNavigate();
  const { currentStaff } = useStaff();
  const { hasPermission } = usePermissions(currentStaff);
  const [due, setDue] = useState<any[]>([]);
  const [active, setActive] = useState<any[]>([]);
  const [collectedToday, setCollectedToday] = useState(0);
  const [lowStock, setLowStock] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showUsageGuide, setShowUsageGuide] = useState(() => localStorage.getItem('staff_usage_guide_dismissed') !== 'true');

  async function load() {
    if (!tenantId) return;
    setLoading(true);
    try {
      const today = new Date(); today.setHours(23,59,59,999);
      const { data: orders } = await supabase.from('orders').select('*').eq('tenant_id', tenantId);
      const list = orders || [];
      setDue(list.filter((o:any) => o.delivery_date && new Date(o.delivery_date) <= today && !['delivered','cancelled'].includes(o.status)));
      setActive(list.filter((o:any) => !['delivered','ready','cancelled'].includes(o.status)));
      const d0 = new Date(); d0.setHours(0,0,0,0);
      setCollectedToday(list.filter((o:any)=> o.order_date && new Date(o.order_date) >= d0).reduce((s:number,o:any)=> s + (Number(o.paid_amount)||0), 0));
      if (hasPermission('dashboard.inventory')) {
        const { data: inv } = await supabase.from('inventory_items').select('quantity,min_threshold').eq('tenant_id', tenantId);
        setLowStock((inv||[]).filter((i:any)=> Number(i.quantity) <= Number(i.min_threshold)).length);
      }
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tenantId]);

  async function advance(o: any) {
    const nextStatus = nextStage(o.status);
    const historyEntry = {
      status: nextStatus,
      updatedAt: new Date().toISOString(),
      updatedBy: currentStaff?.name || 'المالك',
      notes: `تحديث الحالة من لوحة اليوم إلى ${STAGE_AR[nextStatus] || nextStatus}`
    };
    
    // We must decode the raw database row before retrieving history/items
    // Since o is fetched from the database, it's already decoded because of the fetch interceptor.
    // However, we must preserve both items and history when calling update to prevent them being erased.
    await supabase.from('orders').update({ 
      status: nextStatus,
      items: o.items || [],
      history: [...(o.history || []), historyEntry]
    }).eq('id', o.id);
    load();
  }
  const todayStr = new Date().toLocaleDateString(locale, { weekday:'long', day:'numeric', month:'long' });

  return (
    <div dir={dir} className="w-full max-w-4xl mx-auto p-3 sm:p-5 lg:p-6">
      {showUsageGuide ? (
        <UsageGuide onSkip={() => {
          localStorage.setItem('staff_usage_guide_dismissed', 'true');
          setShowUsageGuide(false);
        }} />
      ) : (
        <>
          <ExpansionPrompt tenantId={tenantId} />
          {/* header — يلتف على الجوال */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 sm:mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-black text-content leading-none">{t('dashboard.today.title')}</h1>
            {!showUsageGuide && (
              <button 
                onClick={() => {
                  localStorage.setItem('staff_usage_guide_dismissed', 'false');
                  setShowUsageGuide(true);
                }}
                className="text-xs sm:text-sm bg-brand/10 hover:bg-brand/20 text-brand font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors"
              >
                <HelpCircle size={16} />
                {t('common.help')}
              </button>
            )}
          </div>
          <p className="text-xs sm:text-sm text-content-muted mt-1">{todayStr}</p>
        </div>
        <button onClick={() => navigate('/sales')}
          className="w-full sm:w-auto min-h-[52px] px-6 rounded-2xl text-white font-extrabold text-base sm:text-lg shadow-md active:scale-[0.98] transition-transform"
          style={{ background: '#0BA06B' }}>+ {t('orders.new_order')}</button>
      </div>

      {/* الكتل — عمود على الجوال، عمودان من sm */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <Section title={t('dashboard.today.due_for_delivery', { count: due.length })} loading={loading}>
          {due.length === 0 ? <Empty text={t('dashboard.today.no_due_deliveries')} /> :
            due.map((o:any) => <Row key={o.id} name={o.customer_name} note={t(STAGE_LABEL_KEYS[o.status] || o.status)}
              onAction={() => advance(o)} actionLabel={t('dashboard.today.next_stage_short')} />)}
        </Section>

        <Section title={t('dashboard.today.in_progress_count', { count: active.length })} loading={loading}>
          {active.length === 0 ? <Empty text={t('dashboard.today.no_active_orders')} /> :
            active.slice(0,12).map((o:any) => <Row key={o.id} name={o.customer_name} note={t(STAGE_LABEL_KEYS[o.status] || o.status)}
              onAction={() => advance(o)} actionLabel={t('dashboard.today.move_to_next_stage')} />)}
        </Section>

        {hasPermission('dashboard.revenue') && (
          <Section title={t('dashboard.today.collected_today')}>
            <div className="text-3xl font-black text-content">
              <PriceDisplay amount={collectedToday} />
            </div>
          </Section>
        )}

        {hasPermission('dashboard.inventory') && lowStock > 0 && (
          <Section title={t('dashboard.today.stock_alert')}>
            <button onClick={()=>navigate('/inventory?filter=low_stock')}
              className="w-full min-h-[48px] rounded-xl bg-surface-muted text-content font-bold px-4 text-sm sm:text-base text-right">
              {t('dashboard.today.low_stock_warning', { count: lowStock })}
            </button>
          </Section>
        )}
      </div>
        </>
      )}
    </div>
  );
}

function Section({ title, children, loading }: any) {
  const { t } = useTranslation();
  return (
    <div className="bg-surface border border-border rounded-2xl p-4 sm:p-5">
      <div className="font-bold text-base sm:text-lg text-content mb-3">{title}</div>
      {loading ? <div className="text-content-muted text-sm py-2">{t('common.loading')}</div> : children}
    </div>
  );
}
function Row({ name, note, onAction, actionLabel }: any) {
  return (
    <div className="flex items-center gap-2 sm:gap-3 py-2.5 border-b border-border last:border-0">
      <button onClick={onAction}
        className="shrink-0 min-h-[44px] px-3 sm:px-4 rounded-xl text-white font-bold text-xs sm:text-sm active:scale-95 transition-transform"
        style={{ background: '#0E2A42' }}>{actionLabel}</button>
      <span className="text-xs sm:text-sm text-content-muted ms-auto truncate">{note}</span>
      <span className="text-sm sm:text-base font-semibold text-content truncate max-w-[40%]">{name}</span>
    </div>
  );
}
function Empty({ text }: any) { return <div className="text-content-muted text-sm py-2">{text}</div>; }
