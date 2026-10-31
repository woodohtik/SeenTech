import { useEffect, useRef, useState } from 'react';
import i18n from 'i18next';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { Mic, X, Check } from 'lucide-react';
import { cn } from '../lib/utils';
import { Measurements } from '../types';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { parseArabicNumber } from '../utils/parseArabicNumber';
import { ThobePart, getNextMeasurementStep } from '../utils/measurementWizardSteps';
import { PART_LABELS } from './ThobeMeasurementSelector';

// Global Constraint: TTS/recognition for the voice wizard stay Arabic
// regardless of the merchant's active UI language. `t()` (below, for
// on-screen text) still follows the merchant's own language.
const arabicT = i18n.getFixedT('ar');

export interface VoiceMeasurementWizardProps {
  values: Measurements;
  onChange: (values: Measurements) => void;
  onClose: () => void;
}

// How long the "✓ label: value" confirmation stays tappable before the
// wizard auto-advances to the next field.
const CONFIRM_DISPLAY_MS = 1500;

export default function VoiceMeasurementWizard({ values, onChange, onClose }: VoiceMeasurementWizardProps) {
  const { t } = useTranslation();
  const { isListening, transcript, error, start, stop } = useSpeechRecognition();

  const [stepIndex, setStepIndex] = useState(-1);
  const [lastResult, setLastResult] = useState<{ part: ThobePart; value: number } | null>(null);
  // 'unrecognized' covers both an unparseable transcript and a 'no-speech'
  // error (same retry-this-field UI + message). 'not-allowed' and 'network'
  // get their own distinct messages.
  const [retryError, setRetryError] = useState<'unrecognized' | 'not-allowed' | 'network' | null>(null);
  const [manualEditPart, setManualEditPart] = useState<ThobePart | null>(null);
  const [manualValue, setManualValue] = useState('');

  // The part the hook's next transcript/error event applies to. Kept in a
  // ref (not state) because it must be set synchronously before `start()`
  // is called, ahead of any re-render.
  const currentPartRef = useRef<ThobePart | null>(null);
  const advanceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set synchronously (not via setState) the instant teardown begins — in
  // handleCancel and in the unmount cleanup effect — and checked inside the
  // TTS utterance's onend/onerror before they call start(). Those handlers
  // fire asynchronously: speechSynthesis.cancel() still delivers onend/
  // onerror to the utterance that was in flight when cancel() was called,
  // so without this guard a Cancel tap or an unmount can still spin up a
  // brand-new SpeechRecognition instance after the wizard is already gone,
  // and nothing would ever stop it. A ref (not state) because it must be
  // readable synchronously inside those callbacks without waiting for a
  // re-render, and it never needs to flip back to false on this instance —
  // a fresh wizard mount gets a fresh ref (initialized false) via useRef.
  const closingRef = useRef(false);

  const part = getNextMeasurementStep(stepIndex);

  // On mount, and whenever stepIndex advances to a new part: speak the
  // Arabic prompt, then start listening once speech ends (or immediately,
  // on any speechSynthesis failure -- graceful degradation per spec).
  useEffect(() => {
    if (advanceTimeoutRef.current) {
      clearTimeout(advanceTimeoutRef.current);
      advanceTimeoutRef.current = null;
    }
    setLastResult(null);
    setRetryError(null);
    setManualEditPart(null);

    const nextPart = getNextMeasurementStep(stepIndex);
    currentPartRef.current = nextPart;

    if (!nextPart) {
      onClose();
      return;
    }

    const promptText = 'قل مقاس ' + arabicT(PART_LABELS[nextPart]);
    const utterance = new SpeechSynthesisUtterance(promptText);
    utterance.lang = 'ar-SA';
    // Guarded: speechSynthesis.cancel() (called by handleCancel/unmount)
    // still asynchronously fires onend/onerror for the utterance that was
    // in flight. Once closingRef is true the wizard is logically torn down,
    // so these must not start a new recognition session behind it.
    utterance.onend = () => {
      if (closingRef.current) return;
      start();
    };
    utterance.onerror = () => {
      if (closingRef.current) return;
      start(); // graceful degradation per spec: skip straight to listening
    };
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.speak(utterance);
    } else {
      start();
    }
    // Only stepIndex should re-trigger this; `start`/`onClose` are stable
    // callbacks from the hook/parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex]);

  // React to a recognized (or unparseable) transcript for the current field.
  useEffect(() => {
    if (transcript === null) return;
    const activePart = currentPartRef.current;
    if (!activePart) return;

    const value = parseArabicNumber(transcript);
    if (value === null) {
      setRetryError('unrecognized');
      return;
    }

    onChange({ ...values, [activePart]: value });
    setLastResult({ part: activePart, value });
    setRetryError(null);

    advanceTimeoutRef.current = setTimeout(() => {
      setStepIndex((i) => i + 1);
    }, CONFIRM_DISPLAY_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcript]);

  // 'no-speech' gets the same retry-this-field treatment as an unparseable
  // transcript. 'not-allowed' (mic permission denied) and 'network' (Chrome's
  // Web Speech API round-trips to Google's servers) each get their own
  // distinct message, per the spec's error-handling section, but use the
  // same retry-this-field UI pattern. 'other' is intentionally left
  // unhandled, matching the brief's scope.
  useEffect(() => {
    if (error === 'no-speech') {
      setRetryError('unrecognized');
    } else if (error === 'not-allowed') {
      setRetryError('not-allowed');
    } else if (error === 'network') {
      setRetryError('network');
    }
  }, [error]);

  // Unmount safety net: never leave speech synthesis or recognition running
  // behind a closed wizard.
  useEffect(() => {
    return () => {
      // Mark teardown before cancel()/stop() so the in-flight utterance's
      // onend/onerror (fired asynchronously by cancel()) sees closingRef
      // already true and does not call start() behind the unmounted wizard.
      closingRef.current = true;
      if (advanceTimeoutRef.current) clearTimeout(advanceTimeoutRef.current);
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRetry = () => {
    setRetryError(null);
    start();
  };

  const handleCancel = () => {
    // Same ordering reason as the unmount cleanup above: set the guard
    // before cancel() so the late onend/onerror it triggers is a no-op.
    closingRef.current = true;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    stop();
    onClose();
  };

  // Tapping the confirmed value within the display window opens a manual
  // correction field instead of auto-advancing (Global Constraint: a voice
  // result is always visibly confirmable/correctable).
  const handleTapResult = () => {
    if (!lastResult) return;
    if (advanceTimeoutRef.current) {
      clearTimeout(advanceTimeoutRef.current);
      advanceTimeoutRef.current = null;
    }
    setManualEditPart(lastResult.part);
    setManualValue(String(lastResult.value));
  };

  const handleManualConfirm = () => {
    if (!manualEditPart) return;
    const numValue = Math.max(0, parseFloat(manualValue) || 0);
    onChange({ ...values, [manualEditPart]: numValue });
    setManualEditPart(null);
    setStepIndex((i) => i + 1);
  };

  if (!part) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-surface rounded-3xl border border-border shadow-2xl w-full max-w-sm p-6 space-y-6 text-center"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-black text-content">
            {t('measurements.voice_wizard_title', 'تعبئة المقاسات بالصوت')}
          </h3>
          <button
            type="button"
            onClick={handleCancel}
            aria-label={t('measurements.voice_wizard_cancel', 'إلغاء')}
            className="p-2 rounded-full text-content-muted hover:bg-border transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col items-center gap-3 py-4">
          <div
            className={cn(
              'w-16 h-16 rounded-full flex items-center justify-center transition-colors',
              isListening ? 'bg-brand/10 text-brand animate-pulse' : 'bg-surface-muted text-content-muted'
            )}
          >
            <Mic size={28} />
          </div>
          <p className="text-sm font-bold text-content-muted">{t(PART_LABELS[part])}</p>
        </div>

        {manualEditPart && (
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              step="0.1"
              autoFocus
              value={manualValue}
              onChange={(e) => setManualValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleManualConfirm();
                }
              }}
              className="flex-1 bg-surface-muted border border-border rounded-xl px-3 py-2 text-center text-xl font-black text-content focus:ring-0"
            />
            <button
              type="button"
              onClick={handleManualConfirm}
              className="p-2.5 rounded-xl bg-brand text-white hover:bg-brand/90 transition-colors"
            >
              <Check size={18} />
            </button>
          </div>
        )}

        {!manualEditPart && lastResult && (
          <button
            type="button"
            onClick={handleTapResult}
            className="w-full py-3 rounded-xl bg-success/10 text-success font-bold hover:bg-success/20 transition-colors"
          >
            ✓ {t(PART_LABELS[lastResult.part])}: {lastResult.value}
          </button>
        )}

        {!manualEditPart && retryError && (
          <div className="space-y-2">
            <p className="text-sm font-bold text-warning">
              {retryError === 'not-allowed' &&
                t(
                  'measurements.voice_wizard_not_allowed',
                  'يحتاج الوصول للمايكروفون. فعّله من إعدادات المتصفح.'
                )}
              {retryError === 'network' &&
                t('measurements.voice_wizard_network_error', 'تحقّق من الاتصال بالإنترنت')}
              {retryError === 'unrecognized' &&
                t('measurements.voice_wizard_no_understand', 'لم أسمع/أفهم شيئاً، حاول مرة أخرى')}
            </p>
            <button
              type="button"
              onClick={handleRetry}
              className="w-full py-3 rounded-xl bg-brand text-white font-bold hover:bg-brand/90 transition-colors"
            >
              {t('measurements.voice_wizard_retry', 'حاول مرة أخرى')}
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={handleCancel}
          className="w-full py-2 text-sm font-bold text-content-muted hover:text-content transition-colors"
        >
          {t('measurements.voice_wizard_cancel', 'إلغاء')}
        </button>
      </motion.div>
    </div>
  );
}
