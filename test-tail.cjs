const fs = require('fs');
const content = fs.readFileSync('src/components/ui/SmartSelect.tsx', 'utf8');
console.log(content.includes('w-[var(--button-width)]'));
