# توسعة: دعم عدة مزوّدي ذكاء اصطناعي في "مساعد سين الذكي" (Multi-Provider Support)

> هذا الملف **يبني على** الملفات السابقة (`seen-smart-assistant-task.md`, `seen-smart-assistant-full-task.md`, `seen-smart-assistant-data-access-task.md`). لا تُعد كتابة ما سبق تنفيذه، بل وسّعه وعدّله حيث يلزم.

## 🎭 الدور
تصرف كـ **Senior AI Full-Stack Engineer** متخصص في:
- Vercel AI SDK ونمط الـ Provider Adapters (`@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/groq`, إلخ)
- تصميم أنظمة قابلة للتوسعة (Extensible Architecture)

---

## 🎯 الهدف
حاليًا الإعدادات تدعم مزوّدًا واحدًا فقط في كل مرة (`aiProvider: "openai" | "gemini"`). المطلوب تحويل النظام إلى **معمارية Provider Registry قابلة للتوسعة**، بحيث:
1. يستطيع السوبر أدمن تفعيل عدة مزوّدين معًا (OpenAI, Groq, Claude/Anthropic, Gemini، وأي مزوّد يُضاف مستقبلاً) — كل واحد بمفتاح API خاص به محفوظ بشكل منفصل.
2. يختار السوبر أدمن **المزوّد النشط حاليًا (Active Provider)** لمحادثات المستخدمين.
3. (اختياري لكن موصى به) يضبط **ترتيب احتياطي (Fallback Order)**: إذا فشل المزوّد النشط أو نفد حدّه (429)، ينتقل النظام تلقائيًا للمزوّد التالي في القائمة بدل توقف المساعد بالكامل.

---

## 1️⃣ تعديل نموذج البيانات (Data Model)

### أ) جدول جديد: بيانات اعتماد كل مزوّد على حدة
بدل مفتاح API واحد ثابت داخل `AssistantSettings`، أنشئ جدولًا منفصلًا:

```prisma
model AssistantProviderCredential {
  id              String   @id @default(cuid())
  providerKey     String   @unique   // "openai" | "groq" | "anthropic" | "gemini" | ... (قابل للتوسعة كنص وليس enum مغلق)
  apiKeyEncrypted String                // مشفّر دائمًا، لا يُعاد كاملاً للواجهة أبدًا
  isConfigured    Boolean  @default(false) // true فقط بعد إدخال مفتاح فعلي صالح
  lastTestedAt    DateTime?
  lastTestStatus  String?               // "success" | "failed" | null
  updatedAt       DateTime @updatedAt
  updatedBy       String?
}
```

### ب) تعديل `AssistantSettings` الحالي
```prisma
model AssistantSettings {
  id                String   @id @default(cuid())
  isEnabled         Boolean  @default(true)
  activeProvider    String   @default("groq")      // المزوّد المستخدم حاليًا فعليًا
  activeModel       String   @default("llama-3.3-70b-versatile")
  fallbackOrder     String[] @default([])          // مثال: ["groq", "gemini", "openai"] — فارغة يعني بدون Fallback
  systemPrompt      String   @db.Text
  temperature       Float    @default(0.7)
  maxTokens         Int      @default(500)
  dailyMessageLimit Int      @default(200)
  updatedAt         DateTime @updatedAt
  updatedBy         String?
}
```
احذف حقل `apiKeyEncrypted` و `aiProvider` و `modelName` القدامى من هذا الجدول (انتقلت لـ `AssistantProviderCredential` و `activeProvider`/`activeModel`)، واكتب Migration تنقل أي بيانات موجودة فعليًا قبل الحذف.

---

## 2️⃣ سجل المزوّدين (Provider Registry) — طبقة الكود المركزية

أنشئ ملف جديد `lib/ai/provider-registry.ts` يحتوي تعريفًا موحّدًا لكل مزوّد مدعوم:

