const fs = require('fs');
let content = fs.readFileSync('src/components/ui/SmartSelect.tsx', 'utf8');

// Replace w-[var(--button-width)] with nothing, we'll use style instead
content = content.replace("w-[var(--button-width)]", "");

// Add style to Combobox.Options and Listbox.Options
content = content.replace(
  '<Combobox.Options className={popoverClasses} anchor="bottom">',
  '<Combobox.Options className={popoverClasses} anchor="bottom" style={{ width: "var(--button-width)" }}>'
);

content = content.replace(
  '<Listbox.Options className={popoverClasses} anchor="bottom">',
  '<Listbox.Options className={popoverClasses} anchor="bottom" style={{ width: "var(--button-width)" }}>'
);

fs.writeFileSync('src/components/ui/SmartSelect.tsx', content);
