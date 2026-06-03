import { supabase } from '../lib/supabase/client';
import { seedGlobalRoles } from './permissionService';

export const seedSaaSUsers = async () => {
  // Logic moved to initialization/onboarding
};

export const autoSeed = async () => {
  try {
    // Seed Global Roles
    await seedGlobalRoles();

    const { data: plansData, error: plansError } = await supabase.from('plans').select('id');
    if (plansData && plansData.length === 0) {
      console.log('Seeding initial data...');
      
      // 1. Seed Plans
      const plans = [
        { id: 'basic', name: 'الخطة الأساسية', price: 99, features: ['إدارة العملاء', 'إدارة الطلبات', 'موظف واحد'], max_staff: 1, max_orders: 100 },
        { id: 'pro', name: 'الخطة الاحترافية', price: 299, features: ['إدارة المخزون', 'تقارير متقدمة', '5 موظفين'], max_staff: 5, max_orders: 500 },
        { id: 'enterprise', name: 'خطة الشركات', price: 999, features: ['دعم فني 24/7', 'عدد غير محدود', 'تخصيص كامل'], max_staff: 100, max_orders: 10000 }
      ];
      await supabase.from('plans').insert(plans);

      // 2. Seed Sample Requests
      const sampleRequests = [
        { name: 'أحمد محمد', email: 'ahmed@test.com', phone: '0501234567', shop_name: 'خياط الأناقة', status: 'pending', created_at: new Date().toISOString() },
        { name: 'سارة علي', email: 'sara@test.com', phone: '0559876543', shop_name: 'مشغل سارة', status: 'pending', created_at: new Date().toISOString() }
      ];
      await supabase.from('tailor_requests').insert(sampleRequests);

      // 3. Seed a Sample Active Tenant
      const sampleTenantId = 'sample_tenant_123';
      await supabase.from('tenants').insert({
        id: sampleTenantId,
        name: 'خياط التجربة المثالي',
        owner_email: 'demo@tailor.com',
        phone: '0540000000',
        status: 'active',
        plan_id: 'pro',
        created_at: new Date().toISOString()
      });

      // 4. Seed Data for the Sample Tenant
      const sampleStaff = [
        { name: 'خالد الموظف', email: 'khaled@demo.com', phone: '0561112223', role: 'tailor', status: 'active', tenant_id: sampleTenantId, created_at: new Date().toISOString() },
        { name: 'عمر المحاسب', email: 'omar@demo.com', phone: '0564445556', role: 'cashier', status: 'active', tenant_id: sampleTenantId, created_at: new Date().toISOString() }
      ];
      await supabase.from('staff').insert(sampleStaff);

      const sampleCustomers = [
        { name: 'محمد العتيبي', phone: '0599999999', tenant_id: sampleTenantId, measurements: { length: 150, shoulder: 45, chest: 100 }, created_at: new Date().toISOString() },
        { name: 'فهد الشمري', phone: '0588888888', tenant_id: sampleTenantId, measurements: { length: 155, shoulder: 48, chest: 110 }, created_at: new Date().toISOString() },
        { name: 'عبدالله القحطاني', phone: '0577777777', tenant_id: sampleTenantId, measurements: { length: 148, shoulder: 42, chest: 95 }, created_at: new Date().toISOString() }
      ];
      const { data: customerData } = await supabase.from('customers').insert(sampleCustomers).select();

      if (customerData) {
        const sampleOrders = [
          { customer_id: customerData[0].id, customer_name: customerData[0].name, tenant_id: sampleTenantId, items: [{ garmentType: 'ثوب', fabric: 'قطن ياباني', quantity: 1, price: 250 }], total_amount: 250, paid_amount: 250, status: 'delivered', order_date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), delivery_date: new Date().toISOString() },
          { customer_id: customerData[1].id, customer_name: customerData[1].name, tenant_id: sampleTenantId, items: [{ garmentType: 'ثوب شتوي', fabric: 'صوف', quantity: 1, price: 450 }], total_amount: 450, paid_amount: 200, status: 'in-progress', order_date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), delivery_date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString() },
          { customer_id: customerData[2].id, customer_name: customerData[2].name, tenant_id: sampleTenantId, items: [{ garmentType: 'بشت', fabric: 'يدوي', quantity: 1, price: 1200 }], total_amount: 1200, paid_amount: 500, status: 'pending', order_date: new Date().toISOString(), delivery_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString() }
        ];
        await supabase.from('orders').insert(sampleOrders);
      }

      // 5. Seed Inventory
      const sampleInventory = [
        { name: 'قماش قطن أبيض', category: 'fabric', quantity: 50, unit: 'meter', base_unit: 'meter', sku: 'COT-WHT', min_threshold: 10, price_per_unit: 45, tenant_id: sampleTenantId, updated_at: new Date().toISOString() },
        { name: 'خيوط ملونة', category: 'thread', quantity: 100, unit: 'spool', base_unit: 'piece', sku: 'THRD-CLR', min_threshold: 20, price_per_unit: 5, tenant_id: sampleTenantId, updated_at: new Date().toISOString() },
        { name: 'أزرار صدف', category: 'button', quantity: 500, unit: 'box', base_unit: 'piece', sku: 'BTN-SDF', min_threshold: 50, price_per_unit: 2, tenant_id: sampleTenantId, updated_at: new Date().toISOString() }
      ];
      await supabase.from('inventory_items').insert(sampleInventory);
      return true;
    }
  } catch (error) {
    console.error('Seeding error:', error);
    return false;
  }
  return false;
};
