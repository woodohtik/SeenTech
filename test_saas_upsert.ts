import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || 'missing',
  process.env.VITE_SUPABASE_ANON_KEY || 'missing'
);

async function run() {
  const brandingSettings = { companyName: "Test" };
  const { data, error } = await supabase.from('saas_settings').upsert({
    key: 'branding',
    value: brandingSettings,
    updated_at: new Date().toISOString(),
    updated_by: 'test@example.com'
  }, { onConflict: 'key' });
  console.log("Upsert Error:", error);
}
run();
