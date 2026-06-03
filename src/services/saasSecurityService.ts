import { supabase } from '../lib/supabase/client';
import { auth } from '../lib/firebase';

export enum SaaSUserRole {
  SUPER_ADMIN = 'super_admin',
  SUPPORT = 'support_tech',
  BILLING = 'billing_admin'
}

export interface SaaSSecurityLog {
  userId: string;
  userEmail: string;
  action: string;
  details: string;
  ipAddress: string;
  userAgent: string;
  timestamp: string;
}

export const logSaaSSecurityEvent = async (action: string, details: string) => {
  try {
    const ipResponse = await fetch('https://api.ipify.org?format=json').catch(() => ({ json: () => Promise.resolve({ ip: 'unknown' }) }));
    const { ip } = await (ipResponse as any).json();

    const { error } = await supabase
      .from('saas_security_logs')
      .insert({
        user_id: auth.currentUser?.uid,
        user_email: auth.currentUser?.email,
        action,
        details,
        ip_address: ip,
        user_agent: navigator.userAgent,
        created_at: new Date().toISOString()
      });
    
    if (error) throw error;
  } catch (error) {
    console.error('Error logging SaaS security event:', error);
  }
};

export const verifySaaSStaff = async (email: string): Promise<boolean> => {
  // Only official company emails allowed
  const officialDomains = ['seen.system', 'gmail.com']; 
  const domain = email.split('@')[1];
  return officialDomains.includes(domain);
};

export const getSaaSUserRole = async (uid: string): Promise<SaaSUserRole | null> => {
  const { data, error } = await supabase
    .from('saas_users')
    .select('role')
    .eq('uid', uid)
    .single();
  
  if (data && !error) {
    return data.role as SaaSUserRole;
  }
  return null;
};
