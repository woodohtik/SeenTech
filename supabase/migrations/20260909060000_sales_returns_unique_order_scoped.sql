-- =============================================================================
--  تصحيح قيد sales_returns_order_id_unique ليستثني إشعارات الدائن (ultra-review)
--  ------------------------------------------------------------------------
--  20260908000000 أضاف UNIQUE(order_id) على sales_returns لمنع استرجاع
--  مبيعات مزدوج (SalesReturns.tsx، بند 1.1). لكن نفس الجدول يستقبل أيضاً
--  إشعارات الدائن الجزئية من CreditNotes.tsx (بند 1.8)، التي صُمِّمت عمداً
--  لتسمح بأكثر من إشعار على نفس invoice_id/order_id (check_sales_return_total،
--  20260908020000، تجمع refunded_amount عبر عدة صفوف وتتحقق فقط أن المجموع
--  لا يتجاوز إجمالي الفاتورة). القيد العام كان يمنع أي إشعار دائن جزئي ثانٍ
--  على نفس الطلب بخطأ 23505 غير مُعالَج في CreditNotes.tsx (الذي يعالج فقط
--  23514) -- يكسر بالضبط الميزة التي بناها بند 1.8.
--
--  الحل: قيد فريد جزئي (partial unique index) يقتصر على صفوف SalesReturns.tsx
--  فقط (return_number لا يبدأ بـ"CN-", التمييز الوحيد المتاح حالياً بين
--  المسارين بلا عمود تمييز صريح)، فيبقى منع الاسترجاع المزدوج قائماً بينما
--  تُسمَح إشعارات الدائن المتعددة بحرّية (محكومة بـcheck_sales_return_total
--  وحدها، كما صُمِّم أصلاً).
-- =============================================================================

ALTER TABLE public.sales_returns DROP CONSTRAINT IF EXISTS sales_returns_order_id_unique;

CREATE UNIQUE INDEX IF NOT EXISTS sales_returns_order_id_unique_full_return
  ON public.sales_returns (order_id)
  WHERE return_number NOT LIKE 'CN-%';
