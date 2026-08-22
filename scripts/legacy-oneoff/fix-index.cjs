const fs = require('fs');
let content = fs.readFileSync('index.html', 'utf8');
content = content.replace(
  '<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@300;400;500;700;800;900&display=swap" rel="stylesheet">',
  '<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@300;400;500;700;800;900&display=swap" rel="stylesheet" crossorigin="anonymous">'
);
fs.writeFileSync('index.html', content);
