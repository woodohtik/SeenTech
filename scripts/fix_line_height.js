import fs from 'fs';

function processFile(filePath) {
    if (!fs.existsSync(filePath)) return;
    let content = fs.readFileSync(filePath, 'utf-8');

    // Increase line-height in places where it might overlap
    content = content.replace(/line-height:1\.1/g, 'line-height:1.3');
    content = content.replace(/line-height:1\.2\}/g, 'line-height:1.4}');
    content = content.replace(/line-height:1\.2;/g, 'line-height:1.4;');

    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`Processed ${filePath}`);
}

processFile('seen-landing-page.html');
processFile('public/seen-landing.html');
