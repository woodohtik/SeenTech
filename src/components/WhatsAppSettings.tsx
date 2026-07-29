import React, { useState, useRef, useEffect } from 'react';
import { MessageSquare, Zap, CheckCircle2, RotateCcw, Send, Sparkles, Copy, Info } from 'lucide-react';
import { 
  DEFAULT_WHATSAPP_TEMPLATE, 
  WHATSAPP_VARIABLES, 
  getWhatsAppTemplate, 
  saveWhatsAppTemplate, 
  isWhatsAppEnabled, 
  setWhatsAppEnabled, 
  buildWhatsAppMessage, 
  sendWhatsAppMessage 
} from '../utils/whatsapp';

export default function WhatsAppSettings() {
  const [enabled, setEnabled] = useState<boolean>(true);
  const [template, setTemplate] = useState<string>(DEFAULT_WHATSAPP_TEMPLATE);
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [testPhone, setTestPhone] = useState<string>('');
  const [showTestModal, setShowTestModal] = useState<boolean>(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setEnabled(isWhatsAppEnabled());
    setTemplate(getWhatsAppTemplate());
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  const handleToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.checked;
    setEnabled(val);
    setWhatsAppEnabled(val);
    showToast(val ? 'تم تفعيل إرسال الواتساب التلقائي' : 'تم تعطيل إرسال الواتساب');
  };

  const handleSave = () => {
    saveWhatsAppTemplate(template);
    setSavedSuccess(true);
    showToast('تم حفظ قالب الرسالة بنجاح ✓');
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  const handleReset = () => {
    if (window.confirm('هل أنت تأكد من إعادة تعيين القالب إلى النص الافتراضي؟')) {
      setTemplate(DEFAULT_WHATSAPP_TEMPLATE);
      saveWhatsAppTemplate(DEFAULT_WHATSAPP_TEMPLATE);
      showToast('تمت إعادة تعيين النص الافتراضي');
    }
  };

  /**
   * إدراج المتغير في موضع المؤشر الحالي داخل حقل النص
   */
  const insertVariable = (tag: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setTemplate(prev => prev + ' ' + tag);
      showToast(`تمت إضافة المتغير ${tag}`);
      return;
    }

    const start = textarea.selectionStart ?? template.length;
    const end = textarea.selectionEnd ?? template.length;

    const before = template.substring(0, start);
    const after = template.substring(end);

    // إضافة مسافة خفيفة إذا لزم الأمر
    const spaceBefore = before.length > 0 && !before.endsWith(' ') ? ' ' : '';
    const spaceAfter = after.length > 0 && !after.startsWith(' ') ? ' ' : '';

    const newText = `${before}${spaceBefore}${tag}${spaceAfter}${after}`;
    setTemplate(newText);

    // إعادة التركيز وتحديد موضع المؤشر بعد المتغير المضاف
    setTimeout(() => {
      textarea.focus();
      const newCursorPos = start + spaceBefore.length + tag.length + spaceAfter.length;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 50);

    showToast(`تم إدراج المتغير ${tag}`);
  };

  // معاينة الرسالة الحية
  const sampleMessage = buildWhatsAppMessage(template, {
    customerName: 'عبدالله علي',
    orderId: '10482',
    totalAmount: '250',
    customerPhone: '0501234567',
    invoiceUrl: 'https://seen-pos.app/order/10482',
    storeName: 'خياطة الأناقة',
  });

  const handleSendTest = () => {
    if (!testPhone.trim()) {
      alert('يرجى إدخال رقم الواتساب للاختبار');
      return;
    }
    sendWhatsAppMessage(testPhone, sampleMessage);
    setShowTestModal(false);
  };

  return (
    <div className="bg-surface p-5 sm:p-8 md:p-10 rounded-2xl md:rounded-[3rem] border border-border shadow-xl shadow-brand/5 space-y-6 md:space-y-10 w-full relative">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 max-w-[92vw] bg-slate-900 text-white px-5 py-2.5 rounded-2xl shadow-2xl text-xs sm:text-sm font-black flex items-center gap-2 border border-slate-700 animate-bounce">
          <Sparkles size={16} className="text-amber-400 shrink-0" />
          <span className="text-center">{toastMessage}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 border-b border-border pb-6 sm:pb-8 text-center sm:text-right">
        <div className="p-4 bg-emerald-500/10 text-emerald-600 rounded-[1.5rem] shadow-inner shrink-0">
          <MessageSquare size={32} />
        </div>
        <div className="flex-1">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <h3 className="text-2xl font-black text-content">محرك واتساب (WhatsApp Engine)</h3>
            <span className="text-xs font-black text-emerald-600 bg-emerald-500/10 px-3 py-1 rounded-full self-center sm:self-auto">
              إرسال فوري وتفاعلي
            </span>
          </div>
          <p className="text-sm text-content-muted font-medium mt-1">
            خصص قالب رسائل الفواتير والتنبيهات الموجهة للعملاء عبر الواتساب واستخدم المتغيرات الذكية
          </p>
        </div>
      </div>

      <div className="space-y-6 md:space-y-8 w-full">
        {/* Toggle Switch Box */}
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between p-5 sm:p-8 bg-emerald-500/5 rounded-2xl sm:rounded-[2.5rem] border border-emerald-500/20 gap-6">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5 flex-1 text-center sm:text-right">
            <div className="p-4 bg-white rounded-2xl shadow-sm shrink-0">
              <Zap size={28} className="text-emerald-600 animate-pulse" />
            </div>
            <div className="space-y-1">
              <p className="text-lg font-black text-content">الفواتير والإشعارات الذكية</p>
              <p className="text-sm text-content-muted font-medium leading-relaxed">
                بمجرد إتمام الطلب أو الضغط على زر مشاركة الواتساب، يتم إنشاء رسالة مخصصة جاهزة للإرسال مباشرة للعميل.
              </p>
            </div>
          </div>
          <div className="flex justify-center sm:justify-start items-center gap-3">
            <span className="text-xs font-bold text-content-muted">
              {enabled ? 'مُفعّل' : 'معطّل'}
            </span>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input 
                type="checkbox" 
                className="sr-only peer" 
                checked={enabled}
                onChange={handleToggle}
              />
              <div className="w-16 h-8 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-emerald-600"></div>
            </label>
          </div>
        </div>

        {/* Variables selector section */}
        <div className="space-y-3 bg-surface-muted/50 p-5 rounded-2xl border border-border">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="text-xs font-black text-content flex items-start gap-2 min-w-0">
              <Sparkles size={16} className="text-amber-500 shrink-0 mt-0.5" />
              <span>انقر على أي متغير بالأسفل لإضافته لموقع المؤشر في النص:</span>
            </label>
            {/* Redundant hint — hidden on phones where the row has no room. */}
            <span className="hidden sm:inline text-[11px] font-bold text-content-muted">
              انقر لإدراج المتغير ↙
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
            {WHATSAPP_VARIABLES.map(item => (
              <button
                key={item.tag}
                type="button"
                onClick={() => insertVariable(item.tag)}
                className="flex flex-col items-start p-2.5 bg-surface hover:bg-brand/10 border border-border hover:border-brand/40 rounded-xl transition-all text-right group active:scale-95 shadow-xs"
                title={`انقر لإضافة ${item.label}`}
              >
                <span className="text-[11px] font-black text-brand group-hover:text-brand-dark transition-colors dir-ltr font-mono break-all">
                  {item.tag}
                </span>
                <span className="text-[10px] text-content-muted font-bold mt-0.5">
                  {item.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Template Textarea */}
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <label className="text-xs font-black text-content-muted uppercase tracking-wider">
              قالب الرسالة المخصص
            </label>
            <div className="flex items-center gap-2 text-xs font-bold text-content-muted">
              <span>عدد الحروف: {template.length}</span>
            </div>
          </div>

          <div className="relative">
            <textarea
              ref={textareaRef}
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              placeholder="اكتب نص قالب الواتساب هنا..."
              rows={5}
              className="w-full bg-surface-muted border-2 border-border focus:border-emerald-500 focus:bg-surface rounded-2xl p-5 font-medium transition-all outline-none resize-none text-sm sm:text-base leading-relaxed text-content shadow-inner"
            />
          </div>
        </div>

        {/* Live Preview Box */}
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-black text-content-muted uppercase tracking-wider flex items-center gap-1.5">
              <Info size={14} className="text-emerald-600" />
              معاينة حية للرسالة كما ستظهر للعميل:
            </span>
            <span className="text-[10px] font-bold bg-emerald-500/10 text-emerald-700 px-2 py-0.5 rounded-full">
              مثال حي
            </span>
          </div>

          <div className="p-4 sm:p-6 bg-[#efeae2] dark:bg-slate-900/80 rounded-2xl border border-slate-300 dark:border-slate-800 shadow-inner">
            <div className="max-w-md ml-auto bg-[#d9fdd3] dark:bg-emerald-950/80 text-slate-800 dark:text-emerald-100 p-4 rounded-2xl rounded-tr-none shadow-md space-y-2 border border-emerald-200/50 dark:border-emerald-800/50">
              <p className="text-sm font-medium whitespace-pre-wrap leading-relaxed dir-rtl text-right">
                {sampleMessage}
              </p>
              <div className="flex items-center justify-end gap-1 text-[10px] text-slate-500 dark:text-emerald-400 font-bold pt-1">
                <span>{new Date().toLocaleTimeString('ar-SA-u-nu-latn', { hour: '2-digit', minute: '2-digit' })}</span>
                <span className="text-emerald-600 dark:text-emerald-400">✓✓</span>
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4 pt-4 border-t border-border">
          {/* Inner row must stack too: side by side at phone width each button
              was ~120px and its Arabic label broke mid-word. */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={handleReset}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-surface-muted hover:bg-slate-200 dark:hover:bg-slate-800 text-content-muted hover:text-content rounded-xl text-xs font-black transition-all w-full sm:w-auto"
            >
              <RotateCcw size={16} />
              <span>إعادة تعيين القالب</span>
            </button>

            <button
              type="button"
              onClick={() => setShowTestModal(true)}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 rounded-xl text-xs font-black transition-all w-full sm:w-auto"
            >
              <Send size={16} />
              <span>تجربة الإرسال</span>
            </button>
          </div>

          <button
            type="button"
            onClick={handleSave}
            className="flex items-center justify-center gap-2 px-8 py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-black transition-all shadow-lg shadow-emerald-600/20 active:scale-95 w-full sm:w-auto"
          >
            <CheckCircle2 size={18} />
            <span>{savedSuccess ? 'تم حفظ القالب ✓' : 'حفظ التغيرات'}</span>
          </button>
        </div>
      </div>

      {/* Test Modal Dialog */}
      {showTestModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-start sm:items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-surface rounded-2xl sm:rounded-3xl p-5 sm:p-6 max-w-md w-full max-h-[92dvh] overflow-y-auto my-auto border border-border shadow-2xl space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-border pb-4">
              <h4 className="text-lg font-black text-content flex items-center gap-2">
                <Send size={20} className="text-emerald-600" />
                <span>تجربة إرسال رسالة الواتساب</span>
              </h4>
              <button
                type="button"
                onClick={() => setShowTestModal(false)}
                className="text-content-muted hover:text-content text-xl font-bold p-1"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-content-muted leading-relaxed font-medium">
              أدخل رقم الهاتف لتجربة إرسال الرسالة المعاينَة عبر الواتساب مباشرة:
            </p>

            <div className="space-y-2">
              <label className="text-xs font-black text-content">رقم الهاتف (مع الرمز الدولي أو المحلي)</label>
              <input
                type="text"
                placeholder="مثال: 0501234567 أو 966501234567"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                className="w-full p-3.5 bg-surface-muted border border-border rounded-xl text-sm font-bold text-content outline-none focus:border-emerald-500 dir-ltr text-right"
              />
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowTestModal(false)}
                className="flex-1 py-3 bg-surface-muted text-content font-bold rounded-xl text-xs"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleSendTest}
                className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-xl text-xs flex items-center justify-center gap-2 shadow-md shadow-emerald-600/20"
              >
                <Send size={14} />
                <span>فتح واتساب الآن</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
