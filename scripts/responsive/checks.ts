/**
 * seen-responsive-layout-task.md Phase 0, item 2 -- the automatic checks run
 * inside the page for every screen, width and state.
 *
 * `layoutChecks` is passed to page.evaluate, so it is self-contained: no
 * imports, no closures. Each check reports a count and a few samples
 * (selector + text + number), never a judgement in prose.
 *
 * The task lists five checks. Three more were added after the first run:
 * at 1280px with the assistant open the dashboard was visibly broken (one
 * word per line in its cards, amounts running out of their cards, a button
 * on top of the subtitle) and the five caught none of it but the font size.
 * `crushedText`, the box part of `overflow`, and `textOverlap` measure what
 * the eye sees there.
 */
export const MIN_TEXT_PX = 14;
export const MIN_TOUCH_PX = 44;
export const TOUCH_MAX_WIDTH = 1024;

export type CheckSample = { el: string; text?: string; value?: string };
export type CheckResult = { count: number; samples: CheckSample[] };
export type LayoutReport = {
  viewport: [number, number];
  mainWidth: number | null;
  /** How the shell placed things: what a person sees, whatever was asked for. */
  shell: { sidebar: 'open' | 'collapsed' | 'drawer' | 'none'; assistant: string };
  horizontalScroll: { scrollWidth: number; fail: boolean };
  overflow: CheckResult;
  crushedText: CheckResult;
  textOverlap: CheckResult;
  smallText: CheckResult & { sizes: Record<string, number> };
  touchTargets: CheckResult & { applies: boolean };
  title: { text: string | null; lines: number; brokenWord: boolean; fontSize: number | null };
};

