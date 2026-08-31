import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase/client';
import {
  Bot, Sparkles, Save, Eye, EyeOff, RotateCcw, Send, ShieldCheck,
  CheckCircle2, XCircle, HelpCircle, ArrowUp, ArrowDown, X, Plus,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { isRtlLang } from '../lib/direction';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { SmartSelect } from './ui/SmartSelect';
import { IconInput } from './ui/IconInput';
import { cn } from '../lib/utils';

const DEFAULT_SYSTEM_PROMPT =
  'أنت مساعد سين الذكي، نظام نقاط بيع لمحلات الخياطة. مهمتك مساعدة صاحب المحل أو الكاشير بأسلوب ودود ومهني، الإجابة باختصار، وتوجيههم لكيفية إنشاء فواتير أو جرد المخزون.';

interface ProviderStatus {
  providerKey: string;
  label: string;
  defaultModels: string[];
  isConfigured: boolean;
  hasApiKey: boolean;
  apiKeyMasked: string;
  lastTestedAt: string | null;
  lastTestStatus: 'success' | 'failed' | null;
  lastTestMessage: string | null;
}

interface AssistantSettingsData {
  isEnabled: boolean;
  activeProvider: string;
  activeModel: string;
  fallbackOrder: string[];
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  dailyMessageLimit: number;
  updatedAt: string | null;
  updatedBy: string | null;
  providers: ProviderStatus[];
}

async function authedFetch(path: string, options: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('No user authorization token found');
  return fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
}

function isReady(p: ProviderStatus | undefined) {
  return Boolean(p && p.isConfigured && p.lastTestStatus === 'success');
}

export default function SaaSAssistantSettings() {
  const { t, i18n } = useTranslation();
  const isRtl = isRtlLang(i18n.language);
  const { success: toastSuccess, error: toastError } = useToast();
  const { confirm } = useConfirm();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<AssistantSettingsData | null>(null);

  const [isEnabled, setIsEnabled] = useState(true);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [activeProvider, setActiveProvider] = useState('');
  const [activeModel, setActiveModel] = useState('');
  const [fallbackOrder, setFallbackOrder] = useState<string[]>([]);
  const [fallbackPickValue, setFallbackPickValue] = useState('');

  // حالة محلية لكل بطاقة مزوّد: مفتاح API المكتوب للتو (لم يُحفظ بعد)،
  // النموذج المختار، وحالة تحميل زر الاختبار الخاص بها.
  const [providerApiKeyInput, setProviderApiKeyInput] = useState<Record<string, string>>({});
  const [providerModelChoice, setProviderModelChoice] = useState<Record<string, string>>({});
  const [providerShowKey, setProviderShowKey] = useState<Record<string, boolean>>({});
  const [providerTesting, setProviderTesting] = useState<Record<string, boolean>>({});

  const [systemPrompt, setSystemPrompt] = useState('');
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(500);
  const [dailyMessageLimit, setDailyMessageLimit] = useState(200);

  const [previewMessage, setPreviewMessage] = useState('');
  const [previewReply, setPreviewReply] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);

  const applySettings = (data: AssistantSettingsData) => {
    setSettings(data);
    setIsEnabled(data.isEnabled);
    setProviders(data.providers);
    setActiveProvider(data.activeProvider);
    setActiveModel(data.activeModel);
    setFallbackOrder(data.fallbackOrder || []);
    setSystemPrompt(data.systemPrompt);
    setTemperature(data.temperature);
    setMaxTokens(data.maxTokens);
    setDailyMessageLimit(data.dailyMessageLimit);
    setProviderApiKeyInput({});
    const modelChoices: Record<string, string> = {};
    for (const p of data.providers) {
      modelChoices[p.providerKey] = p.providerKey === data.activeProvider ? data.activeModel : p.defaultModels[0];
    }
    setProviderModelChoice(modelChoices);
  };

  const loadSettings = async () => {
    setLoading(true);
    try {
      const res = await authedFetch('/api/super-admin/assistant-settings');
      if (!res.ok) throw new Error((await res.json()).error || 'Load failed');
      const data: AssistantSettingsData = await res.json();
      applySettings(data);
    } catch (err) {
      console.error('Failed to load assistant settings:', err);
      toastError(t('saas.assistant_settings.load_error'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadSettings(); }, []);

  const handleTestProvider = async (providerKey: string) => {
    const provider = providers.find((p) => p.providerKey === providerKey);
    const typedKey = (providerApiKeyInput[providerKey] || '').trim();
    if (!typedKey && !provider?.hasApiKey) {
      toastError(t('saas.assistant_settings.provider_needs_key_to_test'));
      return;
    }
    setProviderTesting((prev) => ({ ...prev, [providerKey]: true }));
    try {
      const res = await authedFetch(`/api/super-admin/assistant-settings/providers/${providerKey}/test`, {
        method: 'POST',
        body: JSON.stringify({
          apiKey: typedKey || undefined,
          modelName: providerModelChoice[providerKey] || provider?.defaultModels[0],
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Test failed');

      const updated: ProviderStatus = body.provider;
      setProviders((prev) => prev.map((p) => (p.providerKey === providerKey ? updated : p)));
      setProviderApiKeyInput((prev) => ({ ...prev, [providerKey]: '' }));

      if (body.success) {
        toastSuccess(t('saas.assistant_settings.provider_test_success_toast', { label: updated.label }));
      } else {
        toastError(t('saas.assistant_settings.provider_test_failed_toast', { label: updated.label, message: body.message }));
      }
    } catch (err: any) {
      console.error('Provider test failed:', err);
      toastError(err.message || t('saas.assistant_settings.save_error'));
    } finally {
      setProviderTesting((prev) => ({ ...prev, [providerKey]: false }));
    }
  };

  const handleSetActive = (providerKey: string) => {
    const provider = providers.find((p) => p.providerKey === providerKey);
    if (!isReady(provider)) return;
    setActiveProvider(providerKey);
    setActiveModel(providerModelChoice[providerKey] || provider!.defaultModels[0]);
    setFallbackOrder((prev) => prev.filter((k) => k !== providerKey));
  };

  const readyProviders = providers.filter((p) => isReady(p));
  const fallbackCandidates = readyProviders.filter((p) => p.providerKey !== activeProvider && !fallbackOrder.includes(p.providerKey));

  const handleAddFallback = () => {
    if (!fallbackPickValue) return;
    setFallbackOrder((prev) => [...prev, fallbackPickValue]);
    setFallbackPickValue('');
  };

  const handleRemoveFallback = (key: string) => {
    setFallbackOrder((prev) => prev.filter((k) => k !== key));
  };

  const handleMoveFallback = (index: number, direction: -1 | 1) => {
    setFallbackOrder((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const handleSave = async () => {
    const activeProviderStatus = providers.find((p) => p.providerKey === activeProvider);
    if (!isReady(activeProviderStatus)) {
      toastError(t('saas.assistant_settings.provider_not_ready_hint'));
      return;
    }

    if (settings) {
      if (!isEnabled && settings.isEnabled) {
        const ok = await confirm({
          title: t('saas.assistant_settings.confirm_disable_title'),
          description: t('saas.assistant_settings.confirm_disable_desc'),
          danger: true,
        });
        if (!ok) return;
      } else if (activeProvider !== settings.activeProvider) {
        const ok = await confirm({
          title: t('saas.assistant_settings.confirm_provider_change_title'),
          description: t('saas.assistant_settings.confirm_provider_change_desc'),
        });
        if (!ok) return;
      }
    }

    setSaving(true);
    try {
      const res = await authedFetch('/api/super-admin/assistant-settings', {
        method: 'PUT',
        body: JSON.stringify({
          isEnabled, activeProvider, activeModel, fallbackOrder,
          systemPrompt, temperature, maxTokens, dailyMessageLimit,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Save failed');
      applySettings(body as AssistantSettingsData);
      toastSuccess(t('saas.assistant_settings.saved_success'));
    } catch (err: any) {
      console.error('Failed to save assistant settings:', err);
      toastError(err.message || t('saas.assistant_settings.save_error'));
    } finally {
      setSaving(false);
    }
  };

  const handleTestPreview = async () => {
    if (!previewMessage.trim()) return;
    const activeProviderStatus = providers.find((p) => p.providerKey === activeProvider);
    if (!activeProviderStatus?.hasApiKey) {
      toastError(t('saas.assistant_settings.preview_no_key_error'));
      return;
    }
    setPreviewLoading(true);
    setPreviewReply('');
    try {
      const res = await authedFetch('/api/super-admin/assistant-settings/test', {
        method: 'POST',
        body: JSON.stringify({
          aiProvider: activeProvider,
          modelName: activeModel,
          systemPrompt, temperature, maxTokens,
          message: previewMessage,
        }),
      });
      if (!res.ok || !res.body) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Test failed');
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = '';
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setPreviewReply(acc);
      }
    } catch (err: any) {
      console.error('Assistant live preview failed:', err);
      setPreviewReply('');
      toastError(err.message || t('saas.assistant_settings.save_error'));
    } finally {
      setPreviewLoading(false);
    }
  };

  const statusBadge = (p: ProviderStatus) => {
    if (!p.isConfigured) {
      return (
        <span className="flex items-center gap-1.5 text-xs font-black text-content-muted">
          <span className="w-2 h-2 rounded-full bg-border" />
          {t('saas.assistant_settings.provider_status_not_configured')}
        </span>
      );
    }
    if (p.lastTestStatus === 'success') {
      return (
        <span className="flex items-center gap-1.5 text-xs font-black text-success">
          <CheckCircle2 size={14} />
          {t('saas.assistant_settings.provider_status_success')}
        </span>
      );
    }
    if (p.lastTestStatus === 'failed') {
      return (
        <span className="flex items-center gap-1.5 text-xs font-black text-danger" title={p.lastTestMessage || ''}>
          <XCircle size={14} />
          {t('saas.assistant_settings.provider_status_failed')}
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1.5 text-xs font-black text-warning">
        <HelpCircle size={14} />
        {t('saas.assistant_settings.provider_status_untested')}
      </span>
    );
  };

  return (
    <div className="space-y-8 font-sans" dir={isRtl ? 'rtl' : 'ltr'}>
      <div>
        <h2 className="text-3xl font-black text-content">{t('saas.assistant_settings.title')}</h2>
        <p className="text-content-muted font-bold mt-1">{t('saas.assistant_settings.subtitle')}</p>
      </div>

      {loading ? (
        <div className="bg-surface p-16 rounded-[2.5rem] border border-border shadow-sm text-center text-content-muted font-bold">
          {t('saas.assistant_settings.loading')}
        </div>
      ) : (
        <>
          {/* Enable Toggle */}
          <div className="bg-brand/5 p-6 rounded-[2rem] border border-brand/10 flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-brand text-white rounded-2xl flex items-center justify-center shrink-0">
                <Bot size={24} />
              </div>
              <div>
                <h4 className="text-content font-black">{t('saas.assistant_settings.enable_toggle')}</h4>
                <p className="text-content-muted text-sm font-medium">{t('saas.assistant_settings.enable_toggle_desc')}</p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={isEnabled}
                onChange={(e) => setIsEnabled(e.target.checked)}
              />
              <div className="w-14 h-7 bg-border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-border after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-brand"></div>
            </label>
          </div>

          {/* Providers */}
          <div className="space-y-4">
            <div>
              <h3 className="text-xl font-black text-content flex items-center gap-2">
                <Sparkles className="text-brand" size={22} />
                {t('saas.assistant_settings.providers_section_title')}
              </h3>
              <p className="text-content-muted text-sm font-medium mt-1">{t('saas.assistant_settings.providers_section_desc')}</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {providers.map((p) => {
                const isActive = p.providerKey === activeProvider;
                const ready = isReady(p);
                return (
                  <div
                    key={p.providerKey}
                    className={cn(
                      'bg-surface p-6 rounded-[2rem] border shadow-sm space-y-4',
                      isActive ? 'border-brand ring-2 ring-brand/20' : 'border-border'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <h4 className="text-content font-black">{p.label}</h4>
                        {isActive && (
                          <span className="text-[10px] font-black bg-brand text-white rounded-full px-2 py-0.5">
                            {t('saas.assistant_settings.provider_active_badge')}
                          </span>
                        )}
                      </div>
                      {statusBadge(p)}
                    </div>

                    <div className="space-y-2">
                      <label className="block text-xs font-black text-content-muted">{t('saas.assistant_settings.api_key_label')}</label>
                      <IconInput
                        type={providerShowKey[p.providerKey] ? 'text' : 'password'}
                        name={`provider-api-key-${p.providerKey}`}
                        autoComplete="new-password"
                        data-lpignore="true"
                        data-1p-ignore="true"
                        data-form-type="other"
                        value={providerApiKeyInput[p.providerKey] || ''}
                        onChange={(e) => setProviderApiKeyInput((prev) => ({ ...prev, [p.providerKey]: e.target.value }))}
                        placeholder={p.hasApiKey ? p.apiKeyMasked : t('saas.assistant_settings.api_key_placeholder')}
                        dir="ltr"
                        endIcon={
                          <button
                            type="button"
                            onClick={() => setProviderShowKey((prev) => ({ ...prev, [p.providerKey]: !prev[p.providerKey] }))}
                            className="text-content-muted hover:text-content transition-colors"
                          >
                            {providerShowKey[p.providerKey] ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="block text-xs font-black text-content-muted">{t('saas.assistant_settings.provider_model_label')}</label>
                      <SmartSelect
                        value={providerModelChoice[p.providerKey] || p.defaultModels[0]}
                        onChange={(v) => setProviderModelChoice((prev) => ({ ...prev, [p.providerKey]: v }))}
                        options={p.defaultModels.map((m) => ({ value: m, label: m }))}
                      />
                      <IconInput
                        type="text"
                        value={
                          p.defaultModels.includes(providerModelChoice[p.providerKey] || '')
                            ? ''
                            : (providerModelChoice[p.providerKey] || '')
                        }
                        onChange={(e) => setProviderModelChoice((prev) => ({ ...prev, [p.providerKey]: e.target.value }))}
                        placeholder={t('saas.assistant_settings.provider_model_custom_placeholder')}
                        dir="ltr"
                      />
                    </div>

                    {p.lastTestedAt && (
                      <p className="text-[11px] text-content-muted font-medium">
                        {t('saas.assistant_settings.provider_last_tested', {
                          date: new Date(p.lastTestedAt).toLocaleString(
                            i18n.language === 'en' ? 'en-US' : i18n.language === 'ur' ? 'ur-PK-u-nu-latn' : 'ar-SA-u-nu-latn'
                          ),
                        })}
                      </p>
                    )}
                    {p.lastTestStatus === 'failed' && p.lastTestMessage && (
                      <p className="text-[11px] text-danger font-medium break-words">{p.lastTestMessage}</p>
                    )}

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleTestProvider(p.providerKey)}
                        disabled={providerTesting[p.providerKey]}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-surface-muted text-content font-black rounded-xl hover:bg-border transition-all disabled:opacity-50 text-sm"
                      >
                        {providerTesting[p.providerKey] ? (
                          <div className="w-4 h-4 border-2 border-content-muted/30 border-t-content rounded-full animate-spin" />
                        ) : null}
                        {providerTesting[p.providerKey] ? t('saas.assistant_settings.provider_testing') : t('saas.assistant_settings.provider_test_button')}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSetActive(p.providerKey)}
                        disabled={!ready || isActive}
                        title={!ready ? t('saas.assistant_settings.provider_not_ready_hint') : undefined}
                        className="flex-1 px-4 py-2.5 bg-brand text-white font-black rounded-xl hover:bg-brand/90 transition-all disabled:opacity-40 text-sm"
                      >
                        {isActive ? t('saas.assistant_settings.provider_active_badge') : t('saas.assistant_settings.provider_set_active_button')}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Fallback Order */}
          <div className="bg-surface p-8 rounded-[2.5rem] border border-border shadow-sm space-y-4">
            <div>
              <h3 className="text-xl font-black text-content flex items-center gap-2">
                <ShieldCheck className="text-brand" size={22} />
                {t('saas.assistant_settings.fallback_section_title')}
              </h3>
              <p className="text-content-muted text-sm font-medium mt-1">{t('saas.assistant_settings.fallback_section_desc')}</p>
            </div>

            {fallbackOrder.length === 0 ? (
              <p className="text-content-muted text-sm font-medium bg-surface-muted rounded-2xl p-4 text-center">
                {t('saas.assistant_settings.fallback_empty_hint')}
              </p>
            ) : (
              <div className="space-y-2">
                {fallbackOrder.map((key, index) => {
                  const p = providers.find((pr) => pr.providerKey === key);
                  return (
                    <div key={key} className="flex items-center gap-3 bg-surface-muted rounded-xl px-4 py-3">
                      <span className="w-6 h-6 flex items-center justify-center rounded-full bg-brand/10 text-brand text-xs font-black shrink-0">
                        {index + 1}
                      </span>
                      <span className="flex-1 font-bold text-content text-sm">{p?.label || key}</span>
                      <button
                        type="button"
                        onClick={() => handleMoveFallback(index, -1)}
                        disabled={index === 0}
                        title={t('saas.assistant_settings.fallback_move_up')}
                        className="p-1.5 text-content-muted hover:text-content disabled:opacity-30 transition-colors"
                      >
                        <ArrowUp size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoveFallback(index, 1)}
                        disabled={index === fallbackOrder.length - 1}
                        title={t('saas.assistant_settings.fallback_move_down')}
                        className="p-1.5 text-content-muted hover:text-content disabled:opacity-30 transition-colors"
                      >
                        <ArrowDown size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveFallback(key)}
                        title={t('saas.assistant_settings.fallback_remove')}
                        className="p-1.5 text-danger hover:bg-danger/10 rounded-lg transition-colors"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {fallbackCandidates.length > 0 && (
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <SmartSelect
                    value={fallbackPickValue}
                    onChange={setFallbackPickValue}
                    placeholder={t('saas.assistant_settings.fallback_add_placeholder')}
                    options={fallbackCandidates.map((p) => ({ value: p.providerKey, label: p.label }))}
                  />
                </div>
                <button
                  type="button"
                  onClick={handleAddFallback}
                  disabled={!fallbackPickValue}
                  className="flex items-center gap-1.5 px-4 py-2.5 bg-brand/10 text-brand font-black rounded-xl hover:bg-brand/20 transition-all disabled:opacity-40 text-sm shrink-0"
                >
                  <Plus size={16} />
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* System Prompt */}
            <div className="bg-surface p-8 rounded-[2.5rem] border border-border shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-black text-content flex items-center gap-2">
                  <Bot className="text-brand" size={22} />
                  {t('saas.assistant_settings.prompt_section_title')}
                </h3>
                <button
                  type="button"
                  onClick={() => setSystemPrompt(DEFAULT_SYSTEM_PROMPT)}
                  className="flex items-center gap-1.5 text-xs font-black text-content-muted hover:text-brand transition-colors"
                >
                  <RotateCcw size={14} />
                  {t('saas.assistant_settings.prompt_reset_default')}
                </button>
              </div>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={6}
                className="w-full bg-surface border border-border rounded-xl p-4 text-sm font-medium text-content outline-none transition-all focus:ring-2 focus:ring-brand/20 focus:border-brand resize-none"
              />
            </div>

            {/* Model tuning + Limits */}
            <div className="space-y-8">
              <div className="bg-surface p-8 rounded-[2.5rem] border border-border shadow-sm space-y-4">
                <h3 className="text-xl font-black text-content flex items-center gap-2 mb-2">
                  <Sparkles className="text-brand" size={22} />
                  {t('saas.assistant_settings.provider_section_title')}
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="block text-sm font-black text-content-muted">{t('saas.assistant_settings.temperature_label')}</label>
                    <input
                      type="number"
                      min="0" max="1" step="0.1"
                      value={temperature}
                      onChange={(e) => setTemperature(Math.min(1, Math.max(0, Number(e.target.value) || 0)))}
                      className="w-full bg-surface border border-border rounded-xl px-3.5 py-2.5 text-sm font-semibold text-content outline-none transition-all focus:ring-2 focus:ring-brand/20 focus:border-brand"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-sm font-black text-content-muted">{t('saas.assistant_settings.max_tokens_label')}</label>
                    <input
                      type="number"
                      min="1"
                      value={maxTokens}
                      onChange={(e) => setMaxTokens(Math.max(1, parseInt(e.target.value, 10) || 1))}
                      className="w-full bg-surface border border-border rounded-xl px-3.5 py-2.5 text-sm font-semibold text-content outline-none transition-all focus:ring-2 focus:ring-brand/20 focus:border-brand"
                    />
                  </div>
                </div>
              </div>

              <div className="bg-surface p-8 rounded-[2.5rem] border border-border shadow-sm space-y-2">
                <h3 className="text-xl font-black text-content flex items-center gap-2 mb-2">
                  <ShieldCheck className="text-brand" size={22} />
                  {t('saas.assistant_settings.limits_section_title')}
                </h3>
                <label className="block text-sm font-black text-content-muted">{t('saas.assistant_settings.daily_limit_label')}</label>
                <input
                  type="number"
                  min="0"
                  value={dailyMessageLimit}
                  onChange={(e) => setDailyMessageLimit(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  className="w-full bg-surface border border-border rounded-xl px-3.5 py-2.5 text-sm font-semibold text-content outline-none transition-all focus:ring-2 focus:ring-brand/20 focus:border-brand"
                />
                <p className="text-xs text-content-muted font-medium px-1">{t('saas.assistant_settings.daily_limit_unlimited_hint')}</p>
              </div>
            </div>
          </div>

          {/* Live Preview */}
          <div className="bg-surface p-8 rounded-[2.5rem] border border-border shadow-sm space-y-4">
            <h3 className="text-xl font-black text-content flex items-center gap-2">
              <Sparkles className="text-brand" size={22} />
              {t('saas.assistant_settings.preview_section_title')}
            </h3>
            <p className="text-content-muted text-sm font-medium -mt-2">{t('saas.assistant_settings.preview_desc')}</p>

            {previewReply && (
              <div className="bg-surface-muted p-4 rounded-2xl text-sm font-medium text-content whitespace-pre-wrap">
                {previewReply}
              </div>
            )}

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={previewMessage}
                onChange={(e) => setPreviewMessage(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !previewLoading) handleTestPreview(); }}
                placeholder={t('saas.assistant_settings.preview_placeholder')}
                className="flex-1 bg-surface border border-border rounded-xl px-3.5 py-2.5 text-sm font-semibold text-content outline-none transition-all focus:ring-2 focus:ring-brand/20 focus:border-brand"
              />
              <button
                type="button"
                onClick={handleTestPreview}
                disabled={previewLoading || !previewMessage.trim()}
                className="flex items-center gap-2 px-5 py-2.5 bg-surface-muted text-content font-black rounded-xl hover:bg-border transition-all disabled:opacity-50 shrink-0"
              >
                {previewLoading ? (
                  <div className="w-4 h-4 border-2 border-content-muted/30 border-t-content rounded-full animate-spin" />
                ) : (
                  <Send size={16} />
                )}
                <span>{t('saas.assistant_settings.preview_send')}</span>
              </button>
            </div>
          </div>

          {/* Save */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pb-4">
            <div>
              {settings?.updatedAt && (
                <p className="text-xs text-content-muted font-bold">
                  {t('saas.assistant_settings.last_updated_by', {
                    name: settings.updatedBy || '—',
                    date: new Date(settings.updatedAt).toLocaleString(
                      i18n.language === 'en' ? 'en-US' : i18n.language === 'ur' ? 'ur-PK-u-nu-latn' : 'ar-SA-u-nu-latn'
                    ),
                  })}
                </p>
              )}
            </div>
            <motion.button
              whileTap={{ scale: 0.97 }}
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-8 py-4 bg-brand text-white rounded-2xl font-black hover:bg-brand/90 disabled:opacity-50 transition-all shadow-lg shadow-brand/10"
            >
              {saving ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Save size={20} />
              )}
              <span>{t('saas.assistant_settings.save_button')}</span>
            </motion.button>
          </div>
        </>
      )}
    </div>
  );
}
