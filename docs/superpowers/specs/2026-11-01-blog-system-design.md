# نظام المدونة (Blog) — مواصفة

**الحالة:** معتمدة من المستخدم (محادثة عصف ذهني بتاريخ 2026-11-01) — جاهزة لخطة التنفيذ.

## الخلفية

التطبيق سوق متجر SaaS متعدد المستأجرين (سِين). صفحة الهبوط العامة (`src/components/LandingPage.html`) ملف HTML ثابت معزول داخل `<iframe srcDoc>` — **ليست** جزءاً من شجرة React، مع قناة تواصل ضيقة مع التطبيق الأساسي (`public/assets/landing-bridge.js`) تعترض أي ضغطة على رابط داخلي وتُرسل `postMessage({type:'NAVIGATE', path})` للتطبيق الأب. لوحة السوبر أدمن (`/admin/*`) لها 4 أدوار ثابتة فقط (`super_admin`, `support_tech`, `billing_admin`, `sales`) بلا نظام صلاحيات دقيق منفصل — الحماية عبر `RoleGuard allowedRoles={[...]}` في الواجهة، و RLS عبر دالة `app_is_super_admin()` الموجودة فعلاً في قاعدة البيانات.

**الهدف المعتمد من المستخدم:** مدونة تسويقية/SEO تُدار بالكامل من لوحة السوبر أدمن، يصل إليها `super_admin` فقط، تُعرض على صفحات React عامة حقيقية (قابلة للفهرسة من محركات البحث)، وصفحة الهبوط تربط إليها.

## القرارات المعتمدة

- **من يدير المدونة:** `super_admin` فقط. بقية الأدوار الثلاثة بلا وصول لـ`/admin/blog` إطلاقاً.
- **اللغة:** عربي فقط لكل المقالات (لا حقول متعددة اللغات).
- **لا تصنيفات/وسوم/جدولة نشر مستقبلية** في هذه النسخة — مسودة/منشور فقط.
- **المعمارية:** صفحات React حقيقية خارج الـ iframe (`/blog`, `/blog/:slug`)، مسجَّلة كمسارات عامة بلا مصادقة (نفس نمط `/track/:token` الحالي)، لا داخل HTML الثابت. صفحة الهبوط تضيف رابطاً عادياً `<a href="/blog">` يُعترَض تلقائياً بواسطة `landing-bridge.js` الموجود فعلاً — لا حاجة لأي تعديل جافاسكريبت في صفحة الهبوط.
- **طبقة البيانات:** استدعاء Supabase مباشرة من الواجهة (قراءة وكتابة)، محمي بـRLS — يطابق نمط `SaaSTeamManagement.tsx` الفعلي لشاشات السوبر أدمن (**ليس** عبر نقاط نهاية جديدة في `server.ts`؛ هذا النمط الأخير محجوز فعلياً فقط للعمليات التي تتطلب صلاحية service-role، وهو غير مطلوب هنا).
- **صورة الغلاف:** رفع حقيقي لـSupabase Storage عبر `uploadImageToSupabase()` الموجودة فعلاً، بنفس نمط `ProductImageUploader.tsx` (ضغط الصورة أولاً، ثم رفع، مع احتياط base64 عند فشل الرفع — سلوك الدالة الحالي، لا تعديل عليه).
- **المحتوى:** Markdown كنص خام (عمود `content` نصي)، يُعرَض كـHTML بصفحة المقال عبر مكتبة تحويل Markdown.

## 1) طبقة البيانات

### مايجريشن جديد `supabase/migrations/20261108000000_blog_posts_table.sql`

```sql
CREATE TABLE blog_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  excerpt text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  cover_image_url text,
  meta_title text,
  meta_description text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX blog_posts_slug_idx ON blog_posts (slug);
CREATE INDEX blog_posts_status_published_idx ON blog_posts (status, published_at DESC);

ALTER TABLE blog_posts ENABLE ROW LEVEL SECURITY;

-- القراءة العامة: فقط المقالات المنشورة، لأي زائر غير مُصادَق (anon)
CREATE POLICY blog_posts_public_read ON blog_posts
  FOR SELECT TO anon
  USING (status = 'published');

-- السوبر أدمن: كل العمليات على كل الصفوف (يشمل المسودات)
-- app_is_super_admin() موجودة فعلاً (supabase/migrations/20260917080000_track_remaining_rls_patches.sql)
CREATE POLICY blog_posts_admin_all ON blog_posts
  FOR ALL
  USING (app_is_super_admin())
  WITH CHECK (app_is_super_admin());
```

