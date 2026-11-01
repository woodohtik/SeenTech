// @vitest-environment jsdom
import { renderHook, act } from '@testing-library/react';
import { test, expect, vi, afterEach } from 'vitest';
import { useIdleTimeout } from './useIdleTimeout';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test('attaches each window activity listener exactly once, even across many activity events', () => {
  const addSpy = vi.spyOn(window, 'addEventListener');
  renderHook(() => useIdleTimeout(1000, 100, () => {}));

  act(() => {
    for (let i = 0; i < 50; i++) {
      window.dispatchEvent(new Event('mousemove'));
    }
  });

  const mousemoveAdds = addSpy.mock.calls.filter((c) => c[0] === 'mousemove');
  expect(mousemoveAdds).toHaveLength(1);
});

test('removes listeners and interval on unmount', () => {
  const removeSpy = vi.spyOn(window, 'removeEventListener');
  const { unmount } = renderHook(() => useIdleTimeout(1000, 100, () => {}));
  unmount();
  const mousemoveRemoves = removeSpy.mock.calls.filter((c) => c[0] === 'mousemove');
  expect(mousemoveRemoves).toHaveLength(1);
});

test('calls onTimeout once the idle duration exceeds timeoutMs', () => {
  vi.useFakeTimers();
  const onTimeout = vi.fn();
  renderHook(() => useIdleTimeout(1000, 100, onTimeout));

  act(() => {
    vi.advanceTimersByTime(16000); // past the 15s internal poll, past the 1000ms timeout
  });

  expect(onTimeout).toHaveBeenCalled();
});

test('shows a warning once idle duration enters the warning window, and activity clears it', () => {
  vi.useFakeTimers();
  const { result } = renderHook(() => useIdleTimeout(20000, 10000, () => {}));

  act(() => {
    vi.advanceTimersByTime(16000); // idle 16s: inside [10s, 20s) warning window
  });
  expect(result.current.showWarning).toBe(true);

  act(() => {
    result.current.resetActivity();
  });
  expect(result.current.showWarning).toBe(false);
});
