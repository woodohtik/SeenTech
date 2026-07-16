#!/bin/bash
cat << 'INNER_EOF' > /tmp/fix.js
const fs = require('fs');

let content = fs.readFileSync('src/components/POS.tsx', 'utf8');

// We need to restore the lost tags
const target = `                  <div className="w-full max-h-[50vh] overflow-y-auto bg-gray-100 rounded-xl border border-border p-4 flex justify-center custom-scrollbar">
                    {invoiceData && <ThermalInvoice data={invoiceData} size="80mm" />}
                  </div>
                      <QRCodeSVG value={completedOrder.qrCode} size={100} level="M" />
                    </div>
                    <button 
                      onClick={() => {
                        window.print();
                      }}`;
                      
const replacement = `                  <div className="w-full max-h-[50vh] overflow-y-auto bg-gray-100 rounded-xl border border-border p-4 flex justify-center custom-scrollbar">
                    {invoiceData && <ThermalInvoice data={invoiceData} size="80mm" />}
                  </div>
                  <div className="grid grid-cols-2 gap-3 w-full pt-4 print:hidden">
                    <button 
                      onClick={() => {
                        window.print();
                      }}`;

content = content.replace(target, replacement);
fs.writeFileSync('src/components/POS.tsx', content);
INNER_EOF
node /tmp/fix.js
