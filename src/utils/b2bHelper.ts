export interface B2BMetadata {
  isB2B?: boolean;
  b2bCompanyName?: string;
  b2bTRN?: string;
  originalNotes?: string;
}

export interface TaxInvoiceExtendedNotes {
  invoice_type?: string;
  is_b2b?: boolean;
  b2b_company_name?: string;
  items?: any[];
  created_by?: string;
  original_notes?: string;
}

/**
 * Encodes B2B metadata into a single notes string for the orders table.
 */
export function encodeOrderB2BNotes(companyName: string = '', trn: string = '', originalNotes: string = ''): string {
  const meta: B2BMetadata = {
    isB2B: !!(companyName || trn),
    b2bCompanyName: companyName,
    b2bTRN: trn,
    originalNotes: originalNotes || ''
  };
  return `__B2B_METADATA__:${JSON.stringify(meta)}`;
}

/**
 * Decodes B2B metadata from the orders notes string.
 */
export function decodeOrderB2BNotes(notesStr: string | null): B2BMetadata {
  if (!notesStr) return {};
  if (notesStr.startsWith('__B2B_METADATA__:')) {
    try {
      const jsonStr = notesStr.substring('__B2B_METADATA__:'.length);
      return JSON.parse(jsonStr) as B2BMetadata;
    } catch (e) {
      return { b2bCompanyName: '', b2bTRN: '', originalNotes: notesStr, isB2B: false };
    }
  }
  return { b2bCompanyName: '', b2bTRN: '', originalNotes: notesStr, isB2B: false };
}

/**
 * Encodes extended notes for the tax_invoices table.
 */
export function encodeInvoiceExtendedNotes(params: {
  invoiceType?: string;
  isB2B?: boolean;
  b2bCompanyName?: string;
  items?: any[];
  createdBy?: string;
  originalNotes?: string;
}): string {
  const meta: TaxInvoiceExtendedNotes = {
    invoice_type: params.invoiceType,
    is_b2b: params.isB2B,
    b2b_company_name: params.b2bCompanyName,
    items: params.items,
    created_by: params.createdBy,
    original_notes: params.originalNotes || ''
  };
  return `__INVOICE_EXT_METADATA__:${JSON.stringify(meta)}`;
}

/**
 * Decodes extended notes from the tax_invoices notes string.
 */
export function decodeInvoiceExtendedNotes(notesStr: string | null): TaxInvoiceExtendedNotes {
  if (!notesStr) return {};
  if (notesStr.startsWith('__INVOICE_EXT_METADATA__:')) {
    try {
      const jsonStr = notesStr.substring('__INVOICE_EXT_METADATA__:'.length);
      return JSON.parse(jsonStr) as TaxInvoiceExtendedNotes;
    } catch (e) {
      return { original_notes: notesStr };
    }
  }
  return { original_notes: notesStr };
}

export interface InventoryMetadata {
  costPrice?: number;
  taxType?: 'inclusive' | 'exclusive' | 'exempt';
  originalDescription?: string;
}

/**
 * Encodes Inventory metadata into the description text field.
 */
export function encodeInventoryDescription(costPrice: number = 0, taxType: 'inclusive' | 'exclusive' | 'exempt' = 'exclusive', originalDescription: string = ''): string {
  const meta: InventoryMetadata = {
    costPrice,
    taxType,
    originalDescription: originalDescription || ''
  };
  return `__INVENTORY_METADATA__:${JSON.stringify(meta)}`;
}

/**
 * Decodes Inventory metadata from the description text field.
 */
export function decodeInventoryDescription(descStr: string | null): InventoryMetadata {
  if (!descStr) return { costPrice: 0, taxType: 'exclusive', originalDescription: '' };
  if (descStr.startsWith('__INVENTORY_METADATA__:')) {
    try {
      const jsonStr = descStr.substring('__INVENTORY_METADATA__:'.length);
      const parsed = JSON.parse(jsonStr) as InventoryMetadata;
      return {
        costPrice: parsed.costPrice || 0,
        taxType: parsed.taxType || 'exclusive',
        originalDescription: parsed.originalDescription || ''
      };
    } catch (e) {
      return { costPrice: 0, taxType: 'exclusive', originalDescription: descStr };
    }
  }
  return { costPrice: 0, taxType: 'exclusive', originalDescription: descStr };
}

export interface TaxCalculationResult {
  basePrice: number;    // Price without tax
  taxAmount: number;    // Calculated VAT amount
  finalPrice: number;   // Price including tax
}

/**
 * Calculates the final price and tax amount for an item based on its price, tax type, and standard VAT rate.
 */
export function calculateItemTax(
  price: number,
  taxType: 'inclusive' | 'exclusive' | 'exempt',
  vatRate: number = 0.15,
  quantity: number = 1
): TaxCalculationResult {
  const totalRawPrice = price * quantity;
  
  if (taxType === 'exempt') {
    return {
      basePrice: totalRawPrice,
      taxAmount: 0,
      finalPrice: totalRawPrice
    };
  }
  
  if (taxType === 'inclusive') {
    const basePrice = totalRawPrice / (1 + vatRate);
    const taxAmount = totalRawPrice - basePrice;
    return {
      basePrice: Number(basePrice.toFixed(2)),
      taxAmount: Number(taxAmount.toFixed(2)),
      finalPrice: Number(totalRawPrice.toFixed(2))
    };
  }
  
  const taxAmount = totalRawPrice * vatRate;
  const finalPrice = totalRawPrice + taxAmount;
  return {
    basePrice: Number(totalRawPrice.toFixed(2)),
    taxAmount: Number(taxAmount.toFixed(2)),
    finalPrice: Number(finalPrice.toFixed(2))
  };
}
