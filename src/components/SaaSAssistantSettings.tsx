import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase/client';
import { Bot, Sparkles, Save, Eye, EyeOff, RotateCcw, Send, ShieldCheck } from 'lucide-react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { isRtlLang } from '../lib/direction';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { SmartSelect } from './ui/SmartSelect';
import { IconInput } from './ui/IconInput';

const DEFAULT_SYSTEM_PROMPT =
  'أنت مساعد سين الذكي، نظام نقاط بيع لمحلات الخياطة. مهمتك مساعدة صاحب المحل أو الكاشير بأسلوب ودود ومهني، الإجابة باختصار، وتوجيههم لكيفية إنشاء فواتير أو جرد المخزون.';

interface AssistantSettingsData {
  isEnabled: boolean;
  aiProvider: string;
  modelName: string;
  apiKeyMasked: string;
  hasApiKey: boolean;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  dailyMessageLimit: number;
  updatedAt: string | null;
  updatedBy: string | null;
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

export default function SaaSAssistantSettings() {
  const { t, i18n } = useTranslation();
  const isRtl = isRtlLang(i18n.language);
  const { success: toastSuccess, error: toastError } = useToast();
  const { confirm } = useConfirm();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<AssistantSettingsData | null>(null);

  const [isEnabled, setIsEnabled] = useState(true);
  const [aiProvider, setAiProvider] = useState('openai');
  const [modelName, setModelName] = useState('gpt-4o-mini');
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(500);
  const [dailyMessageLimit, setDailyMessageLimit] = useState(200);

  const [previewMessage, setPreviewMessage] = useState('');
  const [previewReply, setPreviewReply] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const res = await authedFetch('/api/super-admin/assistant-settings');
      if (!res.ok) throw new Error((await res.json()).error || 'Load failed');
      const data: AssistantSettingsData = await res.json();
      setSettings(data);
      setIsEnabled(data.isEnabled);
      setAiProvider(data.aiProvider);
      setModelName(data.modelName);
      setSystemPrompt(data.systemPrompt);
      setTemperature(data.temperature);
      setMaxTokens(data.maxTokens);
      setDailyMessageLimit(data.dailyMessageLimit);
      setApiKey('');
    } catch (err) {
      console.error('Failed to load assistant settings:', err);
      toastError(t('saas.assistant_settings.load_error'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadSettings(); }, []);

  const handleSave = async () => {
    if (settings) {
      if (!isEnabled && settings.isEnabled) {
        const ok = await confirm({
          title: t('saas.assistant_settings.confirm_disable_title'),
          description: t('saas.assistant_settings.confirm_disable_desc'),
          danger: true,
        });
        if (!ok) return;
      } else if (aiProvider !== settings.aiProvider) {
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
          isEnabled, aiProvider, modelName, apiKey,
          systemPrompt, temperature, maxTokens, dailyMessageLimit,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
      const data: AssistantSettingsData = await res.json();
      setSettings(data);
      setApiKey('');
      toastSuccess(t('saas.assistant_settings.saved_success'));
    } catch (err) {
      console.error('Failed to save assistant settings:', err);
      toastError(t('saas.assistant_settings.save_error'));
    } finally {
      setSaving(false);
    }
  };

  const handleTestPreview = async () => {
    if (!previewMessage.trim()) return;
    if (!apiKey.trim() && !settings?.hasApiKey) {
      toastError(t('saas.assistant_settings.preview_no_key_error'));
      return;
    }
    setPreviewLoading(true);
    setPreviewReply('');
    try {
      const res = await authedFetch('/api/super-admin/assistant-settings/test', {
        method: 'POST',
        body: JSON.stringify({
          aiProvider, modelName, apiKey, systemPrompt, temperature, maxTokens,
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
              <div className="w-14 h-7 bg-border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-brand"></div>
            </label>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Provider Settings */}
            <div className="bg-surface p-8 rounded-[2.5rem] border border-border shadow-sm space-y-6">
              <h3 className="text-xl font-black text-content flex items-center gap-2">
                <Sparkles className="text-brand" size={22} />
                {t('saas.assistant_settings.provider_section_title')}
              </h3>

              <div className="space-y-2">
                <label className="block text-sm font-black text-content-muted">{t('saas.assistant_settings.provider_label')}</label>
                <SmartSelect
                  value={aiProvider}
                  onChange={setAiProvider}
                  options={[
                    { value: 'openai', label: t('saas.assistant_settings.provider_openai') },
                    { value: 'gemini', label: t('saas.assistant_settings.provider_gemini') },
                  ]}
                />
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-black text-content-muted">{t('saas.assistant_settings.model_name_label')}</label>
                <IconInput
                  type="text"
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                  placeholder={t('saas.assistant_settings.model_name_placeholder')}
                  dir="ltr"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-black text-content-muted">{t('saas.assistant_settings.api_key_label')}</label>
                <IconInput
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={settings?.hasApiKey ? settings.apiKeyMasked : t('saas.assistant_settings.api_key_placeholder')}
                  dir="ltr"
                  endIcon={
                    <button type="button" onClick={() => setShowApiKey(v => !v)} className="text-content-muted hover:text-content transition-colors">
                      {showApiKey ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  }
                />
                <p className="text-xs text-content-muted font-medium px-1">
                  {settings?.hasApiKey ? t('saas.assistant_settings.api_key_unchanged_hint') : t('saas.assistant_settings.api_key_none_saved')}
                </p>
              </div>

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

            {/* System Prompt + Limits */}
            <div className="space-y-8">
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
