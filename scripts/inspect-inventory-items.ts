import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || 'missing',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'missing'
);

async function run() {
  const { data, error } = await supabase.from('inventory_items').select('*').limit(1);
  if (error) {
    console.error("Error querying inventory_items:", error);
  } else {
    console.log("Success! Row keys:", data.length > 0 ? Object.keys(data[0]) : "No rows found");
    if (data.length > 0) {
      console.log("Sample row:", data[0]);
    }
  }
}
run();
