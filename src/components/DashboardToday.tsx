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
import GuidedFirstOrder from './GuidedFirstOrder';
import ExpansionPrompt from './ExpansionPrompt';

const STAGES = ['measurements_taken','cutting','sewing','embroidery','ironing_packaging','ready','delivered'];
const STAGE_AR: Record<string,string> = {
  measurements_taken:'أخذ المقاسات', cutting:'قص', sewing:'خياطة', embroidery:'تطريز',
  ironing_packaging:'كي وتغليف', ready:'جاهز', delivered:'تم التسليم'
};
const nextStage = (s: string) => STAGES[Math.min(STAGES.indexOf(s) + 1, STAGES.length - 1)];

export default function DashboardToday({ tenantId }: { tenantId: string }) {
  const navigate = useNavigate();
  const { currentStaff } = useStaff();
  const { hasPermission } = usePermissions(currentStaff);
  const [due, setDue] = useState<any[]>([]);
  const [active, setActive] = useState<any[]>([]);
  const [collectedToday, setCollectedToday] = useState(0);
  const [lowStock, setLowStock] = useState(0);
  const [loading, setLoading] = useState(true);

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
    await supabase.from('orders').update({ status: nextStage(o.status) }).eq('id', o.id);
    load();
  }
  const todayStr = new Date().toLocaleDateString('ar-SA', { weekday:'long', day:'numeric', month:'long' });

  return (
    <div dir="rtl" className="w-full max-w-4xl mx-auto p-3 sm:p-5 lg:p-6">
      <GuidedFirstOrder tenantId={tenantId} />
      <ExpansionPrompt tenantId={tenantId} />
      {/* header — يلتف على الجوال */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 sm:mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-content leading-none">اليوم</h1>
          <p className="text-xs sm:text-sm text-content-muted mt-1">{todayStr}</p>
        </div>
        <button onClick={() => navigate('/sales')}
          className="w-full sm:w-auto min-h-[52px] px-6 rounded-2xl text-white font-extrabold text-base sm:text-lg shadow-md active:scale-[0.98] transition-transform"
          style={{ background: '#0BA06B' }}>+ طلب جديد</button>
      </div>

      {/* الكتل — عمود على الجوال، عمودان من sm */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <Section title={`مستحق التسليم (${due.length})`} loading={loading}>
          {due.length === 0 ? <Empty text="ما في تسليمات مستحقة 👍" /> :
            due.map((o:any) => <Row key={o.id} name={o.customer_name} note={STAGE_AR[o.status]||o.status}
              onAction={() => advance(o)} actionLabel="التالي ▸" />)}
        </Section>

        <Section title={`قيد التنفيذ (${active.length})`} loading={loading}>
          {active.length === 0 ? <Empty text="لا طلبات جارية" /> :
            active.slice(0,12).map((o:any) => <Row key={o.id} name={o.customer_name} note={STAGE_AR[o.status]||o.status}
              onAction={() => advance(o)} actionLabel="نقل للمرحلة التالية" />)}
        </Section>

        {hasPermission('dashboard.revenue') && (
          <Section title="تحصيل اليوم">
            <div className="text-3xl font-black text-content">{collectedToday.toLocaleString('en-US')} <span className="text-base text-content-muted">ر.س</span></div>
          </Section>
        )}

        {hasPermission('dashboard.inventory') && lowStock > 0 && (
          <Section title="تنبيه مخزون">
            <button onClick={()=>navigate('/inventory?filter=low_stock')}
              className="w-full min-h-[48px] rounded-xl bg-surface-muted text-content font-bold px-4 text-sm sm:text-base text-right">
              {lowStock} مادة قاربت على النفاد — راجعها
            </button>
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ title, children, loading }: any) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-4 sm:p-5">
      <div className="font-bold text-base sm:text-lg text-content mb-3">{title}</div>
      {loading ? <div className="text-content-muted text-sm py-2">جارٍ التحميل…</div> : children}
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
