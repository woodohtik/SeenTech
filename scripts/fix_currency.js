import fs from 'fs';

function processFile(filePath) {
    if (!fs.existsSync(filePath)) return;
    let content = fs.readFileSync(filePath, 'utf-8');

    // Replace various instances of ريال and ر.س and related
    content = content.replace(/ريال/g, '﷼');
    content = content.replace(/ر\.س/g, '﷼');

    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`Processed ${filePath}`);
}

processFile('seen-landing-page.html');
processFile('public/seen-landing.html');
