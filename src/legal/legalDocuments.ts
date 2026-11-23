/**
 * seen-readiness-fixes-task.md P5 (PLATFORM-01; founder question 6): the
 * platform's privacy policy and terms of use, in the three interface
 * languages. DRAFTS -- every page says so until the founder's lawyer approves
 * the text; bump the versions when it changes, so a new acceptance is asked
 * for. Text in [brackets] is for the founder to fill in.
 */
export { TERMS_VERSION, PRIVACY_VERSION } from './legalVersions';

export type LegalLang = 'ar' | 'en' | 'ur';
export type LegalSection = { heading: string; paragraphs: string[] };
export type LegalDocument = { title: string; draftNotice: string; updated: string; sections: LegalSection[] };

const DRAFT = {
  ar: 'مسودة — تتطلب مراجعة قانونية. هذا النص لم يعتمده محامٍ بعد.',
  en: 'Draft — requires legal review. This text has not yet been approved by a lawyer.',
  ur: 'مسودہ — قانونی جائزہ درکار ہے۔ اس متن کی ابھی کسی وکیل نے منظوری نہیں دی۔',
};
const UPDATED = { ar: 'آخر تحديث: 23 نوفمبر 2026', en: 'Last updated: 23 November 2026', ur: 'آخری تازہ کاری: 23 نومبر 2026' };

