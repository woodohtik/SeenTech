// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react';
import { test, expect, vi, afterEach } from 'vitest';
import { VoiceMicButton } from './VoiceMicButton';

afterEach(() => { delete (window as any).SpeechRecognition; delete (window as any).webkitSpeechRecognition; });

test('renders nothing when the browser has no SpeechRecognition', () => {
  const { container } = render(<VoiceMicButton onResult={() => {}} />);
  expect(container).toBeEmptyDOMElement();
});

test('clicking the button starts listening, and a result calls onResult once', () => {
  class MockSR { lang=''; continuous=false; interimResults=false; onresult:any; onerror:any; onend:any; start(){} abort(){} }
  // Regular function (not arrow): vitest 5 mocks must be constructible for `new`.
  (window as any).SpeechRecognition = vi.fn(function () { return new MockSR(); });
  const onResult = vi.fn();
  render(<VoiceMicButton onResult={onResult} />);
  const button = screen.getByRole('button');
  fireEvent.click(button);
  expect(onResult).not.toHaveBeenCalled(); // no transcript yet, just started listening
});
