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
  currentBalance: number,
  operationId?: string
): Promise<SupplierTransaction> {
  const transactionId = operationId || crypto.randomUUID();

  // credit: we owe supplier more (+ balance); debit: we pay supplier (- balance)
  const isDebit = transaction.debit > 0;
  const delta = isDebit ? -transaction.debit : transaction.credit;

  // Call the atomic RPC FIRST and use its authoritative returned balance for
  // the ledger row -- computing running_balance from the currentBalance
  // parameter (read separately, before this call) used to leave the ledger
  // silently diverging from the real suppliers.balance under concurrency:
  // two near-simultaneous transactions for the same supplier both apply
  // their delta correctly via the RPC, but each ledger row still recorded
  // its own stale pre-update snapshot as running_balance.
  let authoritativeBalance = currentBalance + delta;
  const { data: newBalance, error: updateErr } = await supabase.rpc('increment_supplier_balance', {
    p_supplier_id: transaction.supplier_id,
    p_delta: delta,
    p_operation_id: operationId || null,
  });
  if (updateErr) throw updateErr;
  if (typeof newBalance === 'number') authoritativeBalance = newBalance;

  const fullTransaction: SupplierTransaction = {
    ...transaction,
    id: transactionId,
    running_balance: Number(authoritativeBalance.toFixed(2)),
  };

  const { error } = await supabase
    .from('supplier_transactions')
    .upsert({
      id: fullTransaction.id,
      supplier_id: fullTransaction.supplier_id,
      tenant_id: fullTransaction.tenant_id,
      type: fullTransaction.type,
      credit: fullTransaction.credit,
      debit: fullTransaction.debit,
      running_balance: fullTransaction.running_balance,
      reference_number: fullTransaction.reference_number,
      date: fullTransaction.date,
      notes: fullTransaction.notes,
    }, { onConflict: 'id', ignoreDuplicates: true });
  if (error) throw error;

  return fullTransaction;
}
