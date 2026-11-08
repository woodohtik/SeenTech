import { test, expect } from 'vitest';
import { parseArticleSections } from './parseArticleSections';

test('first paragraph starting with "الجواب المختصر:" becomes the summary box', async () => {
  const r = await parseArticleSections('**الجواب المختصر:** هذا هو الملخص.\n\n## قسم\nنص.');
  expect(r.summaryHtml).toContain('هذا هو الملخص');
});

test('no summary paragraph leaves summaryHtml null', async () => {
  const r = await parseArticleSections('## قسم\nنص.');
  expect(r.summaryHtml).toBeNull();
});

test('each ## heading becomes a section with a stable slug id', async () => {
  const r = await parseArticleSections('## ليش المتابعة صعبة؟\nنص.\n\n## كيف تحل المشكلة؟\nنص آخر.');
  expect(r.sections.map(s => s.heading)).toEqual(['ليش المتابعة صعبة؟', 'كيف تحل المشكلة؟']);
  expect(r.sections[0].id).toBe('s1');
  expect(r.sections[1].id).toBe('s2');
});

test('"## وين تدخل منصة سين؟" is extracted separately, not left in sections, and carries no CTA markup', async () => {
  const r = await parseArticleSections('## وين تدخل منصة سين؟\nفي منصة سين كل طلب له موعد.\n\n## قسم عادي\nنص.');
  expect(r.whereSeenFitsHtml).toContain('كل طلب له موعد');
  expect(r.whereSeenFitsHtml).not.toMatch(/<a /);
  expect(r.sections.map(s => s.heading)).toEqual(['قسم عادي']);
});

test('a blockquote starting with "**عن منصة سين:**" becomes the about box', async () => {
  const r = await parseArticleSections('> **عن منصة سين:** منصة سعودية لتشغيل محلات التفصيل.\n\n## قسم\nنص.');
  expect(r.aboutSeenHtml).toContain('منصة سعودية');
});

test('the about box is extracted even when it appears after the last section, not just in the preamble', async () => {
  const r = await parseArticleSections('## قسم\nنص القسم.\n\n> **عن منصة سين:** منصة سعودية لتشغيل محلات التفصيل.');
  expect(r.aboutSeenHtml).toContain('منصة سعودية');
  expect(r.sections[0].bodyHtml).not.toContain('عن منصة سين');
});

test('leading text before the summary/about boxes and the first heading is rendered as leadingHtml, not dropped', async () => {
  const r = await parseArticleSections('نص مقدمة عادي قبل أي شيء.\n\n## قسم\nنص.');
  expect(r.leadingHtml).toContain('نص مقدمة عادي');
});

test('no leftover preamble text leaves leadingHtml null', async () => {
  const r = await parseArticleSections('## قسم\nنص.');
  expect(r.leadingHtml).toBeNull();
});

test('"## أسئلة شائعة" with ### children becomes the faq list, and is excluded from sections', async () => {
  const r = await parseArticleSections('## أسئلة شائعة\n### سؤال أول؟\nجواب أول.\n### سؤال ثاني؟\nجواب ثاني.');
  expect(r.faq).toEqual([
    { question: 'سؤال أول؟', answerHtml: expect.stringContaining('جواب أول') },
    { question: 'سؤال ثاني؟', answerHtml: expect.stringContaining('جواب ثاني') },
  ]);
  expect(r.sections).toHaveLength(0);
});

test('no faq section leaves faq empty', async () => {
  const r = await parseArticleSections('## قسم\nنص.');
  expect(r.faq).toEqual([]);
});

test('"## اقرأ بعد" is dropped from sections (cards come from frontmatter.related, not this heading)', async () => {
  const r = await parseArticleSections('## اقرأ بعد\n\n## قسم عادي\nنص.');
  expect(r.sections.map(s => s.heading)).toEqual(['قسم عادي']);
});

test('a "## نموذج ..." heading is flagged isModel for print framing', async () => {
  const r = await parseArticleSections('## نموذج المراجعة الصباحية\n| عمود | عمود |\n|---|---|\n| قيمة | قيمة |');
  expect(r.sections[0].isModel).toBe(true);
  expect(r.sections[0].bodyHtml).toContain('<table');
});

test('a plain section is not flagged isModel', async () => {
  const r = await parseArticleSections('## قسم عادي\nنص.');
  expect(r.sections[0].isModel).toBe(false);
});

test('a trailing "تحرير: ..." line is stripped from the body and captured as editedBy', async () => {
  const r = await parseArticleSections('## قسم\nنص المقالة.\n\nتحرير: فلان، 2026-11-03');
  expect(r.sections[0].bodyHtml).not.toContain('تحرير:');
  expect(r.editedBy).toBe('فلان، 2026-11-03');
});

test('no "تحرير:" line leaves editedBy null', async () => {
  const r = await parseArticleSections('## قسم\nنص.');
  expect(r.editedBy).toBeNull();
});
