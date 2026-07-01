/**
 * GuidedFirstOrder — تدفّق موجَّه يوصّل المحل الجديد للـAha (أول طلب) ثم العادة.
 * يقرأ حالة التفعيل ويعرض تشيك ليست + فعلاً رئيسياً واحداً. يختفي بعد بلوغ العادة.
 * Reforge: «جسر التفعيل» — الوصول للقيمة في أول جلسة.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getActivation, type Activation } from '../services/activationService';

export default function GuidedFirstOrder({ tenantId }: { tenantId: string }) {
  const navigate = useNavigate();
  const [act, setAct] = useState<Activation | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let on = true;
    if (tenantId) getActivation(tenantId).then(a => { if (on) { setAct(a); setLoaded(true); } }).catch(e => console.warn(e));
    return () => { on = false; };
  }, [tenantId]);

  if (!loaded) return null;
  if (act?.habit_at) return null; // كوّن العادة → انتهى الإرشاد

  const setupDone = !!act?.setup_at;
  const ahaDone = !!act?.aha_at;
  const invoiceDone = !!act?.first_invoice_at;
  const days = act?.active_days || 0;

  const steps = [
    { k: 'setup', label: 'أكمل تهيئة المحل', done: setupDone, go: '/settings' },
    { k: 'order', label: 'أنشئ أول طلب', done: ahaDone, go: '/sales' },
    { k: 'invoice', label: 'أصدر أول فاتورة', done: invoiceDone, go: '/sales' },
  ];
  const next = steps.find(s => !s.done);
  const doneCount = steps.filter(s => s.done).length;

  // بعد أول طلب: شجّع بناء العادة (طلبات في ≥3 أيام)
  const habitMode = ahaDone && days < 3;

  return (
    <div dir="rtl" className="w-full bg-surface border border-border rounded-2xl p-4 sm:p-5 mb-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="font-bold text-base sm:text-lg text-content">
          {habitMode ? 'ثبّت عادتك في سين' : 'ابدأ مع سين — 3 خطوات'}
        </div>
        <span className="text-xs text-content-muted">{habitMode ? `${days}/3 أيام` : `${doneCount}/3`}</span>
      </div>

      {habitMode ? (
        <p className="text-sm text-content-muted mb-3">سجّل طلباً في {3 - days} {3 - days === 1 ? 'يوم' : 'أيام'} إضافية لتثبيت عادتك — وتبقى بياناتك ومقاساتك معك للأبد.</p>
      ) : (
        <div className="flex flex-col gap-2 mb-3">
          {steps.map(s => (
            <div key={s.k} className="flex items-center gap-2 text-sm">
              <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] ${s.done ? 'text-white' : 'border border-border text-content-muted'}`}
                style={s.done ? { background: '#0BA06B' } : {}}>{s.done ? '✓' : ''}</span>
              <span className={s.done ? 'text-content-muted line-through' : 'text-content'}>{s.label}</span>
            </div>
          ))}
        </div>
      )}

      <button onClick={() => navigate(habitMode ? '/sales' : (next?.go || '/sales'))}
        className="w-full sm:w-auto min-h-[48px] px-6 rounded-xl text-white font-extrabold text-sm sm:text-base active:scale-[0.98] transition-transform"
        style={{ background: '#0BA06B' }}>
        {habitMode ? '+ سجّل طلب اليوم' : (next ? `+ ${next.label}` : 'تم 🎉')}
      </button>
    </div>
  );
}
