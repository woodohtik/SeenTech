# النسخ الاحتياطي والاسترجاع

seen-readiness-fixes-task.md P5 (PLATFORM-12). آخر تحقق: 23 نوفمبر 2026.

## الوضع الفعلي كما فُحص

| | staging (`yodvqhdjzjyhvrlhguzf`) | الإنتاج (`bvvhxjrlwphvrmneieuk`) |
|---|---|---|
| PITR | **غير مفعّل** (`pitr_enabled: false`) | **لم يُفحص بعد**: يشغّله المؤسس (الأمر أدناه) |
| نسخ فعلية (physical) | لا توجد (`backups: []`) | — |
| نسخ منطقية في `backups/` | — | ملفا `prod_schema_*.sql` حجمهما **0 بايت**: فشلا بصمت |

لماذا فشلت النسخ: `supabase db dump` يشغّل `pg_dump` داخل Docker. حين لا يكون Docker يعمل، يطبع الأمر رسالة خطأ ويخرج برمز 1، والتوجيه `> ملف` ينشئ الملف على أي حال، فارغاً أو بنص الخطأ. لم يكن هناك أي فحص لرمز الخروج ولا للمحتوى.

## فحص PITR على الإنتاج (للقراءة فقط)

```
! npx supabase backups list --project-ref bvvhxjrlwphvrmneieuk
```

- النتيجة المطلوبة: `"pitr_enabled": true`.
- إن كانت `false`: PITR إضافة مدفوعة في Supabase (Project Settings → Add-ons). تفعيلها قرار للمؤسس، وبدونها يعتمد الاسترجاع على النسخ اليومية فقط، أو على النسخ المنطقية أدناه.

## نسخة منطقية موثوقة: `scripts/backup/db-dump.sh`

```
# المخطط (staging المرتبط):
bash scripts/backup/db-dump.sh

# المخطط من الإنتاج (يشغّله المؤسس):
! bash scripts/backup/db-dump.sh --project-ref bvvhxjrlwphvrmneieuk

# البيانات (تُكتب مشفّرة فقط):
! BACKUP_PASSPHRASE_FILE=~/.seen-backup-pass bash scripts/backup/db-dump.sh --data --project-ref bvvhxjrlwphvrmneieuk
```

- يتوقف السكربت فوراً إن لم يكن Docker يعمل، أو إن فشل الأمر (`set -euo pipefail`).
- يفحص الملف قبل اعتباره نسخة (`scripts/backup/verify-dump.mjs`): غير فارغ، ليس رسالة خطأ، فوق حد أدنى للحجم، ويحتوي `CREATE TABLE` والدوال في نسخة المخطط، و`COPY`/`INSERT` في نسخة البيانات.
- نسخة البيانات تحتوي بيانات عملاء ومالية. لذلك تُشفَّر AES-256 بعبارة مرور من ملف، ويُتأكد من أنها تُفك، ثم يُحذف النص الصريح.
- بجانب كل ملف ملف `.sha256`.
- المجلد `backups/` مستثنى من git.

## تمرين الاسترجاع

### أ) PITR (المسار الأساسي لحادثة بيانات حقيقية)

غير ممكن على staging اليوم، فلا PITR ولا نسخ فعلية فيه. لإجرائه يلزم أحد خيارين، وكلاهما قرار للمؤسس:

1. تفعيل PITR على staging مؤقتاً، ثم:
   ```
   npx supabase backups restore --project-ref yodvqhdjzjyhvrlhguzf --timestamp <unix>
   ```
   - هذا **يستبدل** قاعدة staging كلها بحالتها في تلك اللحظة.
   - يُسجَّل زمن الاسترجاع، وآخر عملية بقيت بعده، أي مقدار البيانات المفقودة.
2. أو إجراؤه على الإنتاج في نافذة صيانة. لا يُنصح به كتمرين.

سجل التمرين (يُملأ عند إجرائه):

| التاريخ | المشروع | اللحظة المسترجَعة | زمن الاسترجاع | ما فُقد | من أجراه |
|---|---|---|---|---|---|
| — | — | — | — | — | — |

### ب) النسخة المنطقية (ممكن الآن، يحتاج Docker)

```
npx supabase start          # قاعدة محلية فارغة
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f backups/<ملف_المخطط>.sql
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in backups/<ملف_البيانات>.sql.enc -pass file:~/.seen-backup-pass \
  | psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
npx supabase stop
```

النجاح يعني: عدد الصفوف في `tenants` و`orders` و`tax_invoices` يطابق المصدر لحظة النسخ.

## بيانات الإنتاج على الأجهزة المحلية

في `backups/` على جهاز التطوير الملف `prod_full_data_export_20261118_133105.csv` (1.4 ميغابايت تقريباً)، وهو تصدير لبيانات الإنتاج **غير مشفّر**. المطلوب من المؤسس واحد من اثنين:

- حذفه إن لم تعد له حاجة. حذف نهائي، لم يُنفَّذ تلقائياً.
- أو تشفيره ثم حذف الأصل:
  ```
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in backups/prod_full_data_export_20261118_133105.csv -out backups/prod_full_data_export_20261118_133105.csv.enc -pass file:~/.seen-backup-pass
  ```

ملفا `prod_schema_*.sql` الفارغان لا قيمة لهما ويمكن حذفهما.

**من يحق له سحب بيانات الإنتاج:** المؤسس وحده، أو من يفوّضه كتابةً. يتم ذلك عبر `db-dump.sh --data` المشفّر فقط، لا تصدير CSV صريح. ويُسجَّل كل سحب هنا:

| التاريخ | من | لماذا | الملف | أين حُفظ |
|---|---|---|---|---|
| — | — | — | — | — |