```ts
export const PROVIDERS = {
  openai: {
    label: "OpenAI (ChatGPT)",
    sdkPackage: "@ai-sdk/openai",
    defaultModels: ["gpt-4o-mini", "gpt-4o"],
    createModel: (apiKey: string, modelName: string) => {
      const { createOpenAI } = require("@ai-sdk/openai");
      return createOpenAI({ apiKey })(modelName);
    },
  },
  groq: {
    label: "Groq",
    sdkPackage: "@ai-sdk/groq",
    defaultModels: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
    createModel: (apiKey: string, modelName: string) => {
      const { createGroq } = require("@ai-sdk/groq");
      return createGroq({ apiKey })(modelName);
    },
  },
  anthropic: {
    label: "Claude (Anthropic)",
    sdkPackage: "@ai-sdk/anthropic",
    defaultModels: ["claude-sonnet-4-6", "claude-haiku-4-5"],
    createModel: (apiKey: string, modelName: string) => {
      const { createAnthropic } = require("@ai-sdk/anthropic");
      return createAnthropic({ apiKey })(modelName);
    },
  },
  gemini: {
    label: "Google Gemini",
    sdkPackage: "@ai-sdk/google",
    defaultModels: ["gemini-2.5-flash", "gemini-2.5-flash-lite"],
    createModel: (apiKey: string, modelName: string) => {
      const { createGoogleGenerativeAI } = require("@ai-sdk/google");
      return createGoogleGenerativeAI({ apiKey })(modelName);
    },
  },
} as const;

export type ProviderKey = keyof typeof PROVIDERS;
```

**تنبيهات مهمة أثناء التنفيذ:**
- تحقّق أولاً من الحزم (`@ai-sdk/*`) المثبّتة فعليًا في `package.json`، وثبّت الناقص فقط (`npm install @ai-sdk/groq @ai-sdk/anthropic ...`) — لا تفترض أنها موجودة.
- لأسماء النماذج الفعلية (خاصة إصدارات Claude وGPT الحديثة)، لا تعتمد كليًا على القيم أعلاه كـ Source of Truth — تحقق من التوثيق الرسمي لكل مزوّد وقت التنفيذ لأن أسماء النماذج تتغيّر بسرعة.
- هذا التصميم قابل للتوسعة: إضافة مزوّد جديد مستقبلاً (Mistral, DeepSeek, إلخ) تعني فقط إضافة entry جديد في `PROVIDERS` دون لمس بقية الكود.

---

## 3️⃣ تحديث `app/api/chat/route.ts` — منطق الاختيار + Fallback

1. اقرأ `AssistantSettings` (`activeProvider`, `activeModel`, `fallbackOrder`, إلخ).
2. اقرأ من `AssistantProviderCredential` مفتاح المزوّد النشط (وفكّ تشفيره Server-side فقط).
3. أنشئ المزوّد عبر `PROVIDERS[activeProvider].createModel(apiKey, activeModel)`.
4. عند حدوث خطأ (خصوصًا 429 Rate Limit أو فشل مصادقة):
   - إن كانت `fallbackOrder` غير فارغة، جرّب المزوّد التالي في القائمة (بشرط أن يكون `isConfigured: true` له).
   - سجّل في الـ Audit Log أي تبديل تلقائي (أي مزوّد فشل، وأيهم استُخدم بدلاً منه) — هذا مهم جدًا ليعرف السوبر أدمن لاحقًا أن مزوّده الأساسي بدأ يواجه مشاكل.
   - إن فشلت كل المزوّدات في `fallbackOrder`، أرجع رسالة خطأ واضحة للمستخدم بدل تعليق الطلب.

---

## 4️⃣ تحديث صفحة إعدادات السوبر أدمن

