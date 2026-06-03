# نظام الخياط الذكي (Smart Tailor System)

نظام كاشير سحابي (SaaS) متكامل للخياطين لإدارة العملاء والطلبات والقياسات، مع لوحة تحكم متقدمة للمشرف العام لمراقبة أداء المنصة والمشتركين.

## المميزات
- **لوحة تحكم المشرف العام:** إدارة طلبات الانضمام، تفعيل الاشتراكات، ومراقبة الإحصائيات العامة.
- **إدارة العملاء:** تسجيل بيانات العملاء وقياساتهم بدقة.
- **إدارة الطلبات:** تتبع حالة الطلبات من "قيد التنفيذ" إلى "تم التسليم".
- **إدارة المخزون:** تنبيهات عند نقص المواد والمستلزمات.
- **نظام الإشعارات:** تنبيهات فورية للطلبات الجديدة وحالات المخزون.

## المتطلبات التقنية
- **Node.js** (إصدار 18 أو أحدث)
- **Firebase** (Firestore & Authentication)
- **Vite** (كأداة بناء وتطوير)

## طريقة التشغيل محلياً

1. **تثبيت التبعيات:**
   ```bash
   npm install
   ```

2. **إعداد Firebase:**
   - قم بإنشاء مشروع جديد في [Firebase Console](https://console.firebase.google.com/).
   - قم بتفعيل **Firestore Database** و **Authentication** (Google Login).
   - انسخ إعدادات المشروع (Config) وضعها في ملف باسم `firebase-applet-config.json` في المجلد الرئيسي للمشروع بالتنسيق التالي:
     ```json
     {
       "apiKey": "YOUR_API_KEY",
       "authDomain": "YOUR_AUTH_DOMAIN",
       "projectId": "YOUR_PROJECT_ID",
       "storageBucket": "YOUR_STORAGE_BUCKET",
       "messagingSenderId": "YOUR_SENDER_ID",
       "appId": "YOUR_APP_ID",
       "firestoreDatabaseId": "(default)"
     }
     ```

3. **قواعد الحماية (Firestore Rules):**
   - انسخ المحتوى الموجود في ملف `firestore.rules` والصقه في تبويب **Rules** في Firestore Console.

4. **تشغيل المشروع:**
   ```bash
   npm run dev
   ```

## الرفع إلى GitHub
1. قم بإنشاء مستودع (Repository) جديد على GitHub.
2. اتبع الأوامر التالية في جهازك:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
   git push -u origin main
   ```

**ملاحظة:** تم استثناء ملف `firebase-applet-config.json` من الرفع التلقائي لحماية بياناتك السرية. تأكد من إضافته يدوياً في بيئات التشغيل الأخرى.
