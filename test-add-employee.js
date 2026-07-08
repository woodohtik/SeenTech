import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const { data: tenant } = await supabase.from('tenants').select('id').limit(1).single();
  const tenantId = tenant.id;
  
  const { error } = await supabase.from('staff').insert({
    name: 'Test',
    role: 'cashier',
    email: 'test' + Date.now() + '@example.com',
    status: 'active',
    is_test: false,
    must_change_pin: false,
    tenant_id: tenantId,
    created_at: new Date().toISOString()
  });
  console.log('Error adding staff:', error);
  
  const { error: auditError } = await supabase.from('audit_logs').insert({
    action: 'إضافة موظف',
    performed_by: null,
    performed_by_email: 'unknown',
    target_tenant_id: tenantId,
    details: 'تم إضافة الموظف بنجاح',
    occurred_at: new Date().toISOString(),
    type: 'security'
  });
  console.log('Error adding audit log:', auditError);
}

test();
