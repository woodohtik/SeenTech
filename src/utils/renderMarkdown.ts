/**
 * renderMarkdown -- يحوّل محتوى Markdown (نص التدوينة المكتوب من قِبل
 * super-admin في `/admin/blog`) إلى HTML آمن لعرضه عبر
 * `dangerouslySetInnerHTML` في الصفحة العامة `/blog/:slug`.
 *
 * ملاحظة أمنية مهمة (١): `marked` (v18 المُثبّتة هنا) لم تعد تملك خيار
 * `sanitize` (أُزيل منذ v1.0 -- التوثيق الرسمي يوصي باستخدام DOMPurify
 * بعد التحويل). بدلاً من إضافة تبعية DOMPurify (التي تحتاج DOM وتُعقّد
 * التشغيل تحت Vitest/Node)، نُعطّل تفسير HTML الخام تماماً عبر تخصيص
 * `Renderer.html` بحيث يُهرَّب (escape) أي وسم HTML خام موجود في مصدر
 * Markdown بدلاً من تمريره كما هو. هذا يمنع حقن `<script>` وأي وسم آخر
 * حتى لو كتبه super-admin نفسه عن طريق الخطأ أو عبر حساب مخترق.
 *
 * ملاحظة أمنية مهمة (٢) -- ثغرة اكتُشفت في مراجعة الأمان لهذا الملف:
 * تعطيل `Renderer.html` لا يكفي وحده. `marked`'s الافتراضي لروابط/صور
 * Markdown (`[نص](رابط)`, `![alt](رابط)`, وحتى autolinks مثل
 * `<javascript:alert(1)>`) يمرّر الـ href/src كما هو بعد `encodeURI`
 * فقط -- لا يحجب مخططات (schemes) خطيرة مثل `javascript:` أو `data:`.
 * نتيجة ذلك: `[اضغط هنا](javascript:alert(document.cookie))` كان يُولّد
 * `<a href="javascript:alert(...)">` فعلياً قابلاً للنقر على صفحة عامة
 * بلا مصادقة (/blog/:slug) -- XSS حقيقي. لذلك نُخصّص أيضاً
 * `Renderer.link` و`Renderer.image` عبر `SafeRenderer` أدناه: نتحقق من
 * أمان الـ URL (allowlist: http/https/mailto/tel أو مسار نسبي بلا
 * مخطط) قبل تفويض التصيير إلى التنفيذ الافتراضي عبر `super`، وإلا
 * نُسقط الرابط/الصورة ونُبقي النص فقط.
 */

import { marked, Renderer } from 'marked';
import type { Tokens } from 'marked';

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** مخططات (schemes) مسموحة لروابط/صور Markdown. كل ما عداها (javascript:, data:, vbscript:, ...) يُرفض. */
const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/**
 * يتحقق أن الـ href/src آمن قبل تمريره كما هو إلى الناتج.
 * - بلا مخطط (رابط نسبي/مرجعي/fragment) → آمن.
 * - بمخطط ضمن ALLOWED_SCHEMES → آمن.
 * - أي شيء آخر → مرفوض.
 *
 * نُطبّع المدخل أولاً: نحذف المسافات/أحرف التحكم (المتصفحات تتجاوز
 * "java\tscript:" كمخطط صالح)، ونفكّك أشكال شائعة لترميز النقطتين
 * (&colon;, &#58;, &#x3a;) التي يمكن استخدامها للتمويه على الفحص.
 */
function isSafeUrl(href: string | null | undefined): boolean {
  if (!href) return false;
  const normalized = href
    .replace(/[\u0000- \u007F-\u009F]+/g, '')
    .replace(/&colon;|&#0*58;?|&#x0*3a;?/gi, ':')
    .toLowerCase();
  const schemeMatch = normalized.match(/^([a-z][a-z0-9+.-]*:)/);
  if (!schemeMatch) return true; // لا يوجد مخطط -- رابط نسبي أو fragment، آمن
  return ALLOWED_SCHEMES.has(schemeMatch[1]);
}

class SafeRenderer extends Renderer {
  html(token: Tokens.HTML | Tokens.Tag): string {
    return escapeHtml(token.text);
  }

  link(token: Tokens.Link): string {
    if (!isSafeUrl(token.href)) {
      // رابط بمخطط خطير -- نُبقي النص الظاهر فقط بلا وسم <a>.
      return token.autolink ? escapeHtml(token.text) : (this.parser.parseInline(token.tokens) as string);
    }
    return super.link(token) as string;
  }

  image(token: Tokens.Image): string {
    if (!isSafeUrl(token.href)) {
      // صورة بمخطط خطير -- نُبقي نص alt فقط بلا وسم <img>.
      return escapeHtml(token.text);
    }
    return super.image(token) as string;
  }
}

const safeRenderer = new SafeRenderer();

/** يحوّل نص Markdown إلى HTML مُطهَّر، جاهز لـ dangerouslySetInnerHTML. */
export function renderMarkdown(content: string): string {
  if (!content) return '';
  const html = marked.parse(content, { renderer: safeRenderer, async: false });
  return typeof html === 'string' ? html : '';
}
