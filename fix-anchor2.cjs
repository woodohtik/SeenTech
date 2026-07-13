const fs = require('fs');
let content = fs.readFileSync('src/components/ui/SmartSelect.tsx', 'utf8');

// The `anchor` prop should be on Combobox.Options and Listbox.Options, NOT Transition!
// And it should not be on Transition! 

// 1. Remove anchor from Transition
content = content.replace(/<Transition (.*?) anchor="bottom">/g, '<Transition $1>');

// 2. Add anchor back to Options but ignore TS error if needed, or simply let the CSS do the floating instead of using anchor if headlessui version doesn't fully support it in TS.
// Wait, TS says `anchor` doesn't exist on Transition. That's because anchor is for Options.
// Let's add it back to Options and remove from transition
content = content.replace(/<Combobox\.Options className=\{popoverClasses\}>/g, '<Combobox.Options className={popoverClasses} anchor="bottom">');
content = content.replace(/<Listbox\.Options className=\{popoverClasses\}>/g, '<Listbox.Options className={popoverClasses} anchor="bottom">');

fs.writeFileSync('src/components/ui/SmartSelect.tsx', content);
