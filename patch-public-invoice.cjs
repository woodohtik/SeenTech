const fs = require('fs');
let content = fs.readFileSync('src/pages/PublicInvoice.tsx', 'utf8');

const newFetchCode = `
      try {
        const response = await fetch(\`/api/public/invoices/\${id}\`);
        if (!response.ok) {
          setError('لم يتم العثور على الفاتورة');
          setLoading(false);
          return;
        }
        
        const data = await response.json();
        
        setOrder(data.order);
        setTenant(data.tenant);
        setCustomer(data.customer);
`;

content = content.replace(
  /try \{\s*const \{ data: orderData, error: orderError \} = await supabase[\s\S]*?\} catch \(err: any\) \{/m,
  newFetchCode + "\n      } catch (err: any) {"
);

fs.writeFileSync('src/pages/PublicInvoice.tsx', content);
