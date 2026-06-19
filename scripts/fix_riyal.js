import fs from 'fs';

function replaceRiyal(filePath) {
    if (!fs.existsSync(filePath)) return;
    let content = fs.readFileSync(filePath, 'utf-8');
    content = content.replace(/ريال سعودي/g, '﷼');
    content = content.replace(/ريال /g, '﷼ ');
    content = content.replace(/ ريال/g, ' ﷼');
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log('Processed', filePath);
}

replaceRiyal('src/components/CashOperationsModal.tsx');
replaceRiyal('src/components/PaymentVoucherModal.tsx');
