/**
 * Subscribe — صفحة الاشتراك والباقات (هوية سين، محايدة للبوابة)
 * ------------------------------------------------------------
 * توكنز هوية سين: ink #0E2A42 + أزرق العلامة #61BEED + الأخضر #0BA06B (حصري للـ CTA).
 * - الأساسي: باقة فعّالة (زر أخضر يستدعي onCheckout).
 * - الاحترافية: «قريباً» — مغبّشة (frosted) كتشويق.
 * - السلاسل/المؤسسات: تواصل مع المبيعات.
 *
 * التوصيل: <Route path="/subscribe" element={<Subscribe onCheckout={...} onContactSales={...} />} />
 * onCheckout(planId, amountSar) → POST /api/payments (paymentService، محايد للبوابة).
 */

import { useState } from 'react';

const INK = '#0E2A42', INK2 = '#15395A', BRAND = '#61BEED', BRAND2 = '#5AA2D6';
const CTA = '#0BA06B', CTA_INK = '#0A7E54', TINT = '#EAF6FD', SURFACE = '#F5F7FA';
const GRAY = '#6B7280', TEXT = '#34404D', LINE = '#E5EAF1', WHITE = '#FFFFFF';
const FONT = "'IBM Plex Sans Arabic', system-ui, sans-serif";

interface Props {
  onCheckout?: (planId: string, amountSar: number) => void;
  onContactSales?: () => void;
  logoSrc?: string;
}

const CORE_FEATURES = [
  'نقطة بيع متخصصة (POS)', 'قياسات وأوامر تفصيل', 'فوترة زاتكا معتمدة',
  'إدارة مخزون وخصم تلقائي', 'تقارير ولوحة تحكم', 'دعم فني',
];
const PRO_FEATURES = [
  'كل مزايا الأساسي', 'تقارير الذكاء الاصطناعي', 'فرع إضافي',
  'إشعارات واتساب للعملاء', 'تطبيق بعلامتك', 'أولوية الدعم',
];

export default function Subscribe({ onCheckout, onContactSales, logoSrc = '/Logo.svg' }: Props) {
  const [hover, setHover] = useState(false);

  return (
    <div dir="rtl" style={st.page}>
      <div style={st.bgGlow} aria-hidden />

      <header style={st.head}>
        <div style={st.brand}>
          <svg viewBox="0 0 120 90" width="40" height="30" fill="none" aria-hidden="true">
            <defs><linearGradient id="seenSwoosh" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stopColor="#5AA2D6" /><stop offset="0.55" stopColor="#61BEED" /><stop offset="1" stopColor="#63C0EF" />
            </linearGradient></defs>
            <path d="M6 70 C 30 56, 78 36, 112 10 C 96 30, 60 58, 30 70 C 22 73, 12 74, 6 70 Z" fill="url(#seenSwoosh)" />
            <path d="M104 8 L116 6 L110 22 Z" fill="#5AA2D6" />
            <circle cx="34" cy="64" r="1.6" fill="#fff" opacity="0.7" /><circle cx="50" cy="56" r="1.6" fill="#fff" opacity="0.7" /><circle cx="66" cy="47" r="1.6" fill="#fff" opacity="0.6" />
            <path d="M34 64 H50 M50 56 H66" stroke="#fff" strokeWidth="1" opacity="0.5" />
          </svg>
          <span style={st.brandText}>سين<span style={st.brandPos}>POS</span></span>
        </div>
        <h1 style={st.title}>اختر باقتك وابدأ بوضوح</h1>
        <p style={st.sub}>باقات سنوية، بدون رسوم خفية — وتقدر تترقّى في أي وقت.</p>
      </header>

      <div style={st.grid}>
        {/* الأساسي — فعّالة */}
        <section style={{ ...st.card, ...st.cardCore }}>
          <div style={st.ribbon}>عرض الإطلاق</div>
          <h2 style={st.planName}>سين الأساسي</h2>
          <p style={st.planDesc}>كل ما يحتاجه محلك ليشتغل رقمياً من اليوم الأول.</p>
          <div style={st.priceRow}>
            <span style={st.strike}>1,800</span>
            <span style={st.price}>1,000</span>
            <span style={st.cur}>﷼ / سنة</span>
          </div>
          <ul style={st.feats}>
            {CORE_FEATURES.map((f) => (
              <li key={f} style={st.feat}><Check /> <span>{f}</span></li>
            ))}
          </ul>
          <button
            onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
            onClick={() => onCheckout?.('core', 1000)}
            style={{ ...st.cta, ...(hover ? st.ctaHover : {}) }}>
            اشترك الآن
          </button>
          <p style={st.guarantee}>ضمان استرجاع خلال 14 يوم</p>
        </section>

        {/* الاحترافية — قريباً (مغبّشة) */}
        <section style={{ ...st.card, ...st.cardPro }}>
          <div style={st.proInner} aria-hidden>
            <h2 style={st.planName}>سين الاحترافية</h2>
            <p style={st.planDesc}>قوة إضافية للمحلات اللي تكبر بسرعة.</p>
            <div style={st.priceRow}><span style={st.price}>2,400</span><span style={st.cur}>﷼ / سنة</span></div>
            <ul style={st.feats}>
              {PRO_FEATURES.map((f) => (<li key={f} style={st.feat}><Check /> <span>{f}</span></li>))}
            </ul>
          </div>
          <div style={st.frost}>
            <span style={st.soon}>قريباً</span>
            <span style={st.soonSub}>الباقة الاحترافية جايّة لكم قريباً</span>
          </div>
        </section>

        {/* السلاسل — مبيعات */}
        <section style={{ ...st.card, ...st.cardEnt }}>
          <h2 style={st.planName}>السلاسل والمؤسسات</h2>
          <p style={st.planDesc}>فروع متعددة، صلاحيات متقدّمة، وتسعير حسب حجمك.</p>
          <ul style={st.feats}>
            {['فروع متعددة وإدارة مركزية', 'صلاحيات وأدوار متقدّمة', 'تطبيق بعلامتك (White-Label)', 'مدير حساب مخصّص']
              .map((f) => (<li key={f} style={st.feat}><Check /> <span>{f}</span></li>))}
          </ul>
          <button onClick={onContactSales} style={st.ghost}>تواصل مع المبيعات</button>
        </section>
      </div>

      <p style={st.foot}>الدفع آمن ومشفّر · بالاشتراك أنت توافق على شروط الخدمة</p>
    </div>
  );
}

