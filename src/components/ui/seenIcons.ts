/**
 * سين v5.1 (seen-design-system-v5.1-task.md بند 4): يحمّل الـ81 أيقونة في
 * design-system/icons/ (30 خاصة بسين تحت seen/، والباقي Tabler تحت
 * tabler/craft|money|orders|people) كنصوص SVG خام وقت البناء، مفهرسة
 * بالاسم (اسم الملف بدون الامتداد، بلا مجلد الفئة -- لا تعارض أسماء بين
 * المجلدات، تحقَّق منه فعلياً).
 *
 * كل ملف فعلياً stroke="currentColor" سلفاً (مطابق لمعيار DESIGN.md §8) --
 * محتوى SVG خام، لا مكوّنات React جاهزة، لأن المشروع لا يستخدم أي أداة
 * svgr/babel-plugin لتحويل SVG لمكوّنات (بلا اعتماد جديد عمداً) -- يُحقَن
 * مباشرة في الصفحة عبر Icon.tsx (seenIcon) باستخدام نفس نمط `?raw` المُستخدَم
 * فعلياً في المشروع لملفات أخرى (LandingPage.tsx).
 */

const modules = import.meta.glob('../../../design-system/icons/**/*.svg', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

const registry: Record<string, string> = {};
for (const [path, raw] of Object.entries(modules)) {
  const fileName = path.split('/').pop() ?? path;
  const name = fileName.replace(/\.svg$/, '');
  registry[name] = raw;
}

export const seenIconRegistry = registry;
export type SeenIconName = string;