export const PRIVACY: Record<LegalLang, LegalDocument> = {
  ar: {
    title: 'سياسة الخصوصية — منصة سِين', draftNotice: DRAFT.ar, updated: UPDATED.ar,
    sections: [
      { heading: 'من نحن', paragraphs: ['سِين منصة برمجية لإدارة محلات الخياطة والمحلات المشابهة: نقطة البيع والطلبات والعملاء والمخزون والفواتير. يشغّلها [الاسم القانوني للمنشأة، رقم السجل التجاري، العنوان].'] },
      { heading: 'دورنا ودور المحل', paragraphs: [
        'بيانات صاحب المحل وموظفيه: سِين هي المسؤولة عنها.',
        'بيانات عملاء المحل (الأسماء، أرقام الجوال، المقاسات، الطلبات، الفواتير): المحل هو المسؤول عنها، وسِين تعالجها نيابةً عنه فقط ولتقديم الخدمة له، ولا تستعملها لأي غرض آخر.',
      ] },
      { heading: 'البيانات التي نجمعها', paragraphs: [
        'بيانات الحساب: الاسم، البريد الإلكتروني، رقم الجوال، كلمة المرور (مشفّرة)، ورموز PIN للموظفين (مشفّرة).',
        'بيانات المحل: الاسم التجاري، الرقم الضريبي، السجل التجاري، العنوان، الفروع، الشعار.',
        'بيانات التشغيل: المبيعات، الطلبات، العملاء ومقاساتهم، المخزون، الورديات، المدفوعات، الفواتير الضريبية.',
        'بيانات تقنية: نوع الجهاز والمتصفح، عنوان IP، وسجلات الأخطاء.',
      ] },
      { heading: 'لماذا نستخدمها', paragraphs: ['لتقديم الخدمة وتشغيلها، وإصدار الفواتير وإرسالها لهيئة الزكاة والضريبة والجمارك عندما يربط المحل حسابه، والدعم الفني، وأمن المنصة ومنع إساءة الاستخدام، والفوترة الخاصة بالاشتراك.'] },
      { heading: 'الجهات التي تعالج البيانات معنا', paragraphs: [
        'Supabase (قاعدة البيانات وتسجيل الدخول)، Vercel (استضافة التطبيق)، Firebase من Google (الإشعارات الفورية)، Sentry (رصد الأخطاء)، ومزوّد الذكاء الاصطناعي الذي يشغّل المساعد الذكي (OpenAI أو Google Gemini) عند استخدامه.',
        'هيئة الزكاة والضريبة والجمارك (زاتكا): تُرسل إليها الفواتير الضريبية عندما يربط المحل حسابه بها.',
        'قد تُخزَّن بعض هذه البيانات خارج المملكة لدى هؤلاء المزوّدين. [يحدد المؤسس مع المحامي متطلبات نظام حماية البيانات الشخصية بشأن النقل خارج المملكة.]',
      ] },
      { heading: 'مدة الاحتفاظ', paragraphs: [
        'نحتفظ ببيانات المحل ما دام اشتراكه قائماً.',
        'الفواتير الضريبية تُحفظ المدة التي يفرضها النظام حتى بعد إغلاق الحساب. [يحدد المؤسس المدة النظامية مع المحامي.]',
        'عند حذف المحل يُتاح له تصدير بياناته قبل الحذف.',
      ] },
      { heading: 'حقوقك', paragraphs: ['يحق لك طلب الاطلاع على بياناتك أو تصحيحها أو تصديرها أو حذفها، مع مراعاة ما يفرض النظام الاحتفاظ به. يُقدَّم الطلب عبر [بريد الدعم الرسمي].'] },
      { heading: 'الأمان', paragraphs: ['نعزل بيانات كل محل عن غيره، ونشفّر كلمات المرور ورموز PIN، ونقيّد صلاحيات كل موظف حسب دوره. لا يوجد نظام محمي تماماً، ونبلغك إذا تعرّضت بياناتك لحادثة أمنية وفق ما يفرضه النظام.'] },
      { heading: 'التواصل', paragraphs: ['لأي سؤال عن هذه السياسة: [بريد الدعم الرسمي].'] },
    ],
  },
  en: {
    title: 'Privacy policy — Seen platform', draftNotice: DRAFT.en, updated: UPDATED.en,
    sections: [
      { heading: 'Who we are', paragraphs: ['Seen is software for running tailoring and similar shops: point of sale, orders, customers, inventory and invoices. It is operated by [legal name of the business, commercial registration number, address].'] },
      { heading: 'Our role and the shop\'s', paragraphs: [
        'Data about the shop owner and staff: Seen is responsible for it.',
        'Data about the shop\'s customers (names, phone numbers, measurements, orders, invoices): the shop is responsible for it; Seen processes it only on the shop\'s behalf and to provide the service, and uses it for nothing else.',
      ] },
      { heading: 'What we collect', paragraphs: [
        'Account data: name, email, phone number, password (hashed) and staff PINs (hashed).',
        'Shop data: trade name, VAT number, commercial registration, address, branches, logo.',
        'Operating data: sales, orders, customers and their measurements, inventory, shifts, payments, tax invoices.',
        'Technical data: device and browser type, IP address, and error logs.',
      ] },
      { heading: 'Why we use it', paragraphs: ['To provide and run the service, issue invoices and send them to ZATCA when the shop connects its account, support, platform security and abuse prevention, and subscription billing.'] },
      { heading: 'Who processes data with us', paragraphs: [
        'Supabase (database and sign-in), Vercel (hosting), Google Firebase (push notifications), Sentry (error monitoring), and the AI provider behind the assistant (OpenAI or Google Gemini) when it is used.',
        'The Zakat, Tax and Customs Authority (ZATCA): tax invoices are sent to it when the shop connects its account.',
        'Some of this data may be stored outside Saudi Arabia by these providers. [The founder and the lawyer set the PDPL requirements for transfers abroad.]',
      ] },
      { heading: 'How long we keep it', paragraphs: [
        'We keep a shop\'s data while its subscription lasts.',
        'Tax invoices are kept for the period the law requires, even after the account is closed. [The founder sets the legal period with the lawyer.]',
        'Before a shop is deleted, it can export its data.',
      ] },
      { heading: 'Your rights', paragraphs: ['You may ask to see, correct, export or delete your data, subject to what the law requires us to keep. Requests go to [official support email].'] },
      { heading: 'Security', paragraphs: ['Each shop\'s data is kept apart from every other shop\'s, passwords and PINs are hashed, and each employee only has the permissions of their role. No system is perfectly secure; we will tell you of a security incident affecting your data as the law requires.'] },
      { heading: 'Contact', paragraphs: ['Questions about this policy: [official support email].'] },
    ],
  },
  ur: {
    title: 'رازداری کی پالیسی — سین پلیٹ فارم', draftNotice: DRAFT.ur, updated: UPDATED.ur,
    sections: [
      { heading: 'ہم کون ہیں', paragraphs: ['سین درزی اور اسی طرح کی دکانیں چلانے کا سافٹ ویئر ہے: پوائنٹ آف سیل، آرڈرز، گاہک، انوینٹری اور انوائسز۔ اسے [کاروبار کا قانونی نام، کمرشل رجسٹریشن نمبر، پتہ] چلاتا ہے۔'] },
      { heading: 'ہمارا اور دکان کا کردار', paragraphs: [
        'دکان کے مالک اور عملے کا ڈیٹا: اس کی ذمہ دار سین ہے۔',
        'دکان کے گاہکوں کا ڈیٹا (نام، فون نمبر، پیمائش، آرڈرز، انوائسز): اس کی ذمہ دار دکان ہے؛ سین اسے صرف دکان کی طرف سے اور خدمت فراہم کرنے کے لیے پروسیس کرتا ہے، کسی اور مقصد کے لیے نہیں۔',
      ] },
      { heading: 'ہم کیا جمع کرتے ہیں', paragraphs: [
        'اکاؤنٹ ڈیٹا: نام، ای میل، فون نمبر، پاس ورڈ (ہیش شدہ) اور عملے کے PIN (ہیش شدہ)۔',
        'دکان کا ڈیٹا: تجارتی نام، VAT نمبر، کمرشل رجسٹریشن، پتہ، شاخیں، لوگو۔',
        'آپریشن ڈیٹا: فروخت، آرڈرز، گاہک اور ان کی پیمائش، انوینٹری، شفٹیں، ادائیگیاں، ٹیکس انوائسز۔',
        'تکنیکی ڈیٹا: ڈیوائس اور براؤزر کی قسم، IP ایڈریس، اور خرابیوں کے لاگ۔',
      ] },
      { heading: 'ہم اسے کیوں استعمال کرتے ہیں', paragraphs: ['خدمت فراہم کرنے اور چلانے، انوائسز جاری کرنے اور دکان کے اکاؤنٹ جوڑنے پر ZATCA کو بھیجنے، سپورٹ، پلیٹ فارم کی حفاظت اور غلط استعمال روکنے، اور سبسکرپشن بلنگ کے لیے۔'] },
      { heading: 'ہمارے ساتھ ڈیٹا کون پروسیس کرتا ہے', paragraphs: [
        'Supabase (ڈیٹا بیس اور لاگ ان)، Vercel (ہوسٹنگ)، Google Firebase (پش نوٹیفیکیشن)، Sentry (خرابیوں کی نگرانی)، اور اسسٹنٹ کے پیچھے AI فراہم کنندہ (OpenAI یا Google Gemini) جب اسے استعمال کیا جائے۔',
        'زکاۃ، ٹیکس اور کسٹمز اتھارٹی (ZATCA): دکان کا اکاؤنٹ جوڑنے پر ٹیکس انوائسز اسے بھیجی جاتی ہیں۔',
        'ان میں سے کچھ ڈیٹا ان فراہم کنندگان کے پاس سعودی عرب سے باہر محفوظ ہو سکتا ہے۔ [بانی اور وکیل بیرون ملک منتقلی کے لیے PDPL کی شرائط طے کریں گے۔]',
      ] },
      { heading: 'ہم اسے کب تک رکھتے ہیں', paragraphs: [
        'سبسکرپشن جاری رہنے تک ہم دکان کا ڈیٹا رکھتے ہیں۔',
        'ٹیکس انوائسز قانون کی مقرر کردہ مدت تک رکھی جاتی ہیں، اکاؤنٹ بند ہونے کے بعد بھی۔ [بانی وکیل کے ساتھ قانونی مدت طے کریں گے۔]',
        'دکان حذف ہونے سے پہلے اپنا ڈیٹا ایکسپورٹ کر سکتی ہے۔',
      ] },
      { heading: 'آپ کے حقوق', paragraphs: ['آپ اپنا ڈیٹا دیکھنے، درست کرنے، ایکسپورٹ کرنے یا حذف کرنے کی درخواست کر سکتے ہیں، قانونی طور پر لازمی رکھے جانے والے ڈیٹا کو چھوڑ کر۔ درخواست [سرکاری سپورٹ ای میل] پر بھیجیں۔'] },
      { heading: 'حفاظت', paragraphs: ['ہر دکان کا ڈیٹا دوسری دکانوں سے الگ رکھا جاتا ہے، پاس ورڈ اور PIN ہیش ہوتے ہیں، اور ہر ملازم کو صرف اس کے کردار کی اجازت ملتی ہے۔ کوئی نظام مکمل محفوظ نہیں؛ آپ کے ڈیٹا پر اثر انداز ہونے والے حفاظتی واقعے کی اطلاع ہم قانون کے مطابق دیں گے۔'] },
      { heading: 'رابطہ', paragraphs: ['اس پالیسی کے بارے میں سوالات: [سرکاری سپورٹ ای میل]۔'] },
    ],
  },
};

