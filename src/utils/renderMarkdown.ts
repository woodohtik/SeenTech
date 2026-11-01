/**
 * renderMarkdown -- يحوّل محتوى Markdown (نص التدوينة المكتوب من قِبل
 * super-admin في `/admin/blog`) إلى HTML آمن لعرضه عبر
 * `dangerouslySetInnerHTML` في الصفحة العامة `/blog/:slug`.
 *
 * ملاحظة أمنية مهمة: `marked` (v18 المُثبّتة هنا) لم تعد تملك خيار
 * `sanitize` (أُزيل منذ v1.0 -- التوثيق الرسمي يوصي باستخدام DOMPurify
 * بعد التحويل). بدلاً من إضافة تبعية DOMPurify (التي تحتاج DOM وتُعقّد
 * التشغيل تحت Vitest/Node)، نُعطّل تفسير HTML الخام تماماً عبر تخصيص
 * `Renderer.html` بحيث يُهرَّب (escape) أي وسم HTML خام موجود في مصدر
 * Markdown بدلاً من تمريره كما هو. هذا يمنع حقن `<script>` وأي وسم آخر
 * حتى لو كتبه super-admin نفسه عن طريق الخطأ أو عبر حساب مخترق.
 */

import { marked, Renderer } from 'marked';

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const safeRenderer = new Renderer();
// أي وسم HTML خام (كتلة أو inline) يُهرَّب بدلاً من تفسيره كـ markup حيّ.
safeRenderer.html = (token: { text: string }) => escapeHtml(token.text);

/** يحوّل نص Markdown إلى HTML مُطهَّر، جاهز لـ dangerouslySetInnerHTML. */
export function renderMarkdown(content: string): string {
  if (!content) return '';
  const html = marked.parse(content, { renderer: safeRenderer, async: false });
  return typeof html === 'string' ? html : '';
}
