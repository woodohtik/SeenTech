/**
 * SaaSWithdrawals — مراجعة طلبات سحب الإحالة (داشبورد إدارة سين)
 * -------------------------------------------------------------
 * يعرض الطلبات «قيد المراجعة» مع الآيبان والمبلغ. الأدمن يوافق (بعد التحويل) أو يرفض (يُرجع الرصيد).
 * التوصيل: ضمن لوحة الأدمن (SuperAdminDashboard / SaaSLayout) — مسار مثل /admin/withdrawals.
 */

import { useEffect, useState } from 'react';
import { listPendingWithdrawals, processWithdrawal, type Withdrawal } from '../services/referralService';
import { useTranslation } from 'react-i18next';

import { isRtlLang } from '../lib/direction';
import { useConfirm } from '../contexts/ConfirmContext';
import { cn } from '../lib/utils';

export default function SaaSWithdrawals() {
  const { t, i18n } = useTranslation();
  const isRtl = isRtlLang(i18n.language);
  const { confirm, promptText } = useConfirm();

  const [rows, setRows] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');

  async function load() {
    setLoading(true);
    try {
      setRows(await listPendingWithdrawals());
    } catch (e: any) {
      showToast(e?.message || t('saas.failed'), 'error');
    } finally {
      setLoading(false);
    }
  }
  const [toast, setToast] = useState<{message: string, type: 'success'|'error'} | null>(null);
  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => { load(); }, []);

  async function act(id: string, approve: boolean) {
    if (approve) {
      const ok = await confirm({ description: t('saas.approve_withdrawal_confirm', 'سيتم اعتماد هذا السحب كـ"تم التحويل" -- تأكَّد أنك حوَّلت المبلغ فعلياً قبل المتابعة، فهذا الإجراء لا رجعة فيه.'), danger: true });
      if (!ok) return;
    }
    const note = approve
      ? t('saas.success')
      : ((await promptText({ description: t('saas.rejection_reason_prompt') })) || t('saas.rejection_reason_default'));
    setBusyId(id);
    try {
      await processWithdrawal(id, approve, note);
      await load();
    } catch (e: any) {
      showToast(e?.message || t('saas.failed'), 'error');
    } finally {
      setBusyId('');
    }
  }

  const cellAlign = isRtl ? 'text-right' : 'text-left';

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="p-6 text-content">
      <h1 className="text-[#0E2A42] font-black text-[26px] m-0">{t('saas.withdrawals_title')}</h1>
      <p className="text-content-muted text-[14.5px] mt-1.5 mb-5">{t('saas.withdrawals_subtitle')}</p>

      {loading ? (
        <div className="text-content-muted text-[15px] py-[30px] text-center bg-surface-muted rounded-2xl">{t('saas.loading')}</div>
      ) : rows.length === 0 ? (
        <div className="text-content-muted text-[15px] py-[30px] text-center bg-surface-muted rounded-2xl">{t('saas.no_withdrawals')}</div>
      ) : (
        <div className="seen-table-scroll">
          <table className="w-full border-collapse bg-surface rounded-2xl overflow-hidden border border-border">
            <thead>
              <tr>
                {[
                  t('saas.date'),
                  t('saas.amount'),
                  t('saas.beneficiary'),
                  t('saas.iban'),
                  t('saas.action'),
                ].map(h => (
                  <th key={h} className={cn('bg-[#0E2A42] text-white font-bold text-sm py-3 px-3.5', cellAlign)}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(w => (
                <tr key={w.id}>
                  <td className={cn('py-3 px-3.5 border-b border-border text-[14.5px]', cellAlign)}>{new Date(w.requested_at).toLocaleDateString('en-GB')}</td>
                  <td className={cn('py-3 px-3.5 border-b border-border text-[14.5px] font-extrabold text-[#0E2A42]', cellAlign)}>{w.amount.toLocaleString('en-US')} {t('common.currency_saudi_riyal', '﷼')}</td>
                  <td className={cn('py-3 px-3.5 border-b border-border text-[14.5px]', cellAlign)}>{w.beneficiary || '—'}</td>
                  <td className={cn('py-3 px-3.5 border-b border-border text-[13px] [direction:ltr]', cellAlign)}>{w.iban || '—'}</td>
                  <td className={cn('py-3 px-3.5 border-b border-border', cellAlign)}>
                    <button
                      disabled={busyId === w.id}
                      onClick={() => act(w.id, true)}
                      className={cn('bg-success text-white rounded-[9px] py-2 px-4 font-black text-[13.5px] cursor-pointer', isRtl ? 'ml-2' : 'mr-2')}
                    >
                      {t('saas.transferred')}
                    </button>
                    <button
                      disabled={busyId === w.id}
                      onClick={() => act(w.id, false)}
                      className="bg-transparent text-danger border border-danger rounded-[9px] py-2 px-3.5 font-bold text-[13.5px] cursor-pointer"
                    >
                      {t('saas.reject')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
