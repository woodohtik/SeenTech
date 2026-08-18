import { supabase } from '../lib/supabase/client';

/**
 * Generates a secure random numeric PIN of specified length using a CSPRNG
 * (crypto.getRandomValues), not Math.random() (predictable given enough
 * observed outputs).
 */
export function generateSecurePin(length: 4 | 6 = 4): string {
  const min = Math.pow(10, length - 1);
  const range = Math.pow(10, length) - min;
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return Math.floor(min + (buf[0] / (0xffffffff + 1)) * range).toString();
}

/**
 * Checks if a PIN is unique within a specific tenant's staff collection.
 * Verified server-side (see POST /api/staff/verify-pin) — never fetches
 * other staff members' bcrypt pin_hash values to the browser.
 */
export async function isPinUnique(tenantId: string, pin: string): Promise<boolean> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/staff/verify-pin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token || ''}`,
      },
      body: JSON.stringify({ pin, mode: 'check-unique' }),
    });
    if (!res.ok) return true;
    const payload = await res.json().catch(() => null);
    return payload?.isUnique !== false;
  } catch {
    return true;
  }
}

/**
 * Stored and compared as a plain 4-digit string, not bcrypt-hashed — per
 * explicit product decision, so an admin can look a staff member's PIN back
 * up (GET /api/staff/pins) to hand it out or resolve a "PIN doesn't work"
 * report. Kept as an async function so every call site set up for the old
 * hashing step didn't need to change.
 */
export async function hashPin(pin: string): Promise<string> {
  return pin.trim();
}
