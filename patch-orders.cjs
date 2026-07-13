const fs = require('fs');
let content = fs.readFileSync('src/components/Orders.tsx', 'utf8');

const effectCode = `
  useEffect(() => {
    let barcodeBuffer = '';
    let barcodeTimeout: NodeJS.Timeout;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Allow rapid scanning from anywhere
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key === 'Enter') {
          // If they pressed Enter in the search box
          if ((e.target as HTMLInputElement).placeholder?.includes('ابحث برقم')) {
             if (filteredOrders.length === 1) {
                 setSelectedOrder(filteredOrders[0]);
                 setIsInvoiceOpen(true);
             }
          }
        }
        return;
      }

      if (e.key === 'Enter') {
        if (barcodeBuffer.length > 2) {
          const scanned = barcodeBuffer.toLowerCase();
          const matchedOrder = orders.find(o => 
             (o as any).invoiceNumber?.toString().toLowerCase() === scanned ||
             o.orderNumber?.toString().toLowerCase() === scanned ||
             o.id.toLowerCase() === scanned
          );
          if (matchedOrder) {
             setSearch(scanned);
             setSelectedOrder(matchedOrder);
             setIsInvoiceOpen(true);
          } else {
             // Try searching just by includes to be safe
             const partialMatch = orders.find(o => 
                 (o as any).invoiceNumber?.toString().toLowerCase().includes(scanned) ||
                 o.orderNumber?.toString().toLowerCase().includes(scanned) ||
                 o.id.toLowerCase().includes(scanned)
             );
             if (partialMatch) {
                 setSearch(scanned);
                 setSelectedOrder(partialMatch);
                 setIsInvoiceOpen(true);
             }
          }
        }
        barcodeBuffer = '';
      } else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        barcodeBuffer += e.key;
        clearTimeout(barcodeTimeout);
        barcodeTimeout = setTimeout(() => {
          barcodeBuffer = '';
        }, 50); // Scanners are very fast, usually < 30ms per character
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
      clearTimeout(barcodeTimeout);
    };
  }, [orders, filteredOrders]);
`;

content = content.replace(
  "  }, [searchParams, customers, setValue]);",
  "  }, [searchParams, customers, setValue]);\n" + effectCode
);

fs.writeFileSync('src/components/Orders.tsx', content);
