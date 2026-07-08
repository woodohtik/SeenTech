import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function test() {
  const { error } = await supabase.from('saas_users').upsert({
    uid: "non-existent-user-id",
    email: "test2@example.com",
    name: "Test Name",
    role: "super_admin",
    is_active: true
  }, {
    onConflict: 'uid'
  });
  console.log('Error:', error);
}

test();
