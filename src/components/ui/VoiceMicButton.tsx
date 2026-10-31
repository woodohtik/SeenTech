import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Mic } from 'lucide-react';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';
import { useToast } from '../../contexts/ToastContext';
import { cn } from '../../lib/utils';

export interface VoiceMicButtonProps {
  onResult: (transcript: string) => void;
  ariaLabel?: string; // defaults to a translated, sensible label if omitted
}

export function VoiceMicButton({ onResult, ariaLabel }: VoiceMicButtonProps) {
  const { t } = useTranslation();
  const { error: toastError } = useToast();
  const { isSupported, isListening, transcript, error, start, stop } = useSpeechRecognition();

  useEffect(() => {
    if (transcript) onResult(transcript);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcript]);

  // Permission/network failures otherwise fail silently here -- the button
  // just stops pulsing with no further feedback. Surface the same messages
  // the voice measurement wizard shows for the same error codes.
  useEffect(() => {
    if (error === 'not-allowed') {
      toastError(
        t(
          'measurements.voice_wizard_not_allowed',
          'يحتاج الوصول للمايكروفون. فعّله من إعدادات المتصفح.'
        )
      );
    } else if (error === 'network') {
      toastError(t('measurements.voice_wizard_network_error', 'تحقّق من الاتصال بالإنترنت'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  if (!isSupported) return null;

  return (
    <button
      type="button"
      onClick={isListening ? stop : start}
      aria-label={ariaLabel ?? t('common.voice_input', 'إدخال صوتي')}
      className={cn('cursor-pointer transition-colors', isListening && 'text-brand animate-pulse')}
    >
      <Mic size={18} />
    </button>
  );
}
