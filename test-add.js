import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function test() {
  const { data: tenant } = await supabase.from('tenants').select('id').limit(1).single();
  const uid = "test-uid-456";
  const data = {
    email: "test456@example.com",
    name: "Test Name 456"
  };

  // 1. Ensure user exists
  const { error: upsertErr } = await supabase.from('users').upsert(
    { id: uid, email: data.email.toLowerCase(), display_name: data.name }, 
    { onConflict: 'id' }
  );
  console.log('Upsert Users Error:', upsertErr);

  // 2. Insert Staff
  const { error } = await supabase.from('staff').insert({
    uid: uid,
    name: data.name,
    role: "cashier",
    email: data.email,
    status: 'active',
    is_test: false,
    must_change_pin: false,
    tenant_id: tenant.id
  });
  console.log('Insert Staff Error:', error);
}

test();
