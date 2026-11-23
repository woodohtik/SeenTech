# مراجعة الملفات المعدّلة

مهمة `seen-responsive-layout-task.md`، معيار القبول 1.2: مراجعة الملفات الأساسية التي تغيّرت بـ`web-design-guidelines` (قواعد Vercel، 104 قاعدة، جُلبت 2026-11-23) و`design:accessibility-review` (WCAG 2.1 AA).

الملاحظات التي ظهرت أُصلحت في نفس الفرع، إلا ما ذُكر تحت «باقٍ».

## web-design-guidelines

## src/lib/shellLayout.ts
✓ pass

## src/hooks/useShellLayout.ts
✓ pass — القرار يُشتق أثناء الرسم (لا قراءة تخطيط أثناء الرسم: `innerWidth` في `useSyncExternalStore`)، و`ResizeObserver` يكتب السمة فقط (قاعدة 51 و52).

## src/components/Layout.tsx
- `Layout.tsx` (الجذر) — كان `transition-all` → صار `transition-[padding]` ويُلغى مع `prefers-reduced-motion` (قاعدة 31 و29). **أُصلح.**
- زر طي القائمة بلا `aria-label` → اسم وحالة `aria-expanded` (قاعدة 1). **أُصلح.**
- زر القائمة في شريط الجوال وزر إغلاق الدرج بلا اسم (قاعدة 1، 100). **أُصلح.**
- روابط القائمة المطوية: التلميح يظهر بالمرور فقط → يظهر عند التركيز أيضاً، والرابط يحمل اسمه (قاعدة 13). **أُصلح.**

## src/components/SeenAIFab.tsx · src/components/assistant/AssistantPanel.tsx
- المساعد الطافي يغطي الصفحة بغطاء بينما Tab يصل لما خلفه (WCAG 2.4.3) → `aria-modal` وحبس التركيز وEscape والغطاء يغلق. **أُصلح.**
✓ الحركة `transform` فقط وتُلغى مع `prefers-reduced-motion` (قاعدة 29، 30).

## src/components/ui/PageHeader.tsx
✓ pass — `text-wrap: balance` على العنوان (قاعدة 42)، `min-w-0` (قاعدة 44).

## src/components/ui/StatCard.tsx · src/components/DashboardGridCard.tsx
- بطاقات الأرقام في لوحة التحكم كانت `motion.div` بـ`onClick` → صارت `<button type="button">` (قاعدة 4، 96). **أُصلح.**
- الأرقام `tabular-nums` (قاعدة 41)، `min-w-0` في كل صف (قاعدة 44)، التسمية `line-clamp-2` (قاعدة 43).
- شارة «نشط» 4.3:1 و«-66.7%» 4.1:1 على خلفية 10% → ألوان الحالة في DESIGN.md (4.55:1 و5.34:1). **أُصلح.**

## src/components/ui/ResponsiveTable.tsx
✓ pass — منطقة التمرير لها اسم و`tabIndex={0}` وحلقة تركيز.

## src/components/ui/Modal.tsx
- `transition-all` → `transition-[transform,opacity]` ويُلغى مع تقليل الحركة (قاعدة 30، 31). **أُصلح.**
- المحتوى يتمرر بـ`overscroll-contain` (قاعدة 64)، والارتفاع بـ`dvh`. **أُصلح.**

## src/components/ui/AutoGrid.tsx · src/components/ui/FormGrid.tsx
✓ pass

## src/components/UserPreferencesMenu.tsx · src/components/DashboardOwner.tsx
- زر قائمة الحساب (مطوي) وزر الإشعارات بلا اسم → `aria-label` و`aria-expanded` (قاعدة 1). **أُصلح.**

## src/index.css
- أهداف اللمس 48px على `pointer: coarse`. ✓
✓ لا `user-scalable=no` (قاعدة 91). `index.html` أضاف `interactive-widget=resizes-content` حتى لا تغطي لوحة المفاتيح صندوق الكتابة.

## accessibility-review (WCAG 2.1 AA)

| # | الملاحظة | المعيار | الخطورة | الحالة |
|---|---|---|---|---|
| 1 | المساعد الطافي غير حواري مع وجود غطاء | 2.4.3 ترتيب التركيز | عالية | أُصلح |
| 2 | أزرار أيقونية بلا اسم: طي القائمة، القائمة، إغلاق الدرج، الحساب، الإشعارات | 4.1.2 الاسم والدور | عالية | أُصلح |
| 3 | 1,700+ نص أصغر من 14px (حتى 8px) | 1.4.4 تكبير النص (وDESIGN.md) | متوسطة | أُصلح، والحارس يمنع عودته |
| 4 | تمرير أفقي ومحتوى يُقص عند 320px (إعادة التدفق) | 1.4.10 | متوسطة | أُصلح |
| 5 | أهداف لمس 32–40px على التابلت | 2.5.5 | متوسطة | أُصلح (48px على `pointer: coarse`) |
| 6 | شارات الحالة 4.1–4.3:1 | 1.4.3 التباين | متوسطة | أُصلح في المكونات الجديدة |
| 7 | تلميح القائمة المطوية بالمرور فقط | 1.4.13 / 2.1.1 | منخفضة | أُصلح |

## باقٍ (خارج نطاق العرض المرن، مسجَّل للمرحلة التالية)

- **ارتفاع سطر النص العربي:** `text-sm` في Tailwind سطره 1.43، وDESIGN.md ينص على 1.7 للمتن. تغييره عام يمس كل الشاشات، فيحتاج جولة لقطات خاصة به.
- **شارات حالة قديمة** داخل الشاشات (`bg-success/10 text-success` وأمثالها) ما زالت بتباين 4.1–4.3:1. المكونات الجديدة تستعمل ألوان DESIGN.md؛ نقل الباقي إليها مهمة توحيد مستقلة (كما في ملاحظة التدقيق 7: الزوايا والظلال).
- **لا رابط «تخطٍّ إلى المحتوى»** في الغلاف (قاعدة 9).
- **نوافذ مبنية يدوياً** (`fixed inset-0` داخل الشاشات) لا تحبس التركيز؛ نقلها إلى `ui/Modal` مستقل.
