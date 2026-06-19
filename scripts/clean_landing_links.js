import fs from 'fs';

function processFile(filePath) {
    if (!fs.existsSync(filePath)) return;
    let content = fs.readFileSync(filePath, 'utf-8');

    // Remove duplicates or complex string patterns of onclick
    content = content.replace(/\s*onclick="window\.location\.href='\/login'; return false;"/g, '');

    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`Cleaned and simplified links in ${filePath}`);
}

processFile('seen-landing-page.html');
processFile('public/seen-landing.html');
