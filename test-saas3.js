import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function test() {
  try {
    const res1 = await supabase.from('users').upsert({
      id: "non-existent-user-id",
      email: "test3@example.com",
      display_name: "Test Name",
    }, { onConflict: 'id' });
    console.log('users error:', res1.error);
    
    const res2 = await supabase.from('saas_users').upsert({
      uid: "non-existent-user-id",
      email: "test3@example.com",
      name: "Test Name",
      role: "super_admin",
      is_active: true
    }, {
      onConflict: 'uid'
    });
    console.log('saas_users error:', res2.error);
  } catch (e) {
    console.log("Exception:", e);
  }
}

test();
