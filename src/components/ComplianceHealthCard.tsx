/**
 * ComplianceHealthCard — ودجت «صحة الامتثال» (خطّاف مبيعات + طمأنة العميل)
 * ----------------------------------------------------------------------
 * يخاطب الخوف الأول لدى التاجر: غرامة زاتكا. يعرض جاهزية المحل كنسبة + قائمة
 * تحقّق واضحة. مكوّن معزول يستقبل الحالة عبر props (غير مقترن بأي خدمة).
 *
 * التوصيل (مثال في Dashboard):
 *   <ComplianceHealthCard
 *     vatRegistered={!!tenant.taxSettings?.trn}
 *     phase1QrEnabled={true}
 *     phase2Integrated={false}
 *     pdplAccepted={!!tenant.pdplAccepted}
 *     hasLegalName={!!tenant.taxSettings?.legalName}
 *   />
 */

import type { ReactNode } from 'react';

export interface ComplianceHealthProps {
  vatRegistered: boolean;       // رقم تسجيل ضريبي مُدخل
  hasLegalName: boolean;        // الاسم النظامي مُكوّن
  phase1QrEnabled: boolean;     // رمز QR للمرحلة الأولى
  phase2Integrated: boolean;    // ربط المرحلة الثانية (FATOORA)
  pdplAccepted: boolean;        // إقرار حماية البيانات الشخصية
}

interface Check { label: string; ok: boolean; hint?: string }

export default function ComplianceHealthCard(p: ComplianceHealthProps) {
  const checks: Check[] = [
    { label: 'تسجيل ضريبي (الرقم الضريبي)', ok: p.vatRegistered, hint: 'أدخل الرقم الضريبي في الإعدادات.' },
    { label: 'الاسم النظامي للمنشأة', ok: p.hasLegalName, hint: 'يظهر على الفاتورة المعتمدة.' },
    { label: 'فاتورة المرحلة الأولى (QR)', ok: p.phase1QrEnabled },
    { label: 'ربط زاتكا — المرحلة الثانية', ok: p.phase2Integrated, hint: 'مطلوب نظاماً عند بلوغ موجتك.' },
    { label: 'إقرار حماية البيانات (PDPL)', ok: p.pdplAccepted },
  ];
  const done = checks.filter((c) => c.ok).length;
  const score = Math.round((done / checks.length) * 100);
  const color = score >= 80 ? '#1E7D45' : score >= 50 ? '#B9770E' : '#C0392B';

  return (
    <div dir="rtl" style={styles.card}>
      <div style={styles.head}>
        <span style={styles.title}>صحة الامتثال</span>
        <span style={{ ...styles.badge, background: color }}>{score}%</span>
      </div>
      <div style={styles.barTrack}>
        <div style={{ ...styles.barFill, width: `${score}%`, background: color }} />
      </div>
      <ul style={styles.list}>
        {checks.map((c) => (
          <li key={c.label} style={styles.row}>
            <span style={{ ...styles.mark, color: c.ok ? '#1E7D45' : '#C0392B' }}>{c.ok ? '✓' : '✗'}</span>
            <span style={styles.label}>
              {c.label}
              {!c.ok && c.hint ? <span style={styles.hint}>{c.hint}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      {score < 100 && (
        <div style={styles.cta}>أكمل النواقص لرفع جاهزيتك وتجنّب مخاطر الغرامات.</div>
      )}
    </div>
  );
}

const NAVY = '#1F3A5F';
const styles: Record<string, React.CSSProperties> = {
  card: { background: '#fff', borderRadius: 14, border: '1px solid #eef0f4', padding: 18, fontFamily: 'Arial, sans-serif', maxWidth: 420 },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 16, fontWeight: 700, color: NAVY },
  badge: { color: '#fff', fontWeight: 700, fontSize: 14, borderRadius: 20, padding: '2px 12px' },
  barTrack: { height: 8, background: '#eef0f4', borderRadius: 8, overflow: 'hidden', marginBottom: 14 },
  barFill: { height: '100%', borderRadius: 8, transition: 'width .4s ease' },
  list: { listStyle: 'none', padding: 0, margin: 0 },
  row: { display: 'flex', alignItems: 'flex-start', gap: 10, padding: '7px 0', fontSize: 14, color: '#333' },
  mark: { fontWeight: 700, width: 16, flexShrink: 0 },
  label: { display: 'flex', flexDirection: 'column' },
  hint: { color: '#999', fontSize: 12, marginTop: 2 },
  cta: { marginTop: 12, fontSize: 13, color: NAVY, background: '#F1F6FC', borderRadius: 8, padding: '8px 12px' },
};
