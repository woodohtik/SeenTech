import { useCallback, useEffect, useRef, useState } from 'react';

export type SpeechRecognitionErrorCode = 'no-speech' | 'not-allowed' | 'network' | 'other';

export interface UseSpeechRecognitionResult {
  isSupported: boolean;
  isListening: boolean;
  transcript: string | null;
  error: SpeechRecognitionErrorCode | null;
  start: () => void;
  stop: () => void;
}

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  abort: () => void;
}

type RecognitionCtor = new () => RecognitionLike;

function getRecognitionCtor(): RecognitionCtor | null {
  const w = window as any;
  return (w.SpeechRecognition || w.webkitSpeechRecognition || null) as RecognitionCtor | null;
}

/**
 * Plain, hook-free support check -- safe to call anywhere (including
 * conditionally, inside JSX, or in a loop) since it does not create any
 * React state or instantiate a SpeechRecognition instance. Use this instead
 * of `useSpeechRecognition().isSupported` whenever only the boolean is
 * needed, so callers don't have to respect the rules of hooks just to read
 * a `typeof window` check.
 */
export function isSpeechRecognitionSupported(): boolean {
  return !!getRecognitionCtor();
}

function mapErrorCode(native: string): SpeechRecognitionErrorCode {
  switch (native) {
    case 'not-allowed':
      return 'not-allowed';
    case 'no-speech':
      return 'no-speech';
    case 'network':
      return 'network';
    default:
      return 'other';
  }
}

export function useSpeechRecognition(lang: string = 'ar-SA'): UseSpeechRecognitionResult {
  const [isSupported] = useState(() => !!getRecognitionCtor());
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [error, setError] = useState<SpeechRecognitionErrorCode | null>(null);

  // Ref mirrors isListening so a double-tap within the same tick is ignored.
  const listeningRef = useRef(false);
  const instanceRef = useRef<RecognitionLike | null>(null);

  const start = useCallback(() => {
    if (listeningRef.current) return;
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;

    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = false;
    rec.interimResults = false;

    rec.onresult = (e: any) => {
      const raw: string = e.results[0][0].transcript;
      // The recognizer sometimes appends closing punctuation that was never
      // spoken (e.g. "أربعين." for "أربعين") -- strip it so callers parsing
      // or matching the transcript don't see a trailing character they
      // didn't ask for.
      setTranscript(raw.replace(/[.؟!،؛]+$/, '').trimEnd());
      listeningRef.current = false;
      setIsListening(false);
    };
    rec.onerror = (e: any) => {
      setError(mapErrorCode(e.error));
      listeningRef.current = false;
      setIsListening(false);
    };
    rec.onend = () => {
      // Recognition can end with neither a result nor an error.
      listeningRef.current = false;
      setIsListening(false);
    };

    instanceRef.current = rec;
    listeningRef.current = true;
    setTranscript(null);
    setError(null);
    setIsListening(true);
    rec.start();
  }, [lang]);

  const stop = useCallback(() => {
    instanceRef.current?.abort();
    instanceRef.current = null;
    listeningRef.current = false;
    setIsListening(false);
  }, []);

  useEffect(() => {
    return () => {
      instanceRef.current?.abort();
      instanceRef.current = null;
    };
  }, []);

  return { isSupported, isListening, transcript, error, start, stop };
}
