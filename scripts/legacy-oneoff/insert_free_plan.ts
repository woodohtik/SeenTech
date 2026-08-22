import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || 'missing',
  process.env.VITE_SUPABASE_ANON_KEY || 'missing'
);

async function run() {
  const { error } = await supabase.from('plans').insert({
    id: 'free',
    name: 'الباقة المجانية',
    price: 0,
    features: ['تجربة 14 يوم', 'عدد لا محدود من الفواتير', 'بدون ربط بطاقة'],
    max_staff: 2,
    max_orders: 100,
    is_active: true
  });
  console.log("Insert Error:", error);
}
run();
