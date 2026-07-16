#!/bin/bash
cat << 'INNER_EOF' > /tmp/success-modal.ts
                  <div className="w-full max-h-[50vh] overflow-y-auto bg-gray-100 rounded-xl border border-border p-4 flex justify-center custom-scrollbar">
                    {invoiceData && <ThermalInvoice data={invoiceData} size="80mm" />}
                  </div>
INNER_EOF