export function layoutChecks(cfg: { minText: number; minTouch: number; touchMaxWidth: number }): LayoutReport {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const SAMPLES = 6;

  const describe = (el: Element): string => {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.') : '';
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls ? `.${cls}` : ''}`;
  };
  const textOf = (el: Element) => (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const shown = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.05) return false;
    // Screen-reader-only text is clipped to 1px on purpose.
    if (cs.clip === 'rect(0px, 0px, 0px, 0px)' || cs.clipPath === 'inset(50%)') return false;
    return true;
  };
  /** Wholly outside the viewport: parked off-canvas on purpose (a closed drawer), not an overflow. */
  const onScreenX = (r: DOMRect) => r.right > 1 && r.left < vw - 1;
  const insideScroller = (el: Element): boolean => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if ((ox === 'auto' || ox === 'scroll') && p.scrollWidth > p.clientWidth + 1) return true;
    }
    return false;
  };
  const hiddenByAncestor = (el: Element): boolean => {
    for (let p: Element | null = el; p; p = p.parentElement) {
      if (p.getAttribute('aria-hidden') === 'true' || (p as HTMLElement).inert) return true;
      if (parseFloat(getComputedStyle(p).opacity) < 0.05) return true;
    }
    return false;
  };
  /** The fixed or sticky ancestor an element is painted with, or null for the page itself. */
  const layerOf = (el: Element): Element | null => {
    for (let p: Element | null = el; p && p !== document.body; p = p.parentElement) {
      const pos = getComputedStyle(p).position;
      if (pos === 'fixed' || pos === 'sticky') return p;
    }
    return null;
  };
  const push = (r: CheckResult, sample: CheckSample) => { r.count++; if (r.samples.length < SAMPLES) r.samples.push(sample); };
  // The first element each defect check finds is marked, so the tool can
  // scroll to it and photograph it (data-layout-defect="overlap" ...).
  for (const old of Array.from(document.querySelectorAll('[data-layout-defect]'))) old.removeAttribute('data-layout-defect');
  const mark = (el: Element, kind: string) => { if (!document.querySelector(`[data-layout-defect="${kind}"]`)) el.setAttribute('data-layout-defect', kind); };

  /** The part of the page an element can be seen through: its ancestors that clip (overflow other than visible). */
  const clipOf = (el: Element): DOMRect => {
    let left = -Infinity; let top = -Infinity; let right = Infinity; let bottom = Infinity;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const r = p.getBoundingClientRect();
      left = Math.max(left, r.left); top = Math.max(top, r.top); right = Math.min(right, r.right); bottom = Math.min(bottom, r.bottom);
    }
    return new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
  };

  // The elements that carry text of their own: what a person reads.
  type Leaf = { el: HTMLElement; rect: DOMRect; rects: DOMRect[]; lines: number; words: number; layer: Element | null };
  const leaves: Leaf[] = [];
  for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
    if (/^(SCRIPT|STYLE|NOSCRIPT|OPTION|SELECT)$/.test(el.tagName)) continue;
    const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3 && (n.nodeValue || '').trim() !== '');
    if (own.length === 0 || !shown(el) || hiddenByAncestor(el)) continue;
    const range = document.createRange();
    const tops = new Set<number>();
    const rects: DOMRect[] = [];
    const clip = clipOf(el);
    let left = Infinity; let right = -Infinity; let top = Infinity; let bottom = -Infinity; let words = 0;
    for (const n of own) {
      range.selectNodeContents(n);
      words += ((n.nodeValue || '').trim().match(/\S+/g) || []).length;
      for (const rc of Array.from(range.getClientRects())) {
        if (rc.width < 1) continue;
        // Only what shows: a line scrolled out of its box is not on screen.
        const shownPart = new DOMRect(Math.max(rc.left, clip.left), Math.max(rc.top, clip.top), 0, 0);
        shownPart.width = Math.min(rc.right, clip.right) - shownPart.left;
        shownPart.height = Math.min(rc.bottom, clip.bottom) - shownPart.top;
        if (shownPart.width >= 1 && shownPart.height >= 1) rects.push(shownPart);
        tops.add(Math.round(rc.top));
        left = Math.min(left, rc.left); right = Math.max(right, rc.right); top = Math.min(top, rc.top); bottom = Math.max(bottom, rc.bottom);
      }
    }
    if (!isFinite(left)) continue;
    const rect = new DOMRect(left, top, right - left, bottom - top);
    if (!onScreenX(rect) || rect.bottom < 0 || rect.top > vh * 3) continue;
    leaves.push({ el, rect, rects, lines: tops.size, words, layer: layerOf(el) });
  }

  // 1. No horizontal scroll on the page.
  const scrollWidth = document.documentElement.scrollWidth;
  const horizontalScroll = { scrollWidth, fail: scrollWidth > vw + 1 };

  // 2. Nothing sticks out: of the viewport, of the box that clips it, or of its own card.
  const overflow: CheckResult = { count: 0, samples: [] };
  for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
    if (!shown(el)) continue;
    const r = el.getBoundingClientRect();
    if (!onScreenX(r) || r.bottom < 0 || r.top > vh * 3) continue;
    const cs = getComputedStyle(el);
    if (!((r.right > vw + 1 || r.left < -1) && cs.position !== 'fixed' && !insideScroller(el))) continue;
    // Count the outermost offender only, not every descendant of it.
    const parent = el.parentElement;
    if (parent && parent !== document.body) {
      const pr = parent.getBoundingClientRect();
      if (pr.right > vw + 1 || pr.left < -1) continue;
    }
    push(overflow, { el: describe(el), text: textOf(el), value: `out of the viewport by ${Math.round(Math.max(r.right - vw, -r.left))}px` });
  }
  // ...and nothing hidden past the edge of the content area, which clips
  // what overflows it (overflow-x: hidden) -- off the page, but not the window.
  const contentArea = document.querySelector('main');
  if (contentArea) {
    const box = contentArea.getBoundingClientRect();
    for (const el of Array.from(contentArea.querySelectorAll<HTMLElement>('*'))) {
      if (!shown(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed' || insideScroller(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > vh * 3) continue;
      const by = Math.max(r.right - box.right, box.left - r.left);
      if (by <= 2) continue;
      const parent = el.parentElement;
      if (parent && parent !== contentArea) {
        const pr = parent.getBoundingClientRect();
        if (Math.max(pr.right - box.right, box.left - pr.left) > 2) continue;
      }
      mark(el, 'overflow');
      push(overflow, { el: describe(el), text: textOf(el), value: `cut off by the content area by ${Math.round(by)}px` });
    }
  }
  for (const leaf of leaves) {
    if (insideScroller(leaf.el)) continue;
    const own = getComputedStyle(leaf.el);
    // Text ended with "…" on purpose is not an overflow.
    if (own.textOverflow === 'ellipsis' || own.webkitLineClamp !== 'none' && own.webkitLineClamp !== '') continue;
    // The nearest box the text sits in: something with a border, a background or a clip.
    let box: HTMLElement | null = null;
    for (let p = leaf.el.parentElement, depth = 0; p && p !== document.body && depth < 8; p = p.parentElement, depth++) {
      const cs = getComputedStyle(p);
      const clipped = cs.overflowX === 'hidden' || cs.overflowX === 'clip';
      const bordered = parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth) > 0;
      const filled = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
      if (clipped || bordered || filled) { box = p; break; }
    }
    if (!box) continue;
    const br = box.getBoundingClientRect();
    const by = Math.max(leaf.rect.right - br.right, br.left - leaf.rect.left);
    if (by <= 2) continue;
    const clipped = /hidden|clip/.test(getComputedStyle(box).overflowX);
    mark(leaf.el, 'overflow');
    push(overflow, { el: describe(leaf.el), text: textOf(leaf.el), value: `${clipped ? 'cut by' : 'runs out of'} ${describe(box)} by ${Math.round(by)}px` });
  }

  // 3. No text squeezed to a word a line: three lines or more, barely a word on each.
  const crushedText: CheckResult = { count: 0, samples: [] };
  for (const leaf of leaves) {
    if (leaf.lines >= 3 && leaf.words / leaf.lines <= 1.34) {
      mark(leaf.el, 'crushed');
      push(crushedText, { el: describe(leaf.el), text: textOf(leaf.el), value: `${leaf.words} words on ${leaf.lines} lines, ${Math.round(leaf.rect.width)}px wide` });
    }
  }

  // 4. No text painted over other text.
  const textOverlap: CheckResult = { count: 0, samples: [] };
  for (let i = 0; i < leaves.length; i++) {
    const a = leaves[i];
    for (let j = i + 1; j < leaves.length; j++) {
      const b = leaves[j];
      if (a.layer !== b.layer || a.el.contains(b.el) || b.el.contains(a.el)) continue;
      // Line by line: text that wraps has a bounding box wider than any of
      // its lines, and that box overlaps its neighbours on paper only.
      let hit: [number, number] | null = null;
      for (const ra of a.rects) {
        for (const rb of b.rects) {
          const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
          const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
          if (w <= 4 || h <= 4) continue;
          const smaller = Math.min(ra.width * ra.height, rb.width * rb.height);
          if (smaller > 0 && (w * h) / smaller >= 0.2) { hit = [w, h]; break; }
        }
        if (hit) break;
      }
      if (!hit) continue;
      mark(a.el, 'overlap');
      push(textOverlap, { el: `${describe(a.el)} / ${describe(b.el)}`, text: `${textOf(a.el)} / ${textOf(b.el)}`, value: `${Math.round(hit[0])}x${Math.round(hit[1])}px shared` });
    }
  }

  // 5. No readable text under the minimum size.
  const smallText: CheckResult & { sizes: Record<string, number> } = { count: 0, samples: [], sizes: {} };
  for (const leaf of leaves) {
    const size = parseFloat(getComputedStyle(leaf.el).fontSize);
    if (size >= cfg.minText) continue;
    const key = `${Math.round(size * 10) / 10}px`;
    smallText.sizes[key] = (smallText.sizes[key] || 0) + 1;
    push(smallText, { el: describe(leaf.el), text: textOf(leaf.el), value: key });
  }

  // 6. Touch targets, where the screen is one people touch.
  const touchTargets: CheckResult & { applies: boolean } = { count: 0, samples: [], applies: vw <= cfg.touchMaxWidth };
  if (touchTargets.applies) {
    const targets = document.body.querySelectorAll<HTMLElement>(
      'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="tab"], [role="switch"], [role="checkbox"], [role="menuitem"]');
    for (const el of Array.from(targets)) {
      if (!shown(el) || hiddenByAncestor(el) || (el as HTMLButtonElement).disabled) continue;
      const cs = getComputedStyle(el);
      // A link inside a sentence is text, measured by the text checks (WCAG 2.5.8 inline exception).
      if (el.tagName === 'A' && cs.display === 'inline') continue;
      // A checkbox or radio is pressed through its label.
      const box = (el.tagName === 'INPUT' && /^(checkbox|radio)$/.test((el as HTMLInputElement).type) && el.closest('label')) || el;
      const r = box.getBoundingClientRect();
      if (!onScreenX(r)) continue;
      if (Math.min(r.width, r.height) >= cfg.minTouch - 0.5) continue;
      push(touchTargets, { el: describe(el), text: textOf(el) || el.getAttribute('aria-label') || '', value: `${Math.round(r.width)}x${Math.round(r.height)}` });
    }
  }

  // 7. The page title: how many lines, and whether a word is split across two.
  const main = document.querySelector('main');
  const heading = (main || document.body).querySelector<HTMLElement>('h1, h2');
  const title = { text: null as string | null, lines: 0, brokenWord: false, fontSize: null as number | null };
  if (heading && shown(heading)) {
    title.text = textOf(heading);
    title.fontSize = parseFloat(getComputedStyle(heading).fontSize);
    const tops = new Set<number>();
    const tw = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      const value = n.nodeValue || '';
      const wordRe = /\S+/g;
      for (let m = wordRe.exec(value); m; m = wordRe.exec(value)) {
        const range = document.createRange();
        range.setStart(n, m.index);
        range.setEnd(n, m.index + m[0].length);
        const rects = Array.from(range.getClientRects()).filter((x) => x.width > 0);
        const wordTops = new Set(rects.map((x) => Math.round(x.top)));
        if (wordTops.size > 1) title.brokenWord = true;
        for (const t of wordTops) tops.add(t);
      }
    }
    title.lines = tops.size;
  }

  const aside = document.querySelector('#tour-sidebar');
  const asideRect = aside ? aside.getBoundingClientRect() : null;
  const panel = Array.from(document.querySelectorAll('[role="dialog"]')).find((d) => d.querySelector('textarea'));
  const mainRect = main ? main.getBoundingClientRect() : null;
  const panelRect = panel ? panel.getBoundingClientRect() : null;
  // Beside the page (docked) if the panel and the content do not share any width.
  const beside = !!(panelRect && mainRect) && (panelRect.right <= mainRect.left + 1 || panelRect.left >= mainRect.right - 1);
  const shell = {
    sidebar: (!asideRect ? 'none' : !onScreenX(asideRect) || vw < 1024 ? 'drawer' : asideRect.width <= 100 ? 'collapsed' : 'open') as 'open' | 'collapsed' | 'drawer' | 'none',
    assistant: !panelRect ? 'closed' : vw < 640 ? 'sheet' : `${beside ? 'docked' : 'overlay'} ${Math.round(panelRect.width)}px`,
  };

  return {
    viewport: [vw, vh],
    mainWidth: mainRect ? Math.round(mainRect.width) : null,
    shell,
    horizontalScroll, overflow, crushedText, textOverlap, smallText, touchTargets, title,
  };
}

/** The checks a state fails, as short labels -- what "no failure" means in the acceptance criteria. */
export function failuresOf(r: LayoutReport): string[] {
  const out: string[] = [];
  if (r.horizontalScroll.fail) out.push(`horizontal scroll (${r.horizontalScroll.scrollWidth} > ${r.viewport[0]})`);
  if (r.overflow.count) out.push(`overflow x${r.overflow.count}`);
  if (r.crushedText.count) out.push(`a word a line x${r.crushedText.count}`);
  if (r.textOverlap.count) out.push(`text over text x${r.textOverlap.count}`);
  if (r.smallText.count) out.push(`text under ${MIN_TEXT_PX}px x${r.smallText.count}`);
  if (r.touchTargets.applies && r.touchTargets.count) out.push(`touch targets under ${MIN_TOUCH_PX}px x${r.touchTargets.count}`);
  if (r.title.brokenWord) out.push('title word split across lines');
  return out;
}
