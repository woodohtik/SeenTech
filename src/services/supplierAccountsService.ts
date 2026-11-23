import { supabase } from '../lib/supabase/client';
import { SupplierTransaction } from '../types/supplierLedger';

// مراجعة-الفريق-التقني-الكامل-2026-10-19.md (نتيجة حرجة): supplier_transactions
// لم يكن له أي migration فعلياً (تحقَّق مباشرة: الجدول غير موجود على staging) --
// هذا الملف كان يتراجع صامتاً إلى localStorage لكل متصفح/جهاز على حدة عند
// فشل الاستعلام، ما يعني أن جهازي POS لنفس التاجر يريان رصيد/سجل حركة
// مختلفَين تماماً لنفس المورد بلا أي تنبيه. الجدول أُضيف الآن بـmigration
// حقيقية (20261019020000_missing_tables_schema_drift.sql)، فحُذف مسار
// localStorage بالكامل -- لا مصدر حقيقة ثانٍ بعد اليوم.

/** Fetches all transactions for a specific supplier, ordered oldest-first. */
export async function getSupplierTransactions(
  supplierId: string,
  tenantId: string,
  _supplierName: string,
  supplierBalance: number
): Promise<SupplierTransaction[]> {
  const { data, error } = await supabase
    .from('supplier_transactions')
    .select('*')
    .eq('supplier_id', supplierId)
    .eq('tenant_id', tenantId)
    .order('date', { ascending: true });

  if (error) throw error;
  if (data && data.length > 0) return data as SupplierTransaction[];

  // مورد جديد بلا أي حركة بعد: إن كان له رصيد افتتاحي، أنشئ سطر "رصيد
  // افتتاحي" تمثيلياً (لا يُكتَب في الجدول -- فقط للعرض) ليبدأ السجل من رقم
  // غير صفري بدل الظهور فارغاً رغم وجود ذمة فعلية.
  if (supplierBalance && supplierBalance > 0) {
    const openingTx: SupplierTransaction = {
      id: `opening-${supplierId}`,
      supplier_id: supplierId,
      type: 'adjustment',
      credit: supplierBalance,
      debit: 0,
      running_balance: supplierBalance,
      reference_number: 'OP-001',
      date: new Date().toISOString(),
      notes: 'رصيد افتتاحي للمورد / Opening balance',
      tenant_id: tenantId,
    };
    return [openingTx];
  }

  return [];
}

/**
 * Creates/records a transaction and updates the supplier's balance.
 *
 * `operationId`, when provided (مراجعة-الفريق-التقني-الكامل-2026-10-19.md،
 * قاعدة بيانات، عالية): يجعل هذا الاستدعاء بالكامل قابلاً لإعادة المحاولة
 * بأمان -- يُستخدَم كمفتاح idempotency لـincrement_supplier_balance (لا
 * يُضاعِف الفرق على الرصيد عند إعادة المحاولة) **و** كمعرّف (id) ثابت لسطر
 * supplier_transactions نفسه بدل UUID عشوائي في كل مرة، فإعادة المحاولة لا
 * تُنشئ سطر سجل مكرراً أيضاً. بلا هذا المعرّف (الاستدعاءات القديمة)، السلوك
 * يبقى كما كان تماماً -- لا idempotency، لتفادي كسر مستدعين لم تُراجَع
 * دلالة "نفس العملية" لديهم بعد.
 */
export async function addSupplierTransaction(
  tenantId: string,
  transaction: Omit<SupplierTransaction, 'id' | 'running_balance'>,
  _currentBalance: number,
  operationId?: string
): Promise<SupplierTransaction> {
  // P6 (MONEY-12): one server call moves the balance and writes the ledger
  // line with the balance it produced; the operation id makes a retry apply
  // once. (The two used to be separate calls that could disagree.)
  const transactionId = operationId || crypto.randomUUID();
  const { data, error } = await supabase.rpc('record_supplier_transaction', {
    p_operation_id: transactionId,
    p_supplier_id: transaction.supplier_id,
    p_type: transaction.type,
    p_credit: transaction.credit || 0,
    p_debit: transaction.debit || 0,
    p_reference: transaction.reference_number || null,
    p_date: transaction.date || null,
    p_notes: transaction.notes || null,
  });
  if (error) throw error;
  const result = data as { id: string; running_balance: number };
  return {
    ...transaction,
    tenant_id: tenantId,
    id: result.id,
    running_balance: Number(result.running_balance),
  };
}
