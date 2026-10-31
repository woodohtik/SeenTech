// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { test, expect, vi, afterEach } from 'vitest';
import { VoiceMicButton } from './VoiceMicButton';
import { ToastProvider } from '../../contexts/ToastContext';

// No `globals: true` in vitest.config.ts, so @testing-library/react's
// auto-cleanup (which relies on a global afterEach) never registers --
// without this, a button rendered by one test is still in the DOM for the
// next, breaking getByRole('button') once more than one test renders it.
afterEach(() => {
  cleanup();
  delete (window as any).SpeechRecognition;
  delete (window as any).webkitSpeechRecognition;
});

// VoiceMicButton calls useToast() unconditionally (to surface not-allowed/
// network errors) before its own isSupported early return, so it must be
// rendered inside a ToastProvider even in the "unsupported browser" case.
test('renders nothing when the browser has no SpeechRecognition', () => {
  // ToastProvider renders its own (empty) toast-list container alongside
  // VoiceMicButton's own output, so the DOM as a whole is no longer empty
  // -- assert on VoiceMicButton's own output (no button) instead.
  render(<VoiceMicButton onResult={() => {}} />, { wrapper: ToastProvider });
  expect(screen.queryByRole('button')).toBeNull();
});

test('clicking the button starts listening, and a result calls onResult once', () => {
  class MockSR { lang=''; continuous=false; interimResults=false; onresult:any; onerror:any; onend:any; start(){} abort(){} }
  // Regular function (not arrow): vitest 5 mocks must be constructible for `new`.
  (window as any).SpeechRecognition = vi.fn(function () { return new MockSR(); });
  const onResult = vi.fn();
  render(<VoiceMicButton onResult={onResult} />, { wrapper: ToastProvider });
  const button = screen.getByRole('button');
  fireEvent.click(button);
  expect(onResult).not.toHaveBeenCalled(); // no transcript yet, just started listening
});

test('clicking again while listening stops recognition instead of starting a second instance', () => {
  class MockSR {
    lang = ''; continuous = false; interimResults = false;
    onresult: any; onerror: any; onend: any;
    start = vi.fn(); abort = vi.fn();
  }
  const instances: MockSR[] = [];
  (window as any).SpeechRecognition = vi.fn(function () {
    const inst = new MockSR();
    instances.push(inst);
    return inst;
  });
  render(<VoiceMicButton onResult={() => {}} />, { wrapper: ToastProvider });
  const button = screen.getByRole('button');

  fireEvent.click(button); // start
  fireEvent.click(button); // stop

  expect(instances).toHaveLength(1);
  expect(instances[0].abort).toHaveBeenCalled();
});
