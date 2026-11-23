// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMeasuredSteps, useShellLayout } from './useShellLayout';

// Review of 2026-11-24 (I-1, M-4, M-9, M-11): the measuring hook must follow
// an element that mounts after the layout (the admin layout shows its
// two-factor screen first); opening the sidebar to show a menu is not a
// choice; nothing is filed under an owner that is not known yet; storage that
// throws (a private window) does not break the layout.

function setWindowWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  window.dispatchEvent(new Event('resize'));
}

beforeEach(() => {
  localStorage.clear();
  setWindowWidth(1280);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 1000, height: 600, top: 0, left: 0, right: 1000, bottom: 600, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete document.documentElement.dataset.main;
});

function Measured({ showMain }: { showMain: boolean }) {
  const ref = useMeasuredSteps<HTMLElement>();
  return showMain ? <main ref={ref} /> : <div>two-factor screen</div>;
}

describe('useMeasuredSteps', () => {
  it('measures a <main> that mounts after the layout, and clears when it goes', () => {
    const view = render(<Measured showMain={false} />);
    expect(document.documentElement.dataset.main).toBeUndefined();
    view.rerender(<Measured showMain />);
    expect(document.documentElement.dataset.main).toBe('480 640 720 900');
    view.rerender(<Measured showMain={false} />);
    expect(document.documentElement.dataset.main).toBeUndefined();
    view.rerender(<Measured showMain />);
    expect(document.documentElement.dataset.main).toBe('480 640 720 900');
  });
});

describe('useShellLayout', () => {
  const owner = 'shop-1_staff-1';

  it('opening the sidebar for a menu is shown but never saved', () => {
    setWindowWidth(1100); // folded by default here
    const { result } = renderHook(() => useShellLayout({ hasSidebar: true, owner }));
    expect(result.current.shell.sidebar).toBe('collapsed');
    act(() => result.current.openSidebarForNow());
    expect(result.current.shell.sidebar).toBe('open');
    expect(localStorage.getItem(`seen_sidebar_choice_${owner}`)).toBeNull();
    act(() => result.current.endSidebarForNow());
    expect(result.current.shell.sidebar).toBe('collapsed');
  });

  it('a choice made by hand is saved and read back for the same person', () => {
    const first = renderHook(() => useShellLayout({ hasSidebar: true, owner }));
    act(() => first.result.current.setSidebar('collapsed'));
    expect(localStorage.getItem(`seen_sidebar_choice_${owner}`)).toBe('collapsed');
    first.unmount();
    const again = renderHook(() => useShellLayout({ hasSidebar: true, owner }));
    expect(again.result.current.shell.sidebar).toBe('collapsed');
  });

  it('before the owner is known nothing is saved; their own choice loads once known', () => {
    localStorage.setItem(`seen_sidebar_choice_${owner}`, 'collapsed');
    const { result, rerender } = renderHook(({ who }) => useShellLayout({ hasSidebar: true, owner: who }), { initialProps: { who: null as string | null } });
    expect(result.current.shell.sidebar).toBe('open');
    act(() => result.current.setSidebar('open'));
    expect(Object.keys(localStorage).filter((k) => k.startsWith('seen_sidebar_choice_'))).toEqual([`seen_sidebar_choice_${owner}`]);
    rerender({ who: owner });
    expect(result.current.shell.sidebar).toBe('collapsed');
  });

  it('storage that throws (a private window) leaves the layout working', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    const { result } = renderHook(() => useShellLayout({ hasSidebar: true, owner }));
    act(() => result.current.setSidebar('collapsed'));
    expect(result.current.shell.sidebar).toBe('collapsed');
    act(() => result.current.toggleExpanded());
    expect(result.current.assistantExpanded).toBe(true);
  });

  it('opening the assistant at 1280 floats it and keeps the page as it was', () => {
    const { result } = renderHook(() => useShellLayout({ hasSidebar: true, owner }));
    act(() => result.current.setAssistantOpen(true));
    expect(result.current.shell).toEqual({ sidebar: 'open', assistant: 'overlay', expanded: false });
  });
});
