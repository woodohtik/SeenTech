import fs from 'fs';
import path from 'path';

function processFile(filePath) {
    if (!fs.existsSync(filePath)) return;
    let content = fs.readFileSync(filePath, 'utf-8');

    // Remove letter-spacing from CSS
    content = content.replace(/letter-spacing:\s*[-0-9.pxem]+;/g, '');
    content = content.replace(/letter-spacing:\s*[-0-9.pxem]+/g, '');

    // Increase line-height in base CSS
    content = content.replace(/line-height:1\.25/g, 'line-height:1.4');
    content = content.replace(/line-height:\s*1\.25;/g, 'line-height:1.4;');

    // Fix logo in header and footer
    // Let's replace the previous img tag with one having "سين" if not present already
    // but we might've already done it, so let's refine
    content = content.replace(
        /<img src="\/Logo\.svg" alt="سين" style="height: 38px; width: auto; object-fit: contain;" \/>/g,
        '<div style="display: flex; align-items: center; gap: 8px;"><img src="/Logo.svg" alt="" style="height: 38px; width: auto; object-fit: contain;" /><span style="font-family: Tajawal, sans-serif; font-size: 26px; font-weight: 800; color: var(--ink);">سين</span></div>'
    );
     content = content.replace(
        /<img src="\/Logo\.svg" alt="سين" style="height: 24px; width: auto; object-fit: contain;" \/>/g,
        '<div style="display: flex; align-items: center; gap: 6px;"><img src="/Logo.svg" alt="" style="height: 24px; width: auto; object-fit: contain;" /><span style="font-family: Tajawal, sans-serif; font-size: 16px; font-weight: 800; color: var(--ink);">سين</span></div>'
    );

    // If there is any 'ريال' or 'ر.س', replace it with ﷼ if it's standalone, but wait.
    // Actually, I shouldn't blind replace 'ريال' as it could be part of a sentence.
    // Let's just fix Subscribe.tsx.
    
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`Processed ${filePath}`);
}

processFile('seen-landing-page.html');
processFile('public/seen-landing.html');

// Process Subscribe.tsx as well for the Riyal symbol and logo
const subPath = 'src/components/Subscribe.tsx';
if (fs.existsSync(subPath)) {
    let sub = fs.readFileSync(subPath, 'utf-8');
    sub = sub.replace(/ر\.س/g, '﷼');
    sub = sub.replace(/letterSpacing: '-0.5px'/g, ''); // Fix letter spacing
    sub = sub.replace(/letterSpacing:\s*['"]-[0-9.]+px['"]/g, '');
    
    fs.writeFileSync(subPath, sub, 'utf-8');
    console.log('Processed Subscribe.tsx');
}

// Process POS.tsx for riyal symbol
const posPath = 'src/components/POS.tsx';
if (fs.existsSync(posPath)) {
    let pos = fs.readFileSync(posPath, 'utf-8');
    pos = pos.replace(/ريال(?=[\s.])/g, '﷼'); 
    
    fs.writeFileSync(posPath, pos, 'utf-8');
    console.log('Processed POS.tsx');
}
