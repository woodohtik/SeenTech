/**
 * seen-responsive-layout-task.md Phase 1 -- the shell's one rule.
 *
 * The shell (sidebar, assistant) decides by the WINDOW's width; everything
 * inside the content decides by the content's own width (the `main-*`
 * variants in index.css). This file is the shell's half: given the window,
 * what the user chose, and whether the assistant is open, it says how the
 * sidebar and the assistant sit. A pure function, so the thresholds are
 * tested as numbers and not rediscovered in screenshots.
 *
 * The rule (founder's defaults, questions 2 and 3):
 *   - the assistant sits BESIDE the page (docked) only when the page keeps
 *     at least CONTENT_MIN px:  window - sidebar - assistant >= 960;
 *   - otherwise it floats OVER the page, and the page is not squeezed;
 *   - to dock, the sidebar folds to icons when that is what makes room --
 *     unless the user set the sidebar themselves: their choice stands, and
 *     the assistant floats instead;
 *   - with nothing chosen, the sidebar is folded from 1024 to 1279px.
 */
/** Where each person's layout choices are kept; kept through sign-out (AuthContext logout): not private. */
export const SIDEBAR_CHOICE_PREFIX = 'seen_sidebar_choice_';
export const ASSISTANT_EXPANDED_KEY = 'seen_ai_panel_expanded';

export const SIDEBAR_OPEN_PX = 256;
export const SIDEBAR_COLLAPSED_PX = 80;
/** What the page must keep for the assistant to sit beside it. */
export const CONTENT_MIN_PX = 960;
export const ASSISTANT_MIN_PX = 360;
export const ASSISTANT_MAX_PX = 440;
export const ASSISTANT_EXPANDED_PX = 640;
/** Below this the sidebar is a drawer and takes no room. */
export const SIDEBAR_FROM_PX = 1024;
/** Below this the assistant is a bottom sheet. */
export const PANEL_FROM_PX = 640;
/** With no choice made, the sidebar is open from here up. */
export const SIDEBAR_OPEN_FROM_PX = 1280;

export type SidebarMode = 'drawer' | 'collapsed' | 'open' | 'none';
export type AssistantMode = 'closed' | 'sheet' | 'overlay' | 'docked';
export type SidebarChoice = 'open' | 'collapsed' | null;

export type ShellInput = {
  /** window.innerWidth */
  width: number;
  /** false in the "grid" home layout, which has no sidebar. */
  hasSidebar: boolean;
  /** What the user last set by hand, or null. */
  sidebarChoice: SidebarChoice;
  assistantOpen: boolean;
  assistantExpanded: boolean;
};

export type Shell = {
  sidebar: SidebarMode;
  assistant: AssistantMode;
  /** The assistant is shown at its wide size (it is offered from 1024px, as before). */
  expanded: boolean;
};

/** The assistant's width: clamp(360px, 30vw, 440px), or 640px expanded. The CSS says the same (--assistant-w). */
export function assistantWidthPx(width: number, expanded: boolean): number {
  if (expanded) return ASSISTANT_EXPANDED_PX;
  return Math.min(ASSISTANT_MAX_PX, Math.max(ASSISTANT_MIN_PX, width * 0.3));
}

/** The same width as CSS, for the panel itself and for the room the page gives it. */
export const assistantWidthCss = (expanded: boolean) =>
  (expanded ? `${ASSISTANT_EXPANDED_PX}px` : `clamp(${ASSISTANT_MIN_PX}px, 30vw, ${ASSISTANT_MAX_PX}px)`);

const sidebarPx = (mode: SidebarMode) => (mode === 'open' ? SIDEBAR_OPEN_PX : mode === 'collapsed' ? SIDEBAR_COLLAPSED_PX : 0);

export function resolveShell(input: ShellInput): Shell {
  const { width, hasSidebar, sidebarChoice, assistantOpen } = input;
  const expanded = assistantOpen && input.assistantExpanded && width >= SIDEBAR_FROM_PX;

  // The sidebar on its own, before the assistant has a say.
  let sidebar: SidebarMode;
  if (!hasSidebar) sidebar = 'none';
  else if (width < SIDEBAR_FROM_PX) sidebar = 'drawer';
  else if (sidebarChoice) sidebar = sidebarChoice;
  else sidebar = width >= SIDEBAR_OPEN_FROM_PX ? 'open' : 'collapsed';

  if (!assistantOpen) return { sidebar, assistant: 'closed', expanded: false };
  if (width < PANEL_FROM_PX) return { sidebar, assistant: 'sheet', expanded: false };

  const panel = assistantWidthPx(width, expanded);
  const fits = (mode: SidebarMode) => width - sidebarPx(mode) - panel >= CONTENT_MIN_PX;

  if (fits(sidebar)) return { sidebar, assistant: 'docked', expanded };
  // Folding the sidebar makes room -- but only when the user has not set it themselves.
  if (sidebar === 'open' && !sidebarChoice && fits('collapsed')) return { sidebar: 'collapsed', assistant: 'docked', expanded };
  return { sidebar, assistant: 'overlay', expanded };
}

/** A short key for a shell, so a store can tell "nothing changed" on every resize event. */
export const shellKey = (s: Shell) => `${s.sidebar}|${s.assistant}|${s.expanded ? 'x' : 'n'}`;
export function shellFromKey(key: string): Shell {
  const [sidebar, assistant, size] = key.split('|');
  return { sidebar: sidebar as SidebarMode, assistant: assistant as AssistantMode, expanded: size === 'x' };
}

/**
 * The content area's width, as the names the `main-*` variants look for
 * (index.css). Measured on <main>'s own box -- the same number the task
 * quotes (584px beside an open assistant at 1280).
 */
export const MAIN_STEPS = [480, 640, 720, 900, 1024, 1280] as const;
export function mainSteps(widthPx: number): string {
  return MAIN_STEPS.filter((step) => widthPx >= step).join(' ');
}

/**
 * Whether the content area has reached a step (the same test the `main-*`
 * variants make). For code that must agree with a layout written in those
 * variants -- an animation that slides a panel in from the side the CSS put
 * it on. False where no layout is measuring (no data-main).
 */
export function contentReached(step: (typeof MAIN_STEPS)[number]): boolean {
  if (typeof document === 'undefined') return false;
  return (document.documentElement.dataset.main ?? '').split(' ').includes(String(step));
}