ملاحظة: مستخدمو التطبيق العاديون (تجار/موظفون مصادَقون لكن ليسوا super_admin) لا تنطبق عليهم أي من السياستين أعلاه، فتُرفَض قراءتهم/كتابتهم تلقائياً — هذا مقصود ومطابق لمتطلب "لا يصل إلا من لديه الصلاحية".

### `src/services/blogService.ts` (جديد)

طبقة خدمة رفيعة فوق استدعاءات Supabase المباشرة، تطابق نمط `categoryService.ts`/`inventoryService.ts` الموجودين — لا منطق خادم جديد، فقط تجميع الاستعلامات:

```ts
export interface BlogPost {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  coverImageUrl: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  status: 'draft' | 'published';
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** عامة: قائمة المقالات المنشورة فقط، الأحدث أولاً. */
export function listPublishedPosts(page: number, pageSize: number): Promise<{ posts: BlogPost[]; total: number }>;

/** عامة: مقال واحد منشور حسب الرابط، أو null إن لم يوجد/غير منشور. */
export function getPublishedPostBySlug(slug: string): Promise<BlogPost | null>;

/** سوبر أدمن فقط (محمي بـRLS، لا تحقق إضافي بالواجهة مطلوب هنا): كل المقالات. */
export function listAllPostsForAdmin(): Promise<BlogPost[]>;

export function createPost(input: Omit<BlogPost, 'id' | 'createdAt' | 'updatedAt'>): Promise<BlogPost>;
export function updatePost(id: string, patch: Partial<Omit<BlogPost, 'id' | 'createdAt'>>): Promise<BlogPost>;
export function deletePost(id: string): Promise<void>;
```

### `src/utils/slugify.ts` (جديد)

العناوين عربية بالكامل — الرابط (`slug`) يبقى بأحرف عربية (شائع ومفيد لـSEO بالمحتوى العربي)، لا تحويل لحروف لاتينية:

```ts
/** يحوّل عنواناً عربياً لرابط: يحذف علامات الترقيم والمسافات الزائدة،
 *  يستبدل المسافات بشرطات، يُبقي الحروف العربية/اللاتينية/الأرقام فقط. */
export function slugify(title: string): string;
```

التفرّد (uniqueness) يُفحَص عند الحفظ عبر محاولة إدراج واصطياد خطأ انتهاك القيد الفريد (`UNIQUE` على `slug`)، وعرض رسالة للمستخدم لتعديل الرابط يدوياً — لا حاجة لفحص استباقي منفصل.

## 2) شاشة إدارة المدونة بالسوبر أدمن

### مسار جديد `/admin/blog` في `App.tsx` (داخل شجرة `/admin/*` الموجودة، أسطر 587-676)

```tsx
<Route path="blog" element={
  <RouteBoundary><RoleGuard allowedRoles={['super_admin']}><AdminBlog /></RoleGuard></RouteBoundary>
} />
```

### `src/components/AdminBlog.tsx` (جديد)

يتبع هيكل `SaaSTeamManagement.tsx` حرفياً: `useState` لقائمة المقالات/التحميل/نافذة الإضافة-التعديل، `useEffect` يستدعي `listAllPostsForAdmin()`، نافذة منبثقة (`AnimatePresence`) للإضافة/التعديل، حقول النموذج بمكوّنات `IconInput` الموجودة.

**قائمة المقالات:** جدول/بطاقات (عنوان، شارة الحالة مسودة/منشور، تاريخ آخر تعديل)، زر "مقال جديد"، لكل صف: تعديل، حذف (تأكيد عبر `useConfirm` الموجود)، تبديل سريع مسودة↔منشور.

