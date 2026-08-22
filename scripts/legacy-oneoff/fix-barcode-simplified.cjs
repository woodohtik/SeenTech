const fs = require('fs');
let content = fs.readFileSync('src/components/printing/SimplifiedTaxInvoice.tsx', 'utf8');

if (!content.includes('import Barcode from')) {
    content = content.replace("import { QRCodeSVG } from 'qrcode.react';", "import { QRCodeSVG } from 'qrcode.react';\nimport Barcode from 'react-barcode';");
}

if (!content.includes('<Barcode value={')) {
    content = content.replace(
        `        {/* Compliant ZATCA QR Code */}`,
        `        {/* 1D Barcode for quick scanning */}
        <div className="flex flex-col items-center justify-center py-2 mb-2">
          <Barcode value={invoiceNumber} width={1.5} height={40} fontSize={12} margin={0} displayValue={true} />
        </div>

        {/* Compliant ZATCA QR Code */}`
    );
}

fs.writeFileSync('src/components/printing/SimplifiedTaxInvoice.tsx', content);
