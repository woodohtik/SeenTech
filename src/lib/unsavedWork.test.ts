// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { OUTBOX_DRAINED_EVENT_NAME, hasUnsavedWork, onWorkSettled, registerUnsavedWork, useUnsavedWork } from './unsavedWork';

// seen-update-delivery-fix-task.md, phase 3.1: an update never reloads the
// page over a cart, an unsaved form, or a sale being sent.

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach((fn) => fn()); });

describe('hasUnsavedWork', () => {
  it('is false with nothing registered, true while any source says so', () => {
    expect(hasUnsavedWork()).toBe(false);
    let cart = 0;
    cleanups.push(registerUnsavedWork('pos-cart', () => cart > 0));
    cleanups.push(registerUnsavedWork('order-form', () => false));
    expect(hasUnsavedWork()).toBe(false);
    cart = 2;
    expect(hasUnsavedWork()).toBe(true);
  });

  it('a source that throws counts as unsaved work (never reload on a guess)', () => {
    cleanups.push(registerUnsavedWork('broken', () => { throw new Error('x'); }));
    expect(hasUnsavedWork()).toBe(true);
  });

  it('unregistering removes the source', () => {
    const off = registerUnsavedWork('form', () => true);
    expect(hasUnsavedWork()).toBe(true);
    off();
    expect(hasUnsavedWork()).toBe(false);
  });
});

describe('useUnsavedWork and onWorkSettled', () => {
  it('a component marks its work, and the update is told once the work is done', () => {
    const settled = vi.fn();
    cleanups.push(onWorkSettled(settled));
    const { rerender, unmount } = renderHook(({ dirty }) => useUnsavedWork('pos-cart', dirty), { initialProps: { dirty: true } });
    expect(hasUnsavedWork()).toBe(true);
    expect(settled).not.toHaveBeenCalled();
    rerender({ dirty: false });
    expect(hasUnsavedWork()).toBe(false);
    expect(settled).toHaveBeenCalledTimes(1);
    rerender({ dirty: true });
    unmount();
    expect(hasUnsavedWork()).toBe(false);
    expect(settled).toHaveBeenCalledTimes(2);
  });

  it('the outbox finishing a send also settles the work', () => {
    const settled = vi.fn();
    cleanups.push(onWorkSettled(settled));
    act(() => { window.dispatchEvent(new Event(OUTBOX_DRAINED_EVENT_NAME)); });
    expect(settled).toHaveBeenCalledTimes(1);
  });
});
