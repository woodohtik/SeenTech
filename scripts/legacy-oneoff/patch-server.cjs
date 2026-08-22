const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');

const routeCode = `
app.get("/api/public/invoices/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    // Lazy import to ensure supabaseAdmin is initialized
    const { supabaseAdmin } = await import("./src/server/supabase-admin.ts");
    
    const { data: orderData, error: orderError } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('id', id)
      .maybeSingle();
      
    if (orderError || !orderData) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    
    const { data: tenantData } = await supabaseAdmin
      .from('tenants')
      .select('*')
      .eq('id', orderData.tenant_id)
      .maybeSingle();
      
    const { data: customerData } = await supabaseAdmin
      .from('customers')
      .select('*')
      .eq('id', orderData.customer_id)
      .maybeSingle();

    res.json({
      order: {
        ...orderData,
        orderNumber: orderData.order_number,
        orderDate: orderData.order_date,
        totalAmount: orderData.total_amount,
        paidAmount: orderData.paid_amount,
        vatAmount: orderData.vat_amount,
        paymentMethod: orderData.payment_method,
        tenantId: orderData.tenant_id,
      },
      tenant: tenantData ? {
        ...tenantData,
        storeName: tenantData.store_name,
        storeNameEn: tenantData.store_name_en,
        vatNumber: tenantData.vat_number,
        address: tenantData.address,
        logoUrl: tenantData.logo_url
      } : null,
      customer: customerData || null
    });
  } catch (err) {
    console.error("Error fetching invoice:", err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});
`;

if (!content.includes('/api/public/invoices/:id')) {
    content = content.replace(
      '// API Routes',
      '// API Routes\n' + routeCode
    );
    fs.writeFileSync('server.ts', content);
}
