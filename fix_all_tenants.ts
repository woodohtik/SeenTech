import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || 'missing',
  process.env.VITE_SUPABASE_ANON_KEY || 'missing'
);

async function run() {
  const { data: tenants } = await supabase.from('tenants').select('id, name, plan_id, created_at');
  if (tenants) {
    const tenantsToFix = tenants.filter(t => t.plan_id === 'basic');
    console.log(`Found ${tenantsToFix.length} tenants to fix`);
    for (const t of tenantsToFix) {
      await supabase.from('tenants').update({ plan_id: 'free' }).eq('id', t.id);
    }
    console.log('Fixed!');
  }
}
run();
