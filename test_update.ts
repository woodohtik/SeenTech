import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || 'missing',
  process.env.VITE_SUPABASE_ANON_KEY || 'missing'
);

async function run() {
  // Try to update a tenant
  const { data: tenants } = await supabase.from('tenants').select('id').limit(1);
  if (tenants && tenants.length > 0) {
    const { error } = await supabase.from('tenants').update({ plan_id: 'free' }).eq('id', tenants[0].id);
    console.log("Error:", error);
  }
}
run();