function Check() {
  return (
    <span style={{
      width: 20, height: 20, borderRadius: 999, background: TINT, color: CTA_INK,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 12, fontWeight: 800, flexShrink: 0,
    }} aria-hidden>✓</span>
  );
}

const st: Record<string, React.CSSProperties> = {
  page: { position: 'relative', minHeight: '100vh', background: SURFACE, color: TEXT, fontFamily: FONT, padding: '52px 16px 40px', overflow: 'hidden' },
  bgGlow: { position: 'absolute', top: -200, insetInlineStart: '50%', transform: 'translateX(50%)', width: 700, height: 420, background: 'radial-gradient(circle, ' + TINT + ' 0%, transparent 70%)', opacity: 0.9, pointerEvents: 'none' },
  head: { position: 'relative', textAlign: 'center', marginBottom: 38 },
  brand: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 16 },
  brandText: { fontSize: 28, fontWeight: 800, color: INK,  },
  brandPos: { fontSize: 13, fontWeight: 700, color: BRAND, marginInlineStart: 5, verticalAlign: 'middle' },
  title: { fontSize: 30, fontWeight: 800, color: INK, margin: '0 0 8px',  },
  sub: { color: GRAY, fontSize: 15.5, margin: 0 },
  grid: { position: 'relative', display: 'flex', flexWrap: 'wrap', gap: 20, justifyContent: 'center', maxWidth: 1100, margin: '0 auto', alignItems: 'stretch' },
  card: { flex: '1 1 300px', maxWidth: 340, background: WHITE, borderRadius: 20, border: '1px solid ' + LINE, padding: '30px 26px', position: 'relative', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 30px rgba(14,42,66,.08)' },
  cardCore: { border: '2px solid ' + BRAND, boxShadow: '0 20px 50px rgba(97,190,237,.22)' },
  cardPro: { overflow: 'hidden', padding: 0 },
  cardEnt: { background: '#FBFDFF' },
  proInner: { padding: '30px 26px', filter: 'blur(5px)', userSelect: 'none', opacity: 0.85 },
  frost: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'rgba(245,247,250,0.55)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)' },
  soon: { background: INK, color: WHITE, fontWeight: 800, fontSize: 18, padding: '8px 26px', borderRadius: 999, boxShadow: '0 10px 24px rgba(14,42,66,.25)' },
  soonSub: { color: INK2, fontSize: 13.5, fontWeight: 600 },
  ribbon: { position: 'absolute', top: -13, insetInlineStart: 26, background: CTA, color: WHITE, fontSize: 12.5, fontWeight: 800, padding: '4px 14px', borderRadius: 999, boxShadow: '0 8px 18px rgba(11,160,107,.3)' },
  planName: { fontSize: 21, fontWeight: 800, color: INK, margin: '0 0 6px' },
  planDesc: { color: GRAY, fontSize: 13.5, margin: '0 0 16px', lineHeight: 1.6, minHeight: 38 },
  priceRow: { display: 'flex', alignItems: 'baseline', gap: 7, flexWrap: 'wrap', marginBottom: 4 },
  strike: { textDecoration: 'line-through', color: '#A9B2BE', fontSize: 19, fontWeight: 600 },
  price: { fontSize: 40, fontWeight: 800, color: INK, lineHeight: 1 },
  cur: { color: GRAY, fontSize: 14 },
  feats: { listStyle: 'none', padding: 0, margin: '18px 0 22px', flex: 1, display: 'flex', flexDirection: 'column', gap: 11 },
  feat: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 14.5, color: TEXT },
  cta: { width: '100%', padding: '14px 0', borderRadius: 14, border: 'none', background: CTA, color: WHITE, fontWeight: 800, fontSize: 16, cursor: 'pointer', fontFamily: FONT, boxShadow: '0 14px 30px rgba(11,160,107,.3)', transition: 'transform .15s, background .15s' },
  ctaHover: { background: CTA_INK, transform: 'translateY(-2px)' },
  guarantee: { textAlign: 'center', color: GRAY, fontSize: 12.5, marginTop: 12 },
  ghost: { width: '100%', padding: '13px 0', borderRadius: 14, background: 'transparent', border: '2px solid ' + INK, color: INK, fontWeight: 800, fontSize: 15, cursor: 'pointer', fontFamily: FONT, transition: 'background .15s' },
  foot: { position: 'relative', textAlign: 'center', color: '#9AA4B0', fontSize: 13, marginTop: 30 },
};
