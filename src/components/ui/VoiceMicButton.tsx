import { useEffect } from 'react';
import { Mic } from 'lucide-react';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';
import { cn } from '../../lib/utils';

export interface VoiceMicButtonProps {
  onResult: (transcript: string) => void;
  ariaLabel?: string; // defaults to a sensible Arabic label if omitted
}

export function VoiceMicButton({ onResult, ariaLabel }: VoiceMicButtonProps) {
  const { isSupported, isListening, transcript, start } = useSpeechRecognition();

  useEffect(() => {
    if (transcript) onResult(transcript);
  }, [transcript]);

  if (!isSupported) return null;

  return (
    <button
      type="button"
      onClick={start}
      aria-label={ariaLabel ?? 'إدخال صوتي'}
      className={cn('cursor-pointer transition-colors', isListening && 'text-brand animate-pulse')}
    >
      <Mic size={18} />
    </button>
  );
}
