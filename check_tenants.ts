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
  console.log("Tenants:");
  tenants?.forEach(t => console.log(`${t.name}: ${t.plan_id}`));
}
run();
