/**
 * ExpansionPrompt — اقتراح توسّع للمحلات الناضجة في Engagement (Health ≥70، اتساع ≥2).
 * Reforge/Monetization: التحقيق المالي «مدخل» يُعرَض عند بلوغ القيمة (القيمة > السعر).
 * قابل للإغلاق (يُحفظ محلياً حتى لا يزعج).
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getHealth, type Health } from '../services/activationService';

export default function ExpansionPrompt({ tenantId }: { tenantId: string }) {
  const navigate = useNavigate();
  const [h, setH] = useState<Health | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try { if (localStorage.getItem('seen_exp_dismiss_' + tenantId)) setDismissed(true); } catch {}
    let on = true;
    if (tenantId) getHealth(tenantId).then(d => { if (on) setH(d); }).catch(e => console.warn(e));
    return () => { on = false; };
  }, [tenantId]);

  const eligible = !!h && h.health_score >= 70 && (h.breadth ?? 0) >= 2;
  if (dismissed || !eligible) return null;

  function dismiss() {
    try { localStorage.setItem('seen_exp_dismiss_' + tenantId, '1'); } catch {}
    setDismissed(true);
  }

  return (
    <div dir="rtl" className="w-full rounded-2xl p-4 sm:p-5 mb-4 border" style={{ background: '#EAF6FD', borderColor: '#CFE6F7' }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-bold text-base sm:text-lg" style={{ color: '#0E2A42' }}>محلك من الأكثر نشاطاً 👏</div>
          <p className="text-sm mt-1" style={{ color: '#34404D' }}>
            أنت تستخدم سين باحتراف — أضف فرعاً جديداً أو فعّل تقارير الذكاء الاصطناعي لتنمو أكثر بنفس النظام.
          </p>
          <button onClick={() => navigate('/subscribe')}
            className="mt-3 min-h-[44px] px-5 rounded-xl text-white font-bold text-sm active:scale-95 transition-transform"
            style={{ background: '#0BA06B' }}>شوف الإضافات</button>
        </div>
        <button onClick={dismiss} aria-label="إغلاق" className="text-content-muted text-lg leading-none px-1">×</button>
      </div>
    </div>
  );
}
