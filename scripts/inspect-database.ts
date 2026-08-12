import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || 'missing',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'missing'
);

async function run() {
  const tables = ['item_uom_conversions', 'uom_conversion_logs', 'inventory_adjustments', 'inventory_adjustment_items'];
  for (const table of tables) {
    const { data, error } = await supabase.from(table).select('*').limit(1);
    if (error) {
      console.log(`Table ${table} query failed:`, error.message);
    } else {
      console.log(`Table ${table} exists! Row count sampled:`, data.length);
      if (data.length > 0) {
        console.log(`Sample row columns:`, Object.keys(data[0]));
      }
    }
  }
}
run();
