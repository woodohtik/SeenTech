# مسودة: فقرة «مزودو الخدمة التقنية» — للعرض على المؤسس قبل النشر

`seen-sentry-setup-task.md` (البند 7.4). **لم تُعدَّل أي سياسة منشورة**: نص الموافقة القانونية لا يُعدَّل بدون موافقة المؤسس، وتغييره يعني رقم نسخة جديد (`TERMS_VERSION` / `PRIVACY_VERSION`) وموافقة جديدة من التجار.

## 1. سياسة الخصوصية للتجار (`src/legal/legalDocuments.ts`، قسم «Who processes data with us»)

اليوم القسم يذكر Sentry في سطر واحد بين المزودين. **الإضافة المقترحة** (فقرة بعد السطر الأول):

**بالعربي:**
> نستخدم خدمة Sentry لرصد الأخطاء التقنية في التطبيق، وبياناتها محفوظة في ألمانيا، خارج المملكة. ما يصلها بيانات تقنية فقط: نوع الخطأ، ومكانه في الكود، ونوع المتصفح، ورقم المحل والمستخدم كمعرّفات. ولا تستقبل أي بيانات شخصية لعملاء المحل: لا أسماء، ولا أرقام جوال، ولا مقاسات، ولا روابط متابعة الطلبات. ونحذف ذلك كله من الخطأ قبل إرساله.

**English:**
> We use Sentry to monitor technical errors in the app; its data is stored in Germany, outside Saudi Arabia. It receives technical data only: the kind of error, where it happened in the code, the browser type, and the shop's and user's IDs. It receives no personal data about the shop's customers -- no names, phone numbers, measurements or order-tracking links; these are removed from an error before it is sent.

**وسطر «Technical data»** في قسم «What we collect» يذكر عنوان IP. نقترح إضافة: «ولا نرسل عنوان IP لخدمة رصد الأخطاء».

## 2. سياسة تطبيق العميل (`public/privacy-customer.html`، قسم «أين تُخزَّن البيانات»)

**الإضافة المقترحة:**

**بالعربي:**
> نستخدم خدمة تقنية لرصد أخطاء التطبيق (Sentry، في ألمانيا). تصلها معلومات تقنية عن الخطأ ونوع جهازك فقط، بلا رقم جوالك ولا رمز التتبّع ولا أي بيان يعرّفك.

**English:**
> We use a technical service to monitor app errors (Sentry, in Germany). It receives technical information about the error and your device type only -- never your phone number, your tracking code or anything that identifies you.

## ما يحتاجه المؤسس

1. **يوافق على النص** أو يعدّله (ومعه المحامي، إن أراد).
2. **إن وافق:** نضيفه، ونرفع رقم نسخة سياسة الخصوصية في `src/legal/legalVersions.ts`، فيُطلب من التجار الموافقة من جديد.
