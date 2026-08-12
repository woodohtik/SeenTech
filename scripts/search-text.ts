import fs from 'fs';
import path from 'path';

function walkDir(dir: string, callback: (filePath: string) => void) {
  fs.readdirSync(dir).forEach(f => {
    const dirPath = path.join(dir, f);
    if (f === 'node_modules' || f === 'dist' || f === '.git') return;
    const isDirectory = fs.statSync(dirPath).isDirectory();
    if (isDirectory) {
      walkDir(dirPath, callback);
    } else {
      callback(dirPath);
    }
  });
}

const keywords = ['الفيدر', 'جاري تحكم', 'الفيدراليه', 'الفيدرالية', 'ساس الفيدر', 'تحكم لوحة'];

walkDir('.', (filePath) => {
  if (filePath.endsWith('.ts') || filePath.endsWith('.tsx') || filePath.endsWith('.json') || filePath.endsWith('.html') || filePath.endsWith('.css') || filePath.endsWith('.js') || filePath.endsWith('.sh') || filePath.endsWith('.sql')) {
    const content = fs.readFileSync(filePath, 'utf-8');
    keywords.forEach(kw => {
      if (content.includes(kw)) {
        console.log(`Found "${kw}" in ${filePath}`);
        const lines = content.split('\n');
        lines.forEach((line, idx) => {
          if (line.includes(kw)) {
            console.log(`  Line ${idx + 1}: ${line.trim()}`);
          }
        });
      }
    });
  }
});