**نموذج الإضافة/التعديل:**
- العنوان → عند التغيير (إن كان الرابط فارغاً أو لم يُعدَّل يدوياً بعد) يُولَّد الرابط تلقائياً عبر `slugify()`؛ حقل الرابط نفسه قابل للتعديل اليدوي بعدها.
- الملخص (textarea قصير).
- المحتوى (textarea كبير، Markdown خام — بدون معاينة حيّة في v1، تبسيطاً).
- صورة الغلاف: نفس مكوّن الرفع في `ProductImageUploader.tsx` (`uploadImageToSupabase(file, 'blog')`).
- عنوان/وصف SEO (حقلان اختياريان، نص توضيحي "إن تُركا فارغين، يُستخدم العنوان/الملخص تلقائياً").
- تبديل الحالة (مسودة/منشور) — عند التحويل لمنشور أول مرة، `published_at` يُضبَط لوقت الحفظ الحالي إن كان فارغاً (لا يتغيّر بعدها حتى لو عُدِّل المقال لاحقاً).
- حفظ (`createPost`/`updatePost`) وحذف (`deletePost`، بتأكيد).

## 3) الصفحات العامة

### `src/pages/BlogList.tsx` + `src/pages/BlogPost.tsx` (جديدان)

مسجَّلان في `App.tsx` كمسارات عامة بلا مصادقة، بجانب `/track/:token` الموجود حالياً (أسطر 566-577)، **خارج** الشجرة المصادَقة (`App.tsx:845` يتطلب `user && isApproved`):

```tsx
{/* Public blog (no auth) */}
<Route path="/blog" element={<BlogList />} />
<Route path="/blog/:slug" element={<BlogPost />} />
```

استيراد كسول (lazy) بنفس نمط `const X = React.lazy(() => import('./pages/X'));` الموجود للصفحات العامة الأخرى.

**`BlogList.tsx`:** يستدعي `listPublishedPosts(page, pageSize)`، يعرض بطاقات (صورة مصغّرة، عنوان، ملخص، تاريخ)، ترقيم صفحات بسيط (`pageSize = 10`).

**`BlogPost.tsx`:** يستدعي `getPublishedPostBySlug(slug)`؛ مقال غير موجود/غير منشور → صفحة "غير موجود" بسيطة (ليس خطأ 500). يحوّل `content` (Markdown) لـHTML عبر مكتبة تحويل — لا مكتبة Markdown موجودة بالمشروع حالياً (فحص `package.json` قبل الإضافة)؛ تُضاف واحدة خفيفة (مثل `marked`) إن لزم. المكتبة المختارة يجب أن تُفعِّل تعقيم/هروب HTML الخام افتراضياً (المحتوى من `super_admin` موثوق، لكن لا داعٍ لفتح باب حقن HTML/سكربت بلا داعٍ) — لا `dangerouslySetInnerHTML` لمخرجات غير مُعقَّمة. (لا مكتبة إدارة head tags موجودة بالمشروع — `react-helmet`/`react-helmet-async` غير مثبّتتين؛ ضبط `document.title` ووسم `meta[name=description]` يدوياً داخل `useEffect`، مع استعادة القيمة الافتراضية عند تفكيك المكوّن):

```ts
useEffect(() => {
  const prevTitle = document.title;
  document.title = post.metaTitle || post.title;
  let meta = document.querySelector('meta[name="description"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'description');
    document.head.appendChild(meta);
  }
  const prevContent = meta.getAttribute('content');
  meta.setAttribute('content', post.metaDescription || post.excerpt);
  return () => {
    document.title = prevTitle;
    if (prevContent !== null) meta!.setAttribute('content', prevContent);
  };
}, [post]);
```

## 4) ربط صفحة الهبوط

تعديل وحيد على `src/components/LandingPage.html`: إضافة `<a href="/blog" target="_parent">المدونة</a>` داخل القائمة الرئيسية (`<nav class="nav" id="nav">`، السطر ~227) **وأيضاً** داخل التذييل (السطر ~955) — `landing-bridge.js` الموجود فعلاً (مُعترِض نقر عام على أي `<a href="/...">`) يتولى التنقل تلقائياً، **بدون أي تعديل جافاسكريبت جديد**.

## خارج النطاق (بالاتفاق مع المستخدم)

- تصنيفات/وسوم للمقالات.
- جدولة نشر بتاريخ مستقبلي.
- دعم لغات أخرى للمقالات (الأردو/الإنجليزي).
- دور/صلاحية إدارة مدونة منفصلة عن `super_admin` (مثل `content_editor`).
- محرر Markdown بمعاينة حيّة (WYSIWYG) — textarea خام فقط في v1.
- تعليقات القراء، مشاركة اجتماعية، اشتراك بريدي.
