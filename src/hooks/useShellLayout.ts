import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { mainSteps, resolveShell, shellFromKey, shellKey, type Shell, type SidebarChoice } from '../lib/shellLayout';

const EXPANDED_KEY = 'seen_ai_panel_expanded';
const sidebarKey = (owner: string) => `seen_sidebar_choice_${owner}`;

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* no storage (private window): the choice lasts for this visit */ }
}

function subscribeToResize(onChange: () => void) {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
}

/**
 * seen-responsive-layout-task.md Phase 1: the shell's state in one place.
 *
 * The sidebar's fold used to live in Layout, the assistant's open / wide
 * state in SeenAIFab, and the two met through a CSS variable written from an
 * effect -- so nothing could decide "dock or float", which needs all three.
 * This hook holds the inputs and derives the shell during render
 * (lib/shellLayout.ts): no effect chain, no frame with the wrong layout.
 *
 * The window is read through useSyncExternalStore with the DERIVED shell as
 * the snapshot, so dragging the window's edge re-renders only when a
 * threshold is crossed, not on every pixel.
 */
export function useShellLayout(opts: { hasSidebar: boolean; owner: string }) {
  const { hasSidebar, owner } = opts;
  const [sidebarChoice, setChoice] = useState<SidebarChoice>(() => {
    const saved = read(sidebarKey(owner));
    return saved === 'open' || saved === 'collapsed' ? saved : null;
  });
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantExpanded, setExpanded] = useState(() => read(EXPANDED_KEY) === '1');

  // The owner (shop + employee) is known a moment after the first render: read
  // their choice then (state adjusted during render, as React documents it).
  const [knownOwner, setKnownOwner] = useState(owner);
  if (knownOwner !== owner) {
    setKnownOwner(owner);
    const saved = read(sidebarKey(owner));
    setChoice(saved === 'open' || saved === 'collapsed' ? saved : null);
  }

  const key = useSyncExternalStore(
    subscribeToResize,
    () => shellKey(resolveShell({ width: window.innerWidth, hasSidebar, sidebarChoice, assistantOpen, assistantExpanded })),
    () => shellKey(resolveShell({ width: 1280, hasSidebar, sidebarChoice, assistantOpen, assistantExpanded })),
  );
  const shell: Shell = useMemo(() => shellFromKey(key), [key]);

  /** The user sets the sidebar: kept, and never overridden by the assistant. */
  const setSidebar = useCallback((choice: Exclude<SidebarChoice, null>) => {
    setChoice(choice);
    write(sidebarKey(owner), choice);
  }, [owner]);

  const toggleExpanded = useCallback(() => {
    setExpanded((value) => {
      write(EXPANDED_KEY, value ? '0' : '1');
      return !value;
    });
  }, []);

  return { shell, sidebarChoice, setSidebar, assistantOpen, setAssistantOpen, assistantExpanded, toggleExpanded };
}

/**
 * Writes the steps the content area's width has reached, for the `main-*`
 * variants (index.css). They are written on <html>, not on the element
 * measured, so that windows and menus drawn outside it (a portal to <body>)
 * follow the content's width like everything else on the page.
 * Set before the first paint and kept by a ResizeObserver; it touches the
 * attribute only when the steps change and never React state, so resizing
 * re-renders nothing. Removed when the layout goes: pages with no shell
 * (login, public links) use the window's variants.
 */
export function useMeasuredSteps<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const apply = (width: number) => {
      const steps = mainSteps(width);
      if (root.dataset.main !== steps) root.dataset.main = steps;
    };
    apply(el.getBoundingClientRect().width);
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver((entries) => {
        const entry = entries[entries.length - 1];
        apply(entry.borderBoxSize?.[0]?.inlineSize ?? entry.target.getBoundingClientRect().width);
      });
      observer.observe(el, { box: 'border-box' });
    }
    return () => {
      observer?.disconnect();
      delete root.dataset.main;
    };
  }, []);
  return ref;
}
