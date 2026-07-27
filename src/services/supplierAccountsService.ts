import { supabase } from '../lib/supabase/client';
import { SupplierTransaction } from '../types/supplierLedger';

const LEDGER_STORAGE_KEY_PREFIX = 'seen_supplier_transactions_v1_';

/**
 * Normalizes and fetches all transactions for a specific supplier.
 * Utilizes a hybrid cloud-and-local strategy:
 * 1. Checks if Supabase `supplier_transactions` table exists and queries it.
 * 2. If missing/fails, falls back seamlessly to per-tenant `localStorage` storage.
 * 3. Seeds pre-populated realistic transactions if the ledger is completely empty.
 */
export async function getSupplierTransactions(
  supplierId: string,
  tenantId: string,
  supplierName: string,
  supplierBalance: number
): Promise<SupplierTransaction[]> {
  try {
    // 1. Attempt database query
    const { data, error } = await supabase
      .from('supplier_transactions')
      .select('*')
      .eq('supplier_id', supplierId)
      .eq('tenant_id', tenantId)
      .order('date', { ascending: true });

    // If table relation exists and query works, return it
    if (!error && data) {
      if (data.length > 0) {
        return data as SupplierTransaction[];
      }
    } else if (error) {
      // Table may not exist in database yet; fallback gracefully without throwing console.error
      console.warn('supplier_transactions table query notice:', error.message || error);
    }
  } catch (err) {
    console.warn('Exception querying supplier_transactions from DB:', err);
  }

  // 2. Fallback to LocalStorage sync
  const localKey = `${LEDGER_STORAGE_KEY_PREFIX}${tenantId}_${supplierId}`;
  const stored = localStorage.getItem(localKey);
  
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as SupplierTransaction[];
      // Filter out legacy auto-seeded mock transactions (e.g. starting with 'mock-')
      const realTransactions = parsed.filter(tx => !tx.id || !tx.id.toString().startsWith('mock-'));
      if (realTransactions.length > 0) {
        return realTransactions.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      }
      // Clean up stale mock data key from localStorage
      localStorage.removeItem(localKey);
    } catch (e) {
      console.error('Error parsing local supplier ledger:', e);
    }
  }

  // 3. For new or clean suppliers without transaction records:
  // If supplier has a non-zero opening balance, create a single opening balance entry.
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
 */
export async function addSupplierTransaction(
  tenantId: string,
  transaction: Omit<SupplierTransaction, 'id' | 'running_balance'>,
  currentBalance: number
): Promise<SupplierTransaction> {
  const transactionId = crypto.randomUUID();
  
  // Calculate new running balance: Outstanding = Total Credit - Total Debit
  // credit: we owe supplier more (+ balance)
  // debit: we pay supplier (- balance)
  const isDebit = transaction.debit > 0;
  const newBalance = isDebit 
    ? currentBalance - transaction.debit 
    : currentBalance + transaction.credit;

  const fullTransaction: SupplierTransaction = {
    ...transaction,
    id: transactionId,
    running_balance: Number(newBalance.toFixed(2)),
  };

  // 1. Attempt to store in Supabase
  let storedInDb = false;
  try {
    const { error } = await supabase
      .from('supplier_transactions')
      .insert({
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
      });

    if (!error) {
      storedInDb = true;
    }
  } catch (err) {
    console.warn('Could not insert transaction to Supabase table, falling back to localStorage:', err);
  }

  // 2. Always persist in LocalStorage for safe fallback
  const localKey = `${LEDGER_STORAGE_KEY_PREFIX}${tenantId}_${fullTransaction.supplier_id}`;
  const existing = await getSupplierTransactions(
    fullTransaction.supplier_id,
    tenantId,
    '',
    currentBalance
  );
  
  // Keep all transactions including seeded/mock history to preserve full mathematical coherence
  const activeTransactions = existing;
  
  const updatedTransactions = [...activeTransactions, fullTransaction].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  
  localStorage.setItem(localKey, JSON.stringify(updatedTransactions));

  // 3. Update the matching Supplier's balance column in the database
  try {
    const { error: updateErr } = await supabase
      .from('suppliers')
      .update({ balance: Number(newBalance.toFixed(2)) })
      .eq('id', fullTransaction.supplier_id);

    if (updateErr) {
      console.error('Failed to update supplier balance in Supabase:', updateErr);
    }
  } catch (err) {
    console.error('Exception updating supplier balance in Supabase:', err);
  }

  return fullTransaction;
}

/**
 * Returns SQL setup code so user can apply it directly to database for permanent storage.
 */
export function getLedgerSQLMigrationCode(): string {
  return `-- 1. إنشاء جدول حسابات حركة الموردين
CREATE TABLE IF NOT EXISTS public.supplier_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
    type VARCHAR(30) NOT NULL CHECK (type IN ('purchase', 'payment', 'adjustment')),
    credit NUMERIC(14,2) NOT NULL DEFAULT 0,
    debit NUMERIC(14,2) NOT NULL DEFAULT 0,
    running_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
    reference_number VARCHAR(100) NOT NULL,
    date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. إنشاء الفهارس لتسريع البحث والاستعلام
CREATE INDEX IF NOT EXISTS idx_supplier_transactions_supplier ON public.supplier_transactions(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_transactions_tenant ON public.supplier_transactions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_supplier_transactions_date ON public.supplier_transactions(date DESC);

-- 3. تفعيل RLS والسماح بالوصول الكامل
ALTER TABLE public.supplier_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY allow_all ON public.supplier_transactions FOR ALL USING (true) WITH CHECK (true);
`;
}
