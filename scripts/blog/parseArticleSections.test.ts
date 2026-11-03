import { test, expect } from 'vitest';
import { parseArticleSections } from './parseArticleSections';

test('first paragraph starting with "الجواب المختصر:" becomes the summary box', () => {
  const r = parseArticleSections('**الجواب المختصر:** هذا هو الملخص.\n\n## قسم\nنص.');
  expect(r.summaryHtml).toContain('هذا هو الملخص');
});

test('no summary paragraph leaves summaryHtml null', () => {
  const r = parseArticleSections('## قسم\nنص.');
  expect(r.summaryHtml).toBeNull();
});

test('each ## heading becomes a section with a stable slug id', () => {
  const r = parseArticleSections('## ليش المتابعة صعبة؟\nنص.\n\n## كيف تحل المشكلة؟\nنص آخر.');
  expect(r.sections.map(s => s.heading)).toEqual(['ليش المتابعة صعبة؟', 'كيف تحل المشكلة؟']);
  expect(r.sections[0].id).toBe('s1');
  expect(r.sections[1].id).toBe('s2');
});

test('"## وين تدخل منصة سين؟" is extracted separately, not left in sections, and carries no CTA markup', () => {
  const r = parseArticleSections('## وين تدخل منصة سين؟\nفي منصة سين كل طلب له موعد.\n\n## قسم عادي\nنص.');
  expect(r.whereSeenFitsHtml).toContain('كل طلب له موعد');
  expect(r.whereSeenFitsHtml).not.toMatch(/<a /);
  expect(r.sections.map(s => s.heading)).toEqual(['قسم عادي']);
});

test('a blockquote starting with "**عن منصة سين:**" becomes the about box', () => {
  const r = parseArticleSections('> **عن منصة سين:** منصة سعودية لتشغيل محلات التفصيل.\n\n## قسم\nنص.');
  expect(r.aboutSeenHtml).toContain('منصة سعودية');
});

test('"## أسئلة شائعة" with ### children becomes the faq list, and is excluded from sections', () => {
  const r = parseArticleSections('## أسئلة شائعة\n### سؤال أول؟\nجواب أول.\n### سؤال ثاني؟\nجواب ثاني.');
  expect(r.faq).toEqual([
    { question: 'سؤال أول؟', answerHtml: expect.stringContaining('جواب أول') },
    { question: 'سؤال ثاني؟', answerHtml: expect.stringContaining('جواب ثاني') },
  ]);
  expect(r.sections).toHaveLength(0);
});

test('no faq section leaves faq empty', () => {
  const r = parseArticleSections('## قسم\nنص.');
  expect(r.faq).toEqual([]);
});

test('"## اقرأ بعد" is dropped from sections (cards come from frontmatter.related, not this heading)', () => {
  const r = parseArticleSections('## اقرأ بعد\n\n## قسم عادي\nنص.');
  expect(r.sections.map(s => s.heading)).toEqual(['قسم عادي']);
});

test('a "## نموذج ..." heading is flagged isModel for print framing', () => {
  const r = parseArticleSections('## نموذج المراجعة الصباحية\n| عمود | عمود |\n|---|---|\n| قيمة | قيمة |');
  expect(r.sections[0].isModel).toBe(true);
  expect(r.sections[0].bodyHtml).toContain('<table');
});

test('a plain section is not flagged isModel', () => {
  const r = parseArticleSections('## قسم عادي\nنص.');
  expect(r.sections[0].isModel).toBe(false);
});

test('a trailing "تحرير: ..." line is stripped from the body', () => {
  const r = parseArticleSections('## قسم\nنص المقالة.\n\nتحرير: فلان، 2026-11-03');
  expect(r.sections[0].bodyHtml).not.toContain('تحرير:');
});
