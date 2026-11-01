/**
 * renderMarkdown -- يحوّل محتوى Markdown (نص التدوينة المكتوب من قِبل
 * super-admin في `/admin/blog`) إلى HTML آمن لعرضه عبر
 * `dangerouslySetInnerHTML` في الصفحة العامة `/blog/:slug`.
 *
 * تاريخ المراجعات الأمنية على هذا الملف (مهم لفهم سبب الاعتماد على
 * DOMPurify بدلاً من حلّ مخصّص):
 *
 * الجولة ١: التنفيذ الأول عطّل `Renderer.html` فقط (لتهريب وسوم HTML
 * خام داخل نص Markdown)، لكن ترك `Renderer.link`/`Renderer.image` على
 * سلوك `marked` الافتراضي، والذي لا يحجب مخططات (schemes) خطيرة مثل
 * `javascript:` في روابط/صور Markdown نفسها (`[نص](javascript:...)`,
 * autolinks, روابط مرجعية) -- ثغرة XSS حقيقية على صفحة عامة.
 *
 * الجولة ٢: أُضيف فحص يدوي (`isSafeUrl` + allowlist للمخططات) داخل
 * `Renderer.link`/`Renderer.image` مخصّصين. لكن هذا الفحص يتحقق من
 * المخطط عبر regex بعد تفكيك ترميزات النقطتين فقط (`&colon;`,
 * `&#58;`, `&#x3a;`) -- ولا يفكّك ترميز الأحرف نفسها. فمثلاً
 * `&#106;avascript:alert(1)` (حيث `&#106;` = حرف `j` بترميز HTML)
 * يبدأ بـ `&` لا بحرف، فيفشل regex المخطط ويُعامَل كرابط نسبي "آمن"
 * خطأً -- بينما المتصفح يُفكّك `&#106;` إلى `j` أثناء تحليل سمة
 * `href` فيصبح رابطاً فعلياً قابلاً للنقر. هذا أظهر أن محاولة إعادة
 * تطبيق فحص URL يدوياً عرضة لعدد غير محدود من أشكال التمويه (كيانات
 * مسمّاة/عشرية/سداسية عشرية، وتفاوت المتصفحات في قبول صيغ ناقصة/غير
 * صحيحة منها).
 *
 * الحل النهائي (هنا): التخلي عن أي فحص يدوي للمخطط، واستبداله
 * بـ DOMPurify -- وهي المكتبة التي أشار إليها brief Task 5 أصلاً
 * كحل احتياطي بالضبط لهذا السبب: تطهيرها لعناوين URL مُختبَر على نطاق
 * واسع ضد هذا الصنف الكامل من الالتفافات، بدلاً من إعادة اختراعه هنا.
 * نُستخدم `marked` الافتراضي (بلا Renderer مخصّص) لتحويل Markdown→HTML
 * خام، ثم نُمرّر الناتج عبر DOMPurify (مع نسخة DOM من jsdom، إذ لا
 * يوجد DOM حقيقي في Node) الذي يحذف وسوم `<script>` وأي href/src بمخطط
 * خطير بإعداداته الافتراضية -- لا نُخفّفها بـ ALLOWED_URI_REGEXP مخصّص.
 */

import { marked } from 'marked';
import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';

// DOMPurify يحتاج DOM حقيقياً ليعمل. في المتصفح يستخدم `window` العالمي
// تلقائياً؛ هنا (Node، بما فيها بيئة اختبارات Vitest التي تعمل بـ
// environment: 'node') ننشئ نافذة jsdom فارغة مرة واحدة ونُمرّرها صريحاً.
const purifyWindow = new JSDOM('').window;
const DOMPurify = createDOMPurify(purifyWindow as unknown as Window & typeof globalThis);

/** يحوّل نص Markdown إلى HTML مُطهَّر عبر DOMPurify، جاهز لـ dangerouslySetInnerHTML. */
export function renderMarkdown(content: string): string {
  if (!content) return '';
  const html = marked.parse(content, { async: false });
  if (typeof html !== 'string') return '';
  return DOMPurify.sanitize(html);
}
