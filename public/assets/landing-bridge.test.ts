// @vitest-environment jsdom
import { test, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = readFileSync(path.join(__dirname, 'landing-bridge.js'), 'utf8');

// Executes the real script once against this test file's jsdom globals.
// ResizeObserver doesn't exist in jsdom, so it's stubbed before running --
// only the click-interception behavior is under test here.
(globalThis as any).ResizeObserver = class {
  observe() {}
  disconnect() {}
};
new Function(source).call(window);

function clickLink(href: string, target?: string): MouseEvent {
  const a = document.createElement('a');
  a.setAttribute('href', href);
  if (target) a.setAttribute('target', target);
  document.body.appendChild(a);
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  a.dispatchEvent(event);
  document.body.removeChild(a);
  return event;
}

function stubParentPostMessage() {
  const postMessage = vi.fn();
  Object.defineProperty(window, 'parent', { value: { postMessage }, configurable: true });
  return postMessage;
}

test('a link marked target="_parent" (a real top-level navigation, e.g. the static /blog pages) is left alone', () => {
  const postMessage = stubParentPostMessage();
  const event = clickLink('/blog', '_parent');
  expect(postMessage).not.toHaveBeenCalled();
  expect(event.defaultPrevented).toBe(false);
});

test('a plain same-SPA link with no target is still intercepted and routed through postMessage NAVIGATE', () => {
  const postMessage = stubParentPostMessage();
  const event = clickLink('/?view=register');
  expect(postMessage).toHaveBeenCalledWith({ type: 'NAVIGATE', path: '/?view=register' }, '*');
  expect(event.defaultPrevented).toBe(true);
});
