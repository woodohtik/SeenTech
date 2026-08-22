#!/bin/bash
cat << 'INNER_EOF' > /tmp/print-area-replace.js
const fs = require('fs');

let content = fs.readFileSync('src/components/POS.tsx', 'utf8');

const startTag = '{/* Hidden Invoice to Print */}';
const endTag = '</div>\n    </div>\n  );\n}';

const startIndex = content.indexOf(startTag);
const endIndex = content.lastIndexOf(endTag);

if (startIndex === -1 || endIndex === -1) {
  console.error("Tags not found");
  process.exit(1);
}

const replacement = `{/* Hidden Invoice to Print */}
      {completedOrder && invoiceData && (
        <div id="pos-invoice-print-area" className="fixed top-[100%] left-[100%] w-[800px] -z-50 pointer-events-none bg-white font-sans text-black print:static print:w-full print:block print:max-w-none print:m-0 print:p-0" dir="rtl">
          {invoiceData.invoiceType === 'standard_b2b' ? (
             <StandardInvoice data={invoiceData} size="A4" />
          ) : (
             <ThermalInvoice data={invoiceData} size="80mm" />
          )}
        </div>
      )}
`;

const newContent = content.slice(0, startIndex) + replacement + content.slice(endIndex);

fs.writeFileSync('src/components/POS.tsx', newContent);
console.log("Replaced successfully!");
INNER_EOF
node /tmp/print-area-replace.js