export const TERMS: Record<LegalLang, LegalDocument> = {
  ar: {
    title: 'شروط الاستخدام — منصة سِين', draftNotice: DRAFT.ar, updated: UPDATED.ar,
    sections: [
      { heading: 'الخدمة', paragraphs: ['تقدّم سِين برنامجاً سحابياً لإدارة المحل يُستخدم عبر المتصفح وتطبيقات الجوال. باستخدامك المنصة توافق على هذه الشروط وعلى سياسة الخصوصية.'] },
      { heading: 'الحساب', paragraphs: ['أنت مسؤول عن صحة بيانات التسجيل، وعن سرية كلمة المرور ورموز PIN، وعن كل ما يجري من حسابك وحسابات موظفيك، وعن الصلاحيات التي تمنحها لكل موظف.'] },
      { heading: 'الاشتراك والتجربة', paragraphs: [
        'تبدأ بفترة تجربة مجانية مدتها [عدد الأيام]، ثم تستمر الخدمة باشتراك مدفوع حسب الباقة المختارة.',
        'إذا انتهى الاشتراك دون تجديد يُقفل الحساب، ثم قد تُحذف بياناته بعد مدة تُعلَن مسبقاً مع إتاحة تصديرها قبل الحذف. [تُحدد سياسة الاسترداد والمدد مع المحامي.]',
        'إيصال الاشتراك الذي تصدره سِين ليس فاتورة ضريبية ما لم تكن سِين مسجّلة في ضريبة القيمة المضافة.',
      ] },
      { heading: 'الفواتير الضريبية وزاتكا', paragraphs: ['المحل هو المسؤول عن صحة بياناته الضريبية وأسعاره وعن التزامه بأنظمة الفوترة الإلكترونية. تساعد سِين على إصدار الفواتير وإرسالها، لكنها لا تتحمل مسؤولية بيانات غير صحيحة يُدخلها المحل، ولا تضمن قبول زاتكا لكل فاتورة.'] },
      { heading: 'الاستخدام المقبول', paragraphs: ['يُمنع استخدام المنصة في أي نشاط مخالف للأنظمة، أو محاولة الوصول لبيانات محلات أخرى، أو تعطيل الخدمة، أو إعادة بيعها دون اتفاق.'] },
      { heading: 'بيانات المحل', paragraphs: ['تبقى بياناتك ملكاً لك. يمكنك تصديرها، وتعالجها سِين وفق سياسة الخصوصية.'] },
      { heading: 'التوفر والمسؤولية', paragraphs: ['نسعى لتوفر الخدمة دائماً، ويعمل جزء منها بدون إنترنت، لكن قد تحدث انقطاعات. لا تتجاوز مسؤولية سِين المبالغ التي دفعها المحل خلال [المدة] السابقة. [تُراجَع حدود المسؤولية مع المحامي.]'] },
      { heading: 'التعديلات', paragraphs: ['قد نعدّل هذه الشروط، ونطلب موافقتك على النسخة الجديدة عند تغييرها تغييراً جوهرياً.'] },
      { heading: 'النظام المطبق', paragraphs: ['تخضع هذه الشروط لأنظمة المملكة العربية السعودية. [يحدد المحامي جهة الاختصاص.]'] },
    ],
  },
  en: {
    title: 'Terms of use — Seen platform', draftNotice: DRAFT.en, updated: UPDATED.en,
    sections: [
      { heading: 'The service', paragraphs: ['Seen provides cloud software to run a shop, used in the browser and on mobile apps. By using the platform you agree to these terms and to the privacy policy.'] },
      { heading: 'Your account', paragraphs: ['You are responsible for accurate sign-up details, for keeping your password and PINs secret, for everything done from your account and your staff\'s accounts, and for the permissions you give each employee.'] },
      { heading: 'Subscription and trial', paragraphs: [
        'You start with a free trial of [number of days], after which the service continues on a paid subscription for the chosen plan.',
        'If a subscription ends without renewal the account is locked, and its data may later be deleted after a period announced in advance, with an export offered before deletion. [Refunds and periods to be set with the lawyer.]',
        'The subscription receipt Seen issues is not a tax invoice unless Seen is registered for VAT.',
      ] },
      { heading: 'Tax invoices and ZATCA', paragraphs: ['The shop is responsible for its tax details, its prices and its compliance with e-invoicing rules. Seen helps issue and send invoices but is not responsible for wrong data entered by the shop, and cannot guarantee ZATCA accepts every invoice.'] },
      { heading: 'Acceptable use', paragraphs: ['You may not use the platform for anything unlawful, try to reach other shops\' data, disrupt the service, or resell it without an agreement.'] },
      { heading: 'Your data', paragraphs: ['Your data stays yours. You can export it, and Seen processes it under the privacy policy.'] },
      { heading: 'Availability and liability', paragraphs: ['We aim to keep the service available, and part of it works offline, but outages can happen. Seen\'s liability is limited to the amounts the shop paid in the previous [period]. [Liability limits to be reviewed with the lawyer.]'] },
      { heading: 'Changes', paragraphs: ['We may change these terms, and will ask you to accept the new version when a change is material.'] },
      { heading: 'Governing law', paragraphs: ['These terms are governed by the laws of the Kingdom of Saudi Arabia. [The lawyer sets the competent jurisdiction.]'] },
    ],
  },
  ur: {
    title: 'استعمال کی شرائط — سین پلیٹ فارم', draftNotice: DRAFT.ur, updated: UPDATED.ur,
    sections: [
      { heading: 'خدمت', paragraphs: ['سین دکان چلانے کا کلاؤڈ سافٹ ویئر فراہم کرتا ہے جو براؤزر اور موبائل ایپس پر استعمال ہوتا ہے۔ پلیٹ فارم استعمال کر کے آپ ان شرائط اور رازداری کی پالیسی سے اتفاق کرتے ہیں۔'] },
      { heading: 'آپ کا اکاؤنٹ', paragraphs: ['درست رجسٹریشن تفصیلات، پاس ورڈ اور PIN کی رازداری، اپنے اور عملے کے اکاؤنٹس سے ہونے والی ہر کارروائی، اور ہر ملازم کو دی گئی اجازتوں کی ذمہ داری آپ پر ہے۔'] },
      { heading: 'سبسکرپشن اور آزمائش', paragraphs: [
        'آپ [دنوں کی تعداد] کی مفت آزمائش سے شروع کرتے ہیں، اس کے بعد منتخب پلان کی ادا شدہ سبسکرپشن پر خدمت جاری رہتی ہے۔',
        'تجدید کے بغیر سبسکرپشن ختم ہونے پر اکاؤنٹ لاک ہو جاتا ہے، اور بعد میں پیشگی اعلان شدہ مدت کے بعد اس کا ڈیٹا حذف ہو سکتا ہے، حذف سے پہلے ایکسپورٹ کی سہولت کے ساتھ۔ [رقم کی واپسی اور مدتیں وکیل کے ساتھ طے ہوں گی۔]',
        'سین کی جاری کردہ سبسکرپشن رسید ٹیکس انوائس نہیں جب تک سین VAT میں رجسٹرڈ نہ ہو۔',
      ] },
      { heading: 'ٹیکس انوائسز اور ZATCA', paragraphs: ['دکان اپنی ٹیکس تفصیلات، قیمتوں اور ای انوائسنگ قوانین کی پابندی کی ذمہ دار ہے۔ سین انوائسز جاری کرنے اور بھیجنے میں مدد کرتا ہے لیکن دکان کے درج کردہ غلط ڈیٹا کا ذمہ دار نہیں، اور ZATCA کی ہر انوائس قبول کرنے کی ضمانت نہیں دیتا۔'] },
      { heading: 'قابل قبول استعمال', paragraphs: ['پلیٹ فارم کو غیر قانونی کام، دوسری دکانوں کے ڈیٹا تک پہنچنے کی کوشش، خدمت میں خلل، یا معاہدے کے بغیر دوبارہ فروخت کے لیے استعمال کرنا منع ہے۔'] },
      { heading: 'آپ کا ڈیٹا', paragraphs: ['آپ کا ڈیٹا آپ کا ہی رہتا ہے۔ آپ اسے ایکسپورٹ کر سکتے ہیں، اور سین اسے رازداری کی پالیسی کے تحت پروسیس کرتا ہے۔'] },
      { heading: 'دستیابی اور ذمہ داری', paragraphs: ['ہم خدمت کو دستیاب رکھنے کی کوشش کرتے ہیں، اور اس کا کچھ حصہ آف لائن بھی چلتا ہے، لیکن رکاوٹیں آ سکتی ہیں۔ سین کی ذمہ داری پچھلی [مدت] میں دکان کی ادا کردہ رقم تک محدود ہے۔ [ذمہ داری کی حدیں وکیل کے ساتھ دیکھی جائیں گی۔]'] },
      { heading: 'تبدیلیاں', paragraphs: ['ہم ان شرائط میں تبدیلی کر سکتے ہیں، اور بڑی تبدیلی پر نئی نسخے کی منظوری مانگیں گے۔'] },
      { heading: 'نافذ قانون', paragraphs: ['یہ شرائط سعودی عرب کے قوانین کے تابع ہیں۔ [وکیل متعلقہ دائرہ اختیار طے کریں گے۔]'] },
    ],
  },
};
