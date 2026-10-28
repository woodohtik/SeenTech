// @vitest-environment jsdom
import { renderHook, act } from '@testing-library/react';
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSpeechRecognition } from './useSpeechRecognition';

class MockSpeechRecognition {
  lang = '';
  continuous = false;
  interimResults = false;
  onresult: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  abort = vi.fn();
}

let instances: MockSpeechRecognition[];
beforeEach(() => {
  instances = [];
  // Regular function (not arrow): vitest 5 mocks must be constructible for `new`.
  (window as any).SpeechRecognition = vi.fn(function () {
    const inst = new MockSpeechRecognition();
    instances.push(inst);
    return inst;
  });
});
afterEach(() => { delete (window as any).SpeechRecognition; });

test('isSupported is false when neither SpeechRecognition nor webkitSpeechRecognition exist', () => {
  delete (window as any).SpeechRecognition;
  const { result } = renderHook(() => useSpeechRecognition());
  expect(result.current.isSupported).toBe(false);
});

test('start() sets isListening, onresult sets transcript and clears isListening', () => {
  const { result } = renderHook(() => useSpeechRecognition());
  act(() => result.current.start());
  expect(result.current.isListening).toBe(true);
  expect(instances).toHaveLength(1);
  expect(instances[0].lang).toBe('ar-SA');
  act(() => instances[0].onresult!({ results: [[{ transcript: 'أربعين' }]] }));
  expect(result.current.transcript).toBe('أربعين');
  expect(result.current.isListening).toBe(false);
});

test('onerror with not-allowed sets error and clears isListening', () => {
  const { result } = renderHook(() => useSpeechRecognition());
  act(() => result.current.start());
  act(() => instances[0].onerror!({ error: 'not-allowed' }));
  expect(result.current.error).toBe('not-allowed');
  expect(result.current.isListening).toBe(false);
});

test('onerror with no-speech maps to the no-speech error code', () => {
  const { result } = renderHook(() => useSpeechRecognition());
  act(() => result.current.start());
  act(() => instances[0].onerror!({ error: 'no-speech' }));
  expect(result.current.error).toBe('no-speech');
});

test('calling start() while already listening does not create a second instance', () => {
  const { result } = renderHook(() => useSpeechRecognition());
  act(() => result.current.start());
  act(() => result.current.start());
  expect(instances).toHaveLength(1);
});

test('stop() aborts the active recognition and clears isListening', () => {
  const { result } = renderHook(() => useSpeechRecognition());
  act(() => result.current.start());
  act(() => result.current.stop());
  expect(instances[0].abort).toHaveBeenCalled();
  expect(result.current.isListening).toBe(false);
});
