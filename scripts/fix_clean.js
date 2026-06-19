import fs from 'fs';

function processFile(filePath) {
    if (!fs.existsSync(filePath)) return;
    let content = fs.readFileSync(filePath, 'utf-8');

    content = content.replace(/onclick="window\.location\.href='\/login'; return false;"\s*onclick="window\.location\.href='\/login'; return false;"/g, 'onclick="window.location.href=\'/login\'; return false;"');

    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`Cleaned duplicates in ${filePath}`);
}

processFile('seen-landing-page.html');
processFile('public/seen-landing.html');
