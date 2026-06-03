export interface Supplier {
  id: string;
  name: string;
  contactPerson?: string;
  email?: string;
  phone: string;
  address?: string;
  taxNumber?: string;
  category?: string;
  opening_balance?: number;
  current_balance: number; // maps to database field 'balance'
  tenant_id: string;
  created_at?: string;
}

export interface SupplierTransaction {
  id: string;
  supplier_id: string;
  type: 'purchase' | 'payment' | 'adjustment';
  credit: number; // دائن - amount we owe the supplier (e.g., from purchases)
  debit: number;  // مدين - amount we paid to the supplier
  running_balance: number; // calculated balance
  reference_number: string; // purchase invoice ID or payment voucher ID
  date: string;
  notes: string;
  tenant_id: string;
}
