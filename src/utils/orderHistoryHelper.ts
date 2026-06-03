export interface EncodedHistoryMetadata {
  originalNotes: string;
  history: any[];
  items?: any[];
  subtotalAmount?: number;
}

/**
 * Encodes order row data to strip virtual columns like 'history', 'items', and 'subtotal_amount',
 * and pack them into the 'notes' field.
 */
export function encodeOrderRow(row: any): any {
  if (!row || typeof row !== 'object') return row;
  
  const copy = { ...row };
  
  // Remove generated/virtual columns that would cause DB insert/update failures
  if ('remaining_amount' in copy) {
    delete copy.remaining_amount;
  }
  
  const history = 'history' in copy ? copy.history || [] : null;
  const items = 'items' in copy ? copy.items || [] : null;
  const subtotalAmount = 'subtotal_amount' in copy ? copy.subtotal_amount : null;
  
  // If we have virtual columns, encode them in the notes column
  if (history !== null || items !== null || subtotalAmount !== null) {
    let originalNotes = copy.notes || '';
    
    // Retrieve original notes if already encoded
    if (typeof originalNotes === 'string') {
      if (originalNotes.startsWith('__ORDER_METADATA_V2__:')) {
        try {
          const parsed = JSON.parse(originalNotes.substring('__ORDER_METADATA_V2__:'.length));
          originalNotes = parsed.originalNotes || '';
        } catch (e) {}
      } else if (originalNotes.startsWith('__ORDER_WITH_HISTORY__:')) {
        try {
          const parsed = JSON.parse(originalNotes.substring('__ORDER_WITH_HISTORY__:'.length));
          originalNotes = parsed.originalNotes || '';
        } catch (e) {}
      }
    }
    
    const metadata: EncodedHistoryMetadata = {
      originalNotes,
      history: history !== null ? history : (copy.history || []),
      items: items !== null ? items : (copy.items || []),
    };
    
    if (subtotalAmount !== null) {
      metadata.subtotalAmount = subtotalAmount;
    } else if ('subtotal_amount' in copy) {
      metadata.subtotalAmount = copy.subtotal_amount;
    }
    
    copy.notes = `__ORDER_METADATA_V2__:${JSON.stringify(metadata)}`;
    
    // Safely remove virtual columns so Supabase PostgREST does not fail
    delete copy.history;
    delete copy.items;
    delete copy.subtotal_amount;
  }
  
  return copy;
}

/**
 * Encodes a payload which could be a single row object or an array of rows
 */
export function encodeOrderPayload(payload: any): any {
  if (!payload) return payload;
  if (Array.isArray(payload)) {
    return payload.map(encodeOrderRow);
  }
  return encodeOrderRow(payload);
}

/**
 * Decodes order row data to retrieve virtual columns like 'history', 'items', and 'subtotal_amount'
 * from 'notes' field.
 */
export function decodeOrderRow(row: any): any {
  if (!row || typeof row !== 'object') return row;
  
  const copy = { ...row };
  
  if (copy.notes && typeof copy.notes === 'string') {
    if (copy.notes.startsWith('__ORDER_METADATA_V2__:') || copy.notes.startsWith('__ORDER_METADATA_V2___:')) {
      try {
        const colonIndex = copy.notes.indexOf(':');
        const jsonStr = copy.notes.substring(colonIndex + 1);
        const parsed = JSON.parse(jsonStr) as EncodedHistoryMetadata;
        
        copy.notes = parsed.originalNotes || '';
        copy.history = parsed.history || [];
        copy.items = parsed.items || [];
        if (parsed.subtotalAmount !== undefined) {
          copy.subtotal_amount = parsed.subtotalAmount;
        }
      } catch (e) {
        console.warn('Failed to parse encoded metadata v2:', e);
        copy.history = copy.history || [];
        copy.items = copy.items || [];
      }
    } else if (copy.notes.startsWith('__ORDER_WITH_HISTORY__:')) {
      try {
        const jsonStr = copy.notes.substring('__ORDER_WITH_HISTORY__:'.length);
        const parsed = JSON.parse(jsonStr) as any;
        
        copy.notes = parsed.originalNotes || '';
        copy.history = parsed.history || [];
        copy.items = parsed.items || [];
      } catch (e) {
        console.warn('Failed to parse encoded history:', e);
        copy.history = copy.history || [];
        copy.items = copy.items || [];
      }
    }
  }
  
  // Guarantee these exist so components do not encounter runtime undefined failures
  if (!('history' in copy) || !copy.history) {
    copy.history = [];
  }
  if (!('items' in copy) || !copy.items) {
    copy.items = [];
  }
  
  return copy;
}

/**
 * Decodes a fetched payload which could be a single row object or an array of rows
 */
export function decodeOrderPayload(payload: any): any {
  if (!payload) return payload;
  if (Array.isArray(payload)) {
    return payload.map(decodeOrderRow);
  }
  return decodeOrderRow(payload);
}
