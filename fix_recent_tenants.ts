import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || 'missing',
  process.env.VITE_SUPABASE_ANON_KEY || 'missing'
);

async function run() {
  const { data: tenants } = await supabase.from('tenants').select('id, created_at, plan_id');
  if (tenants) {
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const tenantsToFix = tenants.filter(t => t.plan_id === 'basic' && new Date(t.created_at) > fourteenDaysAgo);
    console.log(`Found ${tenantsToFix.length} tenants to fix`);
    for (const t of tenantsToFix) {
      await supabase.from('tenants').update({ plan_id: 'free' }).eq('id', t.id);
    }
    console.log('Fixed!');
  }
}
run();