### أ) قسم "مزوّدو الذكاء الاصطناعي" (جديد)
اعرض بطاقة (Card) لكل مزوّد من `PROVIDERS`، تحتوي:
- الاسم (OpenAI / Groq / Claude / Gemini).
- حقل مفتاح API (مخفي جزئيًا، لا يُعاد كاملاً — نفس قاعدة الأمان من الملف السابق: الحقل الفارغ عند الحفظ = "لم يتغيّر").
- زر **"اختبار الاتصال" (Test Connection)** يرسل رسالة تجريبية بسيطة للتحقق من صحة المفتاح، ويحدّث `lastTestedAt` و `lastTestStatus`.
- مؤشر حالة بصري (نقطة خضراء/حمراء) يعكس `isConfigured` و `lastTestStatus`.
- زر "تعيين كمزوّد نشط" (Set as Active) — يفعّل هذا المزوّد فعليًا للمحادثات.

### ب) قسم "الترتيب الاحتياطي (Fallback)" (جديد)
- قائمة قابلة لإعادة الترتيب بالسحب (Drag & Drop) أو Dropdowns مرقّمة، تسمح للسوبر أدمن بترتيب أولوية المزوّدين عند الفشل.
- تحذير واضح: يمكن فقط ترتيب مزوّدين تم تفعيلهم فعليًا (`isConfigured: true`).

### ج) اختيار النموذج (Model) لكل مزوّد نشط
- Dropdown بالنماذج المقترحة من `defaultModels`، مع خيار إدخال اسم نموذج مخصص يدويًا لمن يريد نموذجًا غير مدرج.

### د) تحديث الاختبار الحي (Live Preview) من الملف السابق
- عدّل صندوق الاختبار الحي ليستخدم المزوّد والنموذج المختارين حاليًا في الفورم (حتى قبل الحفظ)، بدل مزوّد ثابت.

---

## ✅ معايير القبول (Definition of Done)

- [ ] إضافة مزوّد جديد للنظام مستقبلاً تتطلب فقط تعديل `provider-registry.ts` (سطر واحد تقريبًا)، دون لمس منطق الـ API أو الواجهة.
- [ ] كل مزوّد له مفتاح API منفصل ومشفّر، ولا يظهر أي مفتاح كاملاً في أي استجابة API.
- [ ] تبديل "المزوّد النشط" من لوحة السوبر أدمن ينعكس فورًا على محادثات كل المستخدمين دون إعادة نشر.
- [ ] عند فشل المزوّد النشط (خطأ حقيقي أو Rate Limit)، ينتقل النظام تلقائيًا للمزوّد التالي في `fallbackOrder` إن وُجد، ويُسجَّل هذا التبديل في Audit Log.
- [ ] زر "اختبار الاتصال" يعمل فعليًا ويحدّث الحالة المعروضة بدقة.
- [ ] لا يمكن تفعيل مزوّد أو وضعه في `fallbackOrder` قبل أن يكون له مفتاح API صالح مُختبَر.
- [ ] الحقول الفارغة عند الحفظ لا تحذف مفاتيح API الموجودة مسبقًا.
- [ ] لا أخطاء TypeScript، والحزم الناقصة (`@ai-sdk/*`) مثبّتة بشكل صحيح.

---

## 📝 ملاحظة للتنفيذ
نفّذ بالترتيب التالي:
1. Migration لقاعدة البيانات (الجدول الجديد + تعديل `AssistantSettings`).
2. `lib/ai/provider-registry.ts`.
3. تحديث `api/chat/route.ts` (اختيار المزوّد + Fallback).
4. تحديث صفحة وفورم إعدادات السوبر أدمن (بطاقات المزوّدين + الترتيب الاحتياطي).
5. اختبار يدوي: فعّل مزوّدين، اجعل أحدهما "نشط"، جرّب محادثة، بدّل المزوّد النشط من الإعدادات، وتأكد أن التبديل ينعكس فورًا.

بعد كل خطوة، أعطِ ملخصًا مختصرًا لما تم قبل الانتقال للتالية.
