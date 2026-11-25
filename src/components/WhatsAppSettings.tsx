import React, { useState, useRef, useEffect, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/utils';
import { MessageSquare, Zap, CheckCircle2, RotateCcw, Send, Sparkles, Info } from 'lucide-react';
import { isRtlLang, localeOf } from '../lib/direction';
import { useConfirm } from '../contexts/ConfirmContext';

import {
  TEMPLATE_VARIABLES,
  WHATSAPP_TEMPLATE_KINDS,
  WHATSAPP_TEMPLATE_MAX,
  WHATSAPP_VARIABLES,
  getDefaultWhatsAppTemplate,
  getShopWhatsAppTemplate,
  isShopWhatsAppLoaded,
  isWhatsAppEnabled,
  onShopWhatsAppChange,
  openWhatsApp,
  saveShopWhatsAppSettings,
  unknownWhatsAppVariables,
  whatsappMessage,
  type WhatsAppTemplateKind,
} from '../utils/whatsapp';

/**
 * The shop's WhatsApp messages (seen-whatsapp-templates-task.md): four
 * templates, one per message, with the variables each may use and a live
 * preview. Seen prepares the message and opens WhatsApp; the person presses
 * send. Nothing is editable until the shop's own settings have arrived, so a
 * default is never saved over the shop's template by mistake.
 */
export default function WhatsAppSettings() {
  const { t, i18n } = useTranslation();
  const { confirm } = useConfirm();
  const isRtl = isRtlLang(i18n.language);
  const loaded = useSyncExternalStore(onShopWhatsAppChange, isShopWhatsAppLoaded, isShopWhatsAppLoaded);
  const [enabled, setEnabled] = useState<boolean>(true);
  const [kind, setKind] = useState<WhatsAppTemplateKind>('order_received');
  const [drafts, setDrafts] = useState<Record<WhatsAppTemplateKind, string>>(() => Object.fromEntries(
    WHATSAPP_TEMPLATE_KINDS.map((k) => [k, getShopWhatsAppTemplate(k) || getDefaultWhatsAppTemplate(k)]),
  ) as Record<WhatsAppTemplateKind, string>);
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [testPhone, setTestPhone] = useState<string>('');
  const [showTestModal, setShowTestModal] = useState<boolean>(false);
  const template = drafts[kind];
  const setTemplate = (next: string | ((prev: string) => string)) =>
    setDrafts((d) => ({ ...d, [kind]: typeof next === 'function' ? next(d[kind]) : next }));

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Once the shop's settings arrive (or change), the form takes them.
  useEffect(() => {
    if (!loaded) return;
    setEnabled(isWhatsAppEnabled());
    setDrafts(Object.fromEntries(
      WHATSAPP_TEMPLATE_KINDS.map((k) => [k, getShopWhatsAppTemplate(k) || getDefaultWhatsAppTemplate(k)]),
    ) as Record<WhatsAppTemplateKind, string>);
  }, [loaded, i18n.language]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  // P4 (OPERATIONS-13): saved for the whole shop, not this browser.
  const handleToggle = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.checked;
    setEnabled(val);
    try {
      await saveShopWhatsAppSettings({ enabled: val });
      showToast(val ? t('settings_page.whatsapp.enabled_toast') : t('settings_page.whatsapp.disabled_toast'));
    } catch {
      setEnabled(!val);
      showToast(t('settings_page.whatsapp.save_failed'));
    }
  };

  const unknownVars = unknownWhatsAppVariables(template, kind);
  const handleSave = async () => {
    if (!loaded || saving) return;
    if (!template.trim()) {
      showToast(t('settings_page.whatsapp.template_empty'));
      return;
    }
    if (unknownVars.length > 0) {
      // A misspelt variable would be dropped from every message: say which.
      showToast(t('settings_page.whatsapp.unknown_variables', { vars: unknownVars.join(' ') }));
      return;
    }
    setSaving(true);
    try {
      await saveShopWhatsAppSettings({ templates: { [kind]: template } });
      setSavedSuccess(true);
      showToast(t('settings_page.whatsapp.saved_toast'));
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch {
      showToast(t('settings_page.whatsapp.save_failed'));
    } finally {
      setSaving(false);
    }
  };

  // Back to the default in the interface language; a failed save says so.
  const handleReset = async () => {
    if (!loaded) return;
    if (await confirm(t('settings_page.whatsapp.reset_confirm'))) {
      const fallback = getDefaultWhatsAppTemplate(kind);
      try {
        await saveShopWhatsAppSettings({ templates: { [kind]: fallback } });
        setTemplate(fallback);
        showToast(t('settings_page.whatsapp.reset_toast'));
      } catch {
        showToast(t('settings_page.whatsapp.save_failed'));
      }
    }
  };

  /**
   * إدراج المتغير في موضع المؤشر الحالي داخل حقل النص
   */
  const insertVariable = (tag: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setTemplate(prev => prev + ' ' + tag);
      showToast(t('settings_page.whatsapp.variable_added_toast') + ' ' + tag);
      return;
    }

    const start = textarea.selectionStart ?? template.length;
    const end = textarea.selectionEnd ?? template.length;

    const before = template.substring(0, start);
    const after = template.substring(end);

    // إضافة مسافة خفيفة إذا لزم الأمر
    const spaceBefore = before.length > 0 && !before.endsWith(' ') && !before.endsWith('\n') ? ' ' : '';
    const spaceAfter = after.length > 0 && !after.startsWith(' ') && !after.startsWith('\n') ? ' ' : '';

    const newText = `${before}${spaceBefore}${tag}${spaceAfter}${after}`;
    setTemplate(newText);

    // إعادة التركيز وتحديد موضع المؤشر بعد المتغير المضاف
    setTimeout(() => {
      textarea.focus();
      const newCursorPos = start + spaceBefore.length + tag.length + spaceAfter.length;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 50);

    showToast(t('settings_page.whatsapp.variable_inserted_toast') + ' ' + tag);
  };

  // The live preview: the real links' shape (https://www.seentech.io/track/...).
  const sampleMessage = whatsappMessage(kind, {
    customerName: t('settings_page.whatsapp.sample_customer_name'),
    orderNumber: '1042',
    invoiceNumber: 'INV-2026-00042',
    total: 287.5,
    customerPhone: '0501234567',
    trackingToken: '7f3a9c2e',
    measurementsToken: '4b81d0aa',
    storeName: t('settings_page.whatsapp.sample_store_name'),
    origin: 'https://www.seentech.io',
  }, template);

  const handleSendTest = () => {
    if (!testPhone.trim()) {
      showToast(t('settings_page.whatsapp.enter_phone_test'));
      return;
    }
    // The same path every message takes: the number in international form.
    if (openWhatsApp({ phone: testPhone, message: sampleMessage, kind: 'internal' })) setShowTestModal(false);
  };

  const allowedVariables = WHATSAPP_VARIABLES.filter((v) => TEMPLATE_VARIABLES[kind].includes(v.tag));

  return (
    <div className={cn("bg-surface p-5 main-640:p-8 main-720:p-10 rounded-2xl border border-border shadow-xl shadow-brand/5 space-y-6 main-720:space-y-10 w-full relative", isRtl ? "text-right" : "text-left")} dir={isRtl ? "rtl" : "ltr"}>
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 max-w-[92vw] bg-surface-muted text-white px-5 py-2.5 rounded-2xl shadow-2xl text-sm font-black flex items-center gap-2 border border-border animate-bounce">
          <Sparkles size={16} className="text-warning shrink-0" />
          <span className="text-center">{toastMessage}</span>
        </div>
      )}

      {/* Header */}
      <div className={cn("flex flex-col main-640:flex-row items-center gap-4 border-b border-border pb-6 main-640:pb-8", isRtl ? "main-640:items-start text-center main-640:text-right" : "main-640:items-start text-center main-640:text-left")}>
        <div className="p-4 bg-[var(--seen-success-bg)] text-success rounded-2xl shadow-inner shrink-0">
          <MessageSquare size={32} />
        </div>
        <div className="flex-1">
          <div className="flex flex-col main-640:flex-row main-640:items-center justify-between gap-2">
            <h3 className="text-2xl font-black text-content">{t('settings_page.whatsapp.title')}</h3>

          </div>
          <p className="text-sm text-content-muted font-medium mt-1">
            {t('settings_page.whatsapp.description')}
          </p>
        </div>
      </div>

      <div className="space-y-6 main-720:space-y-8 w-full">
        {/* Toggle Switch Box */}
        <div className="flex flex-col main-720:flex-row items-stretch main-720:items-center justify-between p-5 main-640:p-8 bg-success/5 rounded-2xl border border-success/20 gap-6">
          <div className={cn("flex flex-col main-640:flex-row items-center gap-5 flex-1", isRtl ? "main-640:items-start text-center main-640:text-right" : "main-640:items-start text-center main-640:text-left")}>
            <div className="p-4 bg-surface rounded-2xl shadow-sm shrink-0">
              <Zap size={28} className="text-success animate-pulse" />
            </div>
            <div className="space-y-1">
              <p className="text-lg font-black text-content">{t('settings_page.whatsapp.toggle_title')}</p>
              <p className="text-sm text-content-muted font-medium leading-relaxed">
                {t('settings_page.whatsapp.toggle_desc')}
              </p>
            </div>
          </div>
          <div className="flex justify-center main-640:justify-start items-center gap-3">
            <span className="text-sm font-bold text-content-muted">
              {enabled ? t('settings_page.whatsapp.status_enabled') : t('settings_page.whatsapp.status_disabled')}
            </span>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input 
                type="checkbox" 
                className="sr-only peer" 
                checked={enabled}
                onChange={handleToggle}
              />
              <div className="w-16 h-8 bg-surface-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:start-[4px] after:bg-surface after:border-border after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-success"></div>
            </label>
          </div>
        </div>

        {/* The four messages (question 1) */}
        <div role="tablist" aria-label={t('settings_page.whatsapp.templates_label')} className="flex flex-wrap gap-2">
          {WHATSAPP_TEMPLATE_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              onClick={() => setKind(k)}
              className={cn(
                "min-h-11 rounded-[8px] border px-4 text-sm font-bold transition-colors",
                kind === k ? "border-brand bg-brand text-white" : "border-border bg-surface text-content hover:bg-surface-muted"
              )}
            >
              {t(`settings_page.whatsapp.kind_${k}`)}
            </button>
          ))}
        </div>
        <p className="text-sm text-content-muted">{t(`settings_page.whatsapp.kind_${kind}_where`)}</p>

        {/* Variables selector section */}
        <div className="space-y-3 bg-surface-muted/50 p-5 rounded-2xl border border-border">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="text-sm font-black text-content flex items-start gap-2 min-w-0">
              <Sparkles size={16} className="text-warning shrink-0 mt-0.5" />
              <span>{t('settings_page.whatsapp.vars_selector_label')}</span>
            </label>
            {/* Redundant hint — hidden on phones where the row has no room. */}
            <span className="hidden main-640:inline text-sm font-bold text-content-muted">
              {t('settings_page.whatsapp.click_to_insert_hint')}
            </span>
          </div>

          <div className="grid grid-cols-2 main-640:grid-cols-3 main-720:grid-cols-6 gap-2">
            {allowedVariables.map(item => (
              <button
                key={item.tag}
                type="button"
                onClick={() => insertVariable(item.tag)}
                className={cn("flex flex-col items-start p-2.5 bg-surface hover:bg-brand/10 border border-border hover:border-brand/40 rounded-xl transition-all group active:scale-95 shadow-xs", isRtl ? "text-right" : "text-left")}
                title={t('settings_page.whatsapp.click_to_add_var', { label: item.label })}
              >
                <span className="text-sm font-black text-brand group-hover:text-brand/80 transition-colors dir-ltr font-mono break-all">
                  {item.tag}
                </span>
                <span className="text-sm text-content-muted font-bold mt-0.5">
                  {item.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Template Textarea */}
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <label className="text-sm font-black text-content-muted uppercase">
              {t('settings_page.whatsapp.template_label')}
            </label>
            <div className="flex items-center gap-2 text-sm font-bold text-content-muted">
              <span className={template.length > WHATSAPP_TEMPLATE_MAX ? 'text-danger' : undefined}>{t('settings_page.whatsapp.chars_count')} {template.length} / {WHATSAPP_TEMPLATE_MAX}</span>
            </div>
          </div>

          <div className="relative">
            <textarea
              ref={textareaRef}
              value={template}
              disabled={!loaded}
              maxLength={WHATSAPP_TEMPLATE_MAX}
              aria-invalid={unknownVars.length > 0 || undefined}
              onChange={(e) => setTemplate(e.target.value)}
              placeholder={t('settings_page.whatsapp.textarea_placeholder')}
              rows={6}
              className="w-full bg-surface-muted border-2 border-border focus:border-success focus:bg-surface rounded-2xl p-5 font-medium transition-all outline-none resize-none text-sm main-640:text-base leading-relaxed text-content shadow-inner"
            />
          </div>
        </div>

        {!loaded && (
          <p role="status" className="text-sm font-bold text-content-muted">{t('settings_page.whatsapp.loading_shop')}</p>
        )}
        {unknownVars.length > 0 && (
          <p role="alert" className="text-sm font-bold text-danger">
            {t('settings_page.whatsapp.unknown_variables', { vars: unknownVars.join(' ') })}
          </p>
        )}

        {/* Live Preview Box */}
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <span className="text-sm font-black text-content-muted uppercase flex items-center gap-1.5">
              <Info size={14} className="text-success" />
              {t('settings_page.whatsapp.preview_label')}
            </span>
            <span className="text-sm font-bold bg-[var(--seen-success-bg)] text-success px-2 py-0.5 rounded-full">
              {t('settings_page.whatsapp.preview_badge')}
            </span>
          </div>

          <div className="p-4 main-640:p-6 bg-[#efeae2] dark:bg-surface-muted/80 rounded-2xl border border-border shadow-inner">
            <div className={cn("max-w-md bg-[#d9fdd3] dark:bg-success/80 text-content dark:text-success p-4 rounded-2xl rounded-tr-none shadow-md space-y-2 border border-success/50", isRtl ? "ml-auto" : "mr-auto")}>
              <p className={cn("text-sm font-medium whitespace-pre-wrap leading-relaxed", isRtl ? "text-right" : "text-left")} dir={isRtl ? "rtl" : "ltr"}>
                {sampleMessage}
              </p>
              <div className={cn("flex items-center gap-1 text-sm text-content-muted dark:text-success font-bold pt-1", isRtl ? "justify-end" : "justify-start")}>
                <span>{new Date().toLocaleTimeString(localeOf(), { hour: '2-digit', minute: '2-digit' })}</span>
                <span className="text-success">✓✓</span>
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col main-640:flex-row items-center justify-between gap-3 main-640:gap-4 pt-4 border-t border-border">
          {/* Inner row must stack too: side by side at phone width each button
              was ~120px and its Arabic label broke mid-word. */}
          <div className="flex flex-col main-640:flex-row items-stretch main-640:items-center gap-2 w-full main-640:w-auto">
            <button
              type="button"
              onClick={handleReset}
              disabled={!loaded}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-surface-muted hover:bg-surface-muted dark:hover:bg-surface-muted text-content-muted hover:text-content rounded-xl text-sm font-black transition-all w-full main-640:w-auto"
            >
              <RotateCcw size={16} />
              <span>{t('settings_page.whatsapp.reset_btn')}</span>
            </button>

            <button
              type="button"
              onClick={() => setShowTestModal(true)}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-[var(--seen-success-bg)] hover:bg-success/20 text-success rounded-xl text-sm font-black transition-all w-full main-640:w-auto"
            >
              <Send size={16} />
              <span>{t('settings_page.whatsapp.test_send_btn')}</span>
            </button>
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={!loaded || saving}
            className="flex items-center justify-center gap-2 px-8 py-3.5 bg-success hover:bg-success/90 text-white rounded-xl text-sm font-black transition-all shadow-lg shadow-success/20 active:scale-95 w-full main-640:w-auto"
          >
            <CheckCircle2 size={18} />
            <span>{savedSuccess ? t('settings_page.whatsapp.saved_btn_success') : t('settings_page.whatsapp.save_btn')}</span>
          </button>
        </div>
      </div>

      {/* Test Modal Dialog */}
      {showTestModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-start main-640:items-center justify-center p-3 main-640:p-4 overflow-y-auto" dir={isRtl ? "rtl" : "ltr"}>
          <div className="bg-surface rounded-2xl main-640:rounded-3xl p-5 main-640:p-6 max-w-md w-full max-h-[92dvh] overflow-y-auto my-auto border border-border shadow-2xl space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-border pb-4">
              <h4 className="text-lg font-black text-content flex items-center gap-2">
                <Send size={20} className="text-success" />
                <span>{t('settings_page.whatsapp.test_modal_title')}</span>
              </h4>
              <button
                type="button"
                onClick={() => setShowTestModal(false)}
                className="text-content-muted hover:text-content text-xl font-bold p-1"
              >
                ✕
              </button>
            </div>

            <p className="text-sm text-content-muted leading-relaxed font-medium">
              {t('settings_page.whatsapp.test_modal_desc')}
            </p>

            <div className="space-y-2">
              <label className="text-sm font-black text-content">{t('settings_page.whatsapp.phone_input_label')}</label>
              <input
                type="text"
                placeholder={t('settings_page.whatsapp.phone_input_placeholder')}
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                className={cn("w-full p-3.5 bg-surface-muted border border-border rounded-xl text-sm font-bold text-content outline-none focus:border-success dir-ltr", isRtl ? "text-right" : "text-left")}
              />
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowTestModal(false)}
                className="flex-1 py-3 bg-surface-muted text-content font-bold rounded-xl text-sm"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleSendTest}
                className="flex-1 py-3 bg-success hover:bg-success/90 text-white font-black rounded-xl text-sm flex items-center justify-center gap-2 shadow-md shadow-success/20"
              >
                <Send size={14} />
                <span>{t('procurement.open_whatsapp_now')}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
