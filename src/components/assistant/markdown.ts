/**
 * A small Markdown reader for the assistant's replies. It covers what the model
 * actually writes -- bold, numbered and bulleted lists, paragraphs, and links
 * to pages inside the app -- and returns plain data for React to render, so no
 * HTML string is ever injected. Anything it does not know is kept as text.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'link'; href: string; children: Inline[] };

export type Block =
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'heading'; children: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] };

/** Only paths inside the app become links; an outside URL stays plain text. */
export function isInternalHref(href: string): boolean {
  return /^\/(?!\/)[\w\-./?=&%#]*$/.test(href);
}

const LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/;
const STRONG = /(\*\*|__)(?=\S)([\s\S]*?\S)\1/;

export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let rest = source;

  const pushText = (text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.type === 'text') last.text += text;
    else out.push({ type: 'text', text });
  };

  while (rest) {
    const link = LINK.exec(rest);
    const strong = STRONG.exec(rest);
    const linkAt = link ? link.index : Infinity;
    const strongAt = strong ? strong.index : Infinity;

    if (linkAt === Infinity && strongAt === Infinity) {
      pushText(rest);
      break;
    }

    if (strongAt <= linkAt && strong) {
      pushText(rest.slice(0, strong.index));
      out.push({ type: 'strong', children: parseInline(strong[2]) });
      rest = rest.slice(strong.index + strong[0].length);
    } else if (link) {
      pushText(rest.slice(0, link.index));
      const [whole, label, href] = link;
      if (isInternalHref(href)) out.push({ type: 'link', href, children: parseInline(label) });
      else pushText(label);
      rest = rest.slice(link.index + whole.length);
    }
  }

  // Emphasis and code marks the model sometimes adds: keep the words, drop the marks.
  return out.map((node) =>
    node.type === 'text' ? { ...node, text: node.text.replace(/`([^`\n]+)`/g, '$1') } : node
  );
}

const ORDERED = /^\s*(\d+)[.)]\s+(.*)$/;
const BULLET = /^\s*[-*•]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ type: 'paragraph', children: parseInline(paragraph.join('\n')) });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push({ type: 'list', ordered: list.ordered, items: list.items.map(parseInline) });
      list = null;
    }
  };

  for (const rawLine of String(source ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trimEnd();

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    const ordered = ORDERED.exec(line);
    const bullet = ordered ? null : BULLET.exec(line);
    if (ordered || bullet) {
      flushParagraph();
      const isOrdered = Boolean(ordered);
      if (list && list.ordered !== isOrdered) flushList();
      if (!list) list = { ordered: isOrdered, items: [] };
      list.items.push((ordered ? ordered[2] : bullet![1]).trim());
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'heading', children: parseInline(heading[1].trim()) });
      continue;
    }

    // An indented line right under a list item continues that item.
    if (list && /^\s{2,}\S/.test(rawLine)) {
      list.items[list.items.length - 1] += ' ' + line.trim();
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();
  return blocks;
}

/** The reply as plain words, for copying and for the screen reader announcement. */
export function markdownToPlainText(source: string): string {
  const inlineText = (nodes: Inline[]): string =>
    nodes.map((n) => (n.type === 'text' ? n.text : inlineText(n.children))).join('');
  return parseMarkdown(source)
    .map((block) => {
      if (block.type === 'list') {
        return block.items.map((item, i) => `${block.ordered ? `${i + 1}.` : '•'} ${inlineText(item)}`).join('\n');
      }
      return inlineText(block.children);
    })
    .join('\n\n');
}
