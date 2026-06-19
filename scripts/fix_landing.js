import fs from 'fs';

function processFile(filePath) {
    if (!fs.existsSync(filePath)) return;
    let content = fs.readFileSync(filePath, 'utf-8');

    // Make .nm, .sub, .ms block display so they don't overlap within their parent span
    content = content.replace(/\.pc-order \.nm\{/g, '.pc-order .nm{display:block;');
    content = content.replace(/\.pc-order \.sub\{/g, '.pc-order .sub{display:block;');
    content = content.replace(/\.orow \.nm\{/g, '.orow .nm{display:block;');
    content = content.replace(/\.orow \.ms\{/g, '.orow .ms{display:block;');

    // Perfect alignment of the logo text in the header and footer
    content = content.replace(
        /<span style="font-family: Tajawal, sans-serif; font-size: 26px; font-weight: 800; color: var\(--ink\);">سين<\/span>/g,
        '<span style="font-family: Tajawal, sans-serif; font-size: 26px; font-weight: 800; color: var(--ink); line-height: 1; padding-top: 6px;">سين</span>'
    );
     // And for the sidebar logo text
    content = content.replace(
        /<span style="font-family: Tajawal, sans-serif; font-size: 16px; font-weight: 800; color: var\(--ink\);">سين<\/span>/g,
        '<span style="font-family: Tajawal, sans-serif; font-size: 16px; font-weight: 800; color: var(--ink); line-height: 1; padding-top: 4px;">سين</span>'
    );

    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`Processed ${filePath}`);
}

processFile('seen-landing-page.html');
processFile('public/seen-landing.html');
