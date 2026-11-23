import { describe, expect, it } from 'vitest';
import { assistantWidthPx, mainSteps, resolveShell, shellFromKey, shellKey, type ShellInput } from './shellLayout';

// seen-responsive-layout-task.md Phase 1. The thresholds below are the ones
// in docs/responsive/plan-audit.md (note 3), derived from the founder's rule:
// dock only when window - sidebar - assistant >= 960.
const at = (width: number, more: Partial<ShellInput> = {}) =>
  resolveShell({ width, hasSidebar: true, sidebarChoice: null, assistantOpen: true, assistantExpanded: false, ...more });

describe('assistantWidthPx', () => {
  it('is clamp(360, 30vw, 440), and 640 expanded', () => {
    expect(assistantWidthPx(1024, false)).toBe(360);
    expect(assistantWidthPx(1280, false)).toBe(384);
    expect(assistantWidthPx(1440, false)).toBe(432);
    expect(assistantWidthPx(1920, false)).toBe(440);
    expect(assistantWidthPx(1280, true)).toBe(640);
  });
});

describe('resolveShell: the sidebar on its own', () => {
  it('a drawer under 1024, folded from 1024 to 1279, open from 1280', () => {
    const closed = (width: number) => at(width, { assistantOpen: false });
    expect(closed(768)).toEqual({ sidebar: 'drawer', assistant: 'closed', expanded: false });
    expect(closed(1024).sidebar).toBe('collapsed');
    expect(closed(1279).sidebar).toBe('collapsed');
    expect(closed(1280).sidebar).toBe('open');
  });

  it("the user's own choice wins at every desktop width", () => {
    expect(at(1100, { assistantOpen: false, sidebarChoice: 'open' }).sidebar).toBe('open');
    expect(at(1920, { assistantOpen: false, sidebarChoice: 'collapsed' }).sidebar).toBe('collapsed');
    expect(at(800, { assistantOpen: false, sidebarChoice: 'open' }).sidebar).toBe('drawer');
  });

  it('the grid home layout has no sidebar', () => {
    expect(at(1440, { hasSidebar: false, assistantOpen: false }).sidebar).toBe('none');
  });
});

describe('resolveShell: the assistant', () => {
  it('a sheet under 640', () => {
    expect(at(390).assistant).toBe('sheet');
    expect(at(639).assistant).toBe('sheet');
  });

  it("on the founder's laptop (1280 and 1366) it floats: the page keeps its width", () => {
    for (const width of [1280, 1366]) {
      expect(at(width).assistant).toBe('overlay');
      expect(at(width, { assistantExpanded: true })).toMatchObject({ assistant: 'overlay', expanded: true });
    }
    // ...and the sidebar is not folded for an assistant that is not beside the page.
    expect(at(1280).sidebar).toBe('open');
  });

  it('docks from 1480 by folding the sidebar, and keeps the sidebar open from 1656', () => {
    expect(at(1479)).toMatchObject({ assistant: 'overlay', sidebar: 'open' });
    expect(at(1480)).toMatchObject({ assistant: 'docked', sidebar: 'collapsed' });
    expect(at(1655)).toMatchObject({ assistant: 'docked', sidebar: 'collapsed' });
    expect(at(1656)).toMatchObject({ assistant: 'docked', sidebar: 'open' });
    expect(at(1920)).toMatchObject({ assistant: 'docked', sidebar: 'open' });
  });

  it('a wider window never docks less (the gap the 1600px default left)', () => {
    let docked = false;
    for (let width = 1024; width <= 2200; width++) {
      const now = at(width).assistant === 'docked';
      if (docked) expect(now, `at ${width}`).toBe(true);
      docked = docked || now;
    }
    expect(docked).toBe(true);
  });

  it('expanded docks from 1680 (sidebar folded) and from 1856 (sidebar open); below, it floats at its wide size', () => {
    const wide = (width: number) => at(width, { assistantExpanded: true });
    expect(wide(1679)).toMatchObject({ assistant: 'overlay', expanded: true });
    expect(wide(1680)).toMatchObject({ assistant: 'docked', sidebar: 'collapsed', expanded: true });
    expect(wide(1856)).toMatchObject({ assistant: 'docked', sidebar: 'open', expanded: true });
  });

  it('the wide size is offered from 1024, not below', () => {
    expect(at(1000, { assistantExpanded: true }).expanded).toBe(false);
    expect(at(1024, { assistantExpanded: true }).expanded).toBe(true);
  });

  it('whenever it is docked, the page has at least 960px', () => {
    for (let width = 640; width <= 2200; width += 7) {
      for (const sidebarChoice of [null, 'open', 'collapsed'] as const) {
        for (const assistantExpanded of [false, true]) {
          const s = at(width, { sidebarChoice, assistantExpanded });
          if (s.assistant !== 'docked') continue;
          const side = s.sidebar === 'open' ? 256 : s.sidebar === 'collapsed' ? 80 : 0;
          expect(width - side - assistantWidthPx(width, s.expanded), `at ${width}`).toBeGreaterThanOrEqual(960);
        }
      }
    }
  });

  it("a sidebar the user opened by hand is not folded: the assistant floats instead", () => {
    expect(at(1500, { sidebarChoice: 'open' })).toMatchObject({ sidebar: 'open', assistant: 'overlay' });
    expect(at(1656, { sidebarChoice: 'open' })).toMatchObject({ sidebar: 'open', assistant: 'docked' });
    expect(at(1480, { sidebarChoice: 'collapsed' })).toMatchObject({ sidebar: 'collapsed', assistant: 'docked' });
  });

  it('with no sidebar it docks from the width that leaves the page 960', () => {
    expect(at(1371, { hasSidebar: false }).assistant).toBe('overlay');
    expect(at(1372, { hasSidebar: false }).assistant).toBe('docked');
  });
});

describe('shellKey', () => {
  it('round-trips, and is the same for the same shell', () => {
    const s = at(1500);
    expect(shellFromKey(shellKey(s))).toEqual(s);
    expect(shellKey(at(1500))).toBe(shellKey(at(1520)));
    expect(shellKey(at(1479))).not.toBe(shellKey(at(1480)));
  });
});

describe('mainSteps', () => {
  it('names every step the content area has reached', () => {
    expect(mainSteps(384)).toBe('');
    expect(mainSteps(584)).toBe('480');
    expect(mainSteps(760)).toBe('480 640 720');
    expect(mainSteps(1024)).toBe('480 640 720 900 1024');
    expect(mainSteps(944)).toBe('480 640 720 900');
    expect(mainSteps(1664)).toBe('480 640 720 900 1024 1280');
  });
});
