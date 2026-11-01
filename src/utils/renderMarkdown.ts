/**
 * renderMarkdown -- يحوّل محتوى Markdown (نص التدوينة المكتوب من قِبل
 * super-admin في `/admin/blog`) إلى HTML آمن لعرضه عبر
 * `dangerouslySetInnerHTML` في الصفحة العامة `/blog/:slug`.
 *
 * تاريخ المراجعات الأمنية/الأداء على هذا الملف (مهم لفهم الشكل الحالي):
 *
 * الجولة ١: التنفيذ الأول عطّل `Renderer.html` فقط (لتهريب وسوم HTML
 * خام داخل نص Markdown)، لكن ترك `Renderer.link`/`Renderer.image` على
 * سلوك `marked` الافتراضي، والذي لا يحجب مخططات (schemes) خطيرة مثل
 * `javascript:` في روابط/صور Markdown نفسها (`[نص](javascript:...)`,
 * autolinks, روابط مرجعية) -- ثغرة XSS حقيقية على صفحة عامة.
 *
 * الجولة ٢: أُضيف فحص يدوي (`isSafeUrl` + allowlist للمخططات)، لكنه
 * فكّك ترميزات النقطتين فقط (`&colon;`, `&#58;`, `&#x3a;`) ولا يفكّك
 * ترميز الأحرف نفسها -- فـ `&#106;avascript:alert(1)` (حيث `&#106;` =
 * حرف `j`) كان يلتف حول الفحص ويصبح رابطاً فعلياً عند تحليل المتصفح
 * لسمة `href`. هذا استبدل بـ DOMPurify (التي أشار إليها brief Task 5
 * أصلاً كحل احتياطي): `marked` بدون Renderer مخصّص، ثم تمرير الناتج
 * عبر `DOMPurify.sanitize()`.
 *
 * الجولة ٣ (هنا): التنفيذ الذي استبدل DOMPurify كان يُنشئ نافذة jsdom
 * صريحة (`new JSDOM('')`) ويمرّرها لـ `createDOMPurify(window)` لأن
 * بيئة اختبارات Vitest الافتراضية هي `environment: 'node'` (بلا
 * `window` عالمي). لكن هذا الملف يُستورد من `BlogPost.tsx` (صفحة
 * عامة تُحمَّل في المتصفح)، فانتهى الأمر بتضمين حزمة `jsdom` بالكامل
 * (التي تعتمد على واجهات Node داخلية حقيقية لا تعمل في المتصفح أصلاً)
 * في حزمة JS الخاصة بالعميل -- jsdom رفعت حجم chunk الصفحة إلى ~3.2MB
 * (أضخم حزمة في كل التطبيق بفارق كبير)، مع خطر حقيقي أنها لا تعمل
 * أصلاً عند التشغيل في متصفح فعلي.
 *
 * الحل: `dompurify` يُلحق نفسه تلقائياً بـ `window` العالمي عند وجوده
 * (true في كل متصفح حقيقي) -- لا حاجة لإنشاء نافذة jsdom يدوياً هنا
 * إطلاقاً. بيئة الاختبار توفَّر عبر pragma `// @vitest-environment
 * jsdom` في ملف الاختبار نفسه (`renderMarkdown.test.ts`)، بنفس الأسلوب
 * المُستخدم فعلاً في `src/hooks/useMeasurementUnit.test.ts` لهذا
 * المشروع -- فتضبطها Vitest، لا هذا الملف الذي يبقى بلا أي استيراد لـ
 * `jsdom`.
 */

import { marked } from 'marked';
import DOMPurify from 'dompurify';

/** يحوّل نص Markdown إلى HTML مُطهَّر عبر DOMPurify، جاهز لـ dangerouslySetInnerHTML. */
export function renderMarkdown(content: string): string {
  if (!content) return '';
  const html = marked.parse(content, { async: false });
  if (typeof html !== 'string') return '';
  return DOMPurify.sanitize(html);
}
