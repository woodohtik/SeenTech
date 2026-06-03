import bcrypt from 'bcryptjs';
import { supabase } from '../lib/supabase/client';

/**
 * Generates a secure random numeric PIN of specified length.
 */
export function generateSecurePin(length: 4 | 6 = 4): string {
  const min = Math.pow(10, length - 1);
  const max = Math.pow(10, length) - 1;
  return Math.floor(min + Math.random() * (max - min + 1)).toString();
}

/**
 * Checks if a PIN is unique within a specific tenant's staff collection.
 */
export async function isPinUnique(tenantId: string, pin: string): Promise<boolean> {
  const { data: staffData, error } = await supabase
    .from('staff')
    .select('pin_hash')
    .eq('tenant_id', tenantId);
  
  if (error || !staffData) return true;
  
  for (const member of staffData) {
    if (member.pin_hash && await bcrypt.compare(pin, member.pin_hash)) {
      return false;
    }
  }
  
  return true;
}

/**
 * Hashes a PIN for secure storage.
 */
export async function hashPin(pin: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return await bcrypt.hash(pin, salt);
}
