import fs from 'fs';

function processFile(filePath) {
    if (!fs.existsSync(filePath)) return;
    let content = fs.readFileSync(filePath, 'utf-8');

    // Add robust flex-col styling for text columns to prevent overlapping overlapping words 
    content = content.replace(/<\/style>/g, '  .who span:not(.ava) { display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 2px; }\n</style>');
    
    // Also, revert nm and sub display:block if any since the parent handles flex now
    content = content.replace(/\.pc-order \.nm\{display:block;/g, '.pc-order .nm{');
    content = content.replace(/\.pc-order \.sub\{display:block;/g, '.pc-order .sub{');
    content = content.replace(/\.orow \.nm\{display:block;/g, '.orow .nm{');
    content = content.replace(/\.orow \.ms\{display:block;/g, '.orow .ms{');

    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`Processed layout fix for ${filePath}`);
}

processFile('seen-landing-page.html');
processFile('public/seen-landing.html');
