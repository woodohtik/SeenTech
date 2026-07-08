import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || 'missing',
  process.env.VITE_SUPABASE_ANON_KEY || 'missing'
);

async function run() {
  const { data, error } = await supabase.rpc('get_table_schema', { table_name: 'saas_settings' });
  console.log("Schema:", data, "Error:", error);
}
run();
