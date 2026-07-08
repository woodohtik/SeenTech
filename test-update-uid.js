import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function test() {
  const { data: tenant } = await supabase.from('tenants').select('id').limit(1).single();
  
  const { data: staff } = await supabase.from('staff').insert({
    uid: null,
    name: "Test Name",
    role: "cashier",
    email: "test" + Date.now() + "@example.com",
    status: 'active',
    is_test: false,
    must_change_pin: false,
    tenant_id: tenant.id
  }).select().single();
  
  const { error } = await supabase.from('staff').update({ uid: "test-uid" }).eq('id', staff.id);
  console.log('Error updating UID:', error);
}

test();
