import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function test() {
  const { data: tenant } = await supabase.from('tenants').select('id').limit(1).single();
  const { error } = await supabase.from('audit_logs').insert({
    action: 'إضافة موظف',
    performed_by: "محمد",
    performed_by_email: 'test@test.com',
    target_tenant_id: tenant.id,
    details: 'تم إضافة الموظف بنجاح',
    occurred_at: new Date().toISOString(),
    type: 'security'
  });
  console.log('Error adding audit log:', error);
}

test();
