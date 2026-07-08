import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function test() {
  const { error } = await supabase.from('users').upsert({ id: "test-uid", email: "test@example.com", full_name: "Test" }, { onConflict: 'id' });
  console.log('Error full_name:', error);
  const { error: err2 } = await supabase.from('users').upsert({ id: "test-uid", email: "test@example.com", display_name: "Test" }, { onConflict: 'id' });
  console.log('Error display_name:', err2);
}
test();
