import { marked } from 'marked';

export interface FaqItem {
  question: string;
  answerHtml: string;
}

export interface ParsedSection {
  id: string;
  heading: string;
  bodyHtml: string;
  isModel: boolean;
}

export interface ParsedArticle {
  summaryHtml: string | null;
  leadingHtml: string | null;
  sections: ParsedSection[];
  whereSeenFitsHtml: string | null;
  aboutSeenHtml: string | null;
  faq: FaqItem[];
  editedBy: string | null;
}

const WHERE_SEEN_FITS_HEADING = 'وين تدخل منصة سين؟';
const FAQ_HEADING = 'أسئلة شائعة';
const READ_NEXT_HEADING = 'اقرأ بعد';

function renderMd(src: string): string {
  const html = marked.parse(src.trim(), { async: false });
  return typeof html === 'string' ? html : '';
}

function extractEditedByLine(body: string): { editedBy: string | null; rest: string } {
  const match = body.match(/^تحرير:\s*(.*)$/m);
  if (!match) return { editedBy: null, rest: body };
  return { editedBy: match[1].trim(), rest: body.replace(match[0], '').trim() };
}

function extractLeadingParagraph(text: string, prefix: string): { match: string | null; rest: string } {
  const paragraphs = text.split(/\n\s*\n/);
  const idx = paragraphs.findIndex(p => p.trim().startsWith(prefix));
  if (idx === -1) return { match: null, rest: text };
  const match = paragraphs[idx];
  const rest = paragraphs.filter((_, i) => i !== idx).join('\n\n');
  return { match, rest };
}

function stripBoldPrefix(paragraph: string, label: string): string {
  // e.g. "**الجواب المختصر:** نص" -> "نص"
  return paragraph.replace(new RegExp(`^\\*\\*${label}:?\\*\\*\\s*`), '').trim();
}

export function parseArticleSections(markdownBody: string): ParsedArticle {
  const { editedBy, rest: afterByline } = extractEditedByLine(markdownBody);

  // The about-Seen box can sit anywhere in the article (commonly near the
  // end, not only before the first heading) -- search the WHOLE body, not
  // just the preamble, so it isn't silently absorbed into whatever
  // section or FAQ answer happens to precede it. extractLeadingParagraph
  // splits purely on blank-line paragraph boundaries, so this is safe to
  // run before the heading split below: removing one matched paragraph
  // leaves every "## heading" line and surrounding content untouched.
  const aboutExtract = extractLeadingParagraph(afterByline, '> **عن منصة سين:**');
  const aboutSeenHtml = aboutExtract.match
    ? renderMd(aboutExtract.match.replace(/^>\s*/m, '').replace(/^\*\*عن منصة سين:?\*\*\s*/, ''))
    : null;
  const body = aboutExtract.rest;

  const firstHeadingMatch = body.match(/^## .+$/m);
  const splitIndex = firstHeadingMatch?.index ?? body.length;
  let preamble = body.slice(0, splitIndex);
  const rest = body.slice(splitIndex);

  const summaryExtract = extractLeadingParagraph(preamble, '**الجواب المختصر:**');
  preamble = summaryExtract.rest;
  const summaryHtml = summaryExtract.match ? renderMd(stripBoldPrefix(summaryExtract.match, 'الجواب المختصر')) : null;

  // Whatever preamble text is left (not the summary box, not a heading) was
  // previously computed and then silently dropped -- render and return it
  // instead of discarding real article content.
  const leadingHtml = preamble.trim() ? renderMd(preamble) : null;

  // Split the remainder into blocks per "## heading" occurrence.
  const blocks: { heading: string; content: string }[] = [];
  const headingRe = /^## (.+)$/gm;
  let match: RegExpExecArray | null;
  const positions: { heading: string; start: number }[] = [];
  while ((match = headingRe.exec(rest)) !== null) {
    positions.push({ heading: match[1].trim(), start: match.index + match[0].length });
  }
  for (let i = 0; i < positions.length; i++) {
    const end = i + 1 < positions.length ? rest.indexOf('\n## ', positions[i].start) : -1;
    const content = (end === -1 ? rest.slice(positions[i].start) : rest.slice(positions[i].start, end)).trim();
    blocks.push({ heading: positions[i].heading, content });
  }

  const sections: ParsedSection[] = [];
  let whereSeenFitsHtml: string | null = null;
  let faq: FaqItem[] = [];

  for (const block of blocks) {
    if (block.heading === WHERE_SEEN_FITS_HEADING) {
      whereSeenFitsHtml = renderMd(block.content);
      continue;
    }
    if (block.heading === FAQ_HEADING) {
      faq = parseFaqBlock(block.content);
      continue;
    }
    if (block.heading === READ_NEXT_HEADING) {
      continue;
    }
    sections.push({
      id: `s${sections.length + 1}`,
      heading: block.heading,
      bodyHtml: renderMd(block.content),
      isModel: block.heading.startsWith('نموذج '),
    });
  }

  return { summaryHtml, leadingHtml, sections, whereSeenFitsHtml, aboutSeenHtml, faq, editedBy };
}

function parseFaqBlock(content: string): FaqItem[] {
  const items: FaqItem[] = [];
  const headingRe = /^### (.+)$/gm;
  const positions: { question: string; start: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = headingRe.exec(content)) !== null) {
    positions.push({ question: match[1].trim(), start: match.index + match[0].length });
  }
  for (let i = 0; i < positions.length; i++) {
    const end = i + 1 < positions.length ? content.indexOf('\n### ', positions[i].start) : -1;
    const answer = (end === -1 ? content.slice(positions[i].start) : content.slice(positions[i].start, end)).trim();
    items.push({ question: positions[i].question, answerHtml: renderMd(answer) });
  }
  return items;
}
