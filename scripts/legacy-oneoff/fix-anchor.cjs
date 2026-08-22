const fs = require('fs');
let content = fs.readFileSync('src/components/ui/SmartSelect.tsx', 'utf8');

// Move anchor from Combobox.Options to Transition
content = content.replace(
  /<Transition (as=\{Fragment\} \{...transitionProps\}.*?)>\s*<Combobox\.Options anchor=\{\{ to: "bottom", gap: "8px" \}\}/g,
  `<Transition $1 anchor="bottom">\n              <Combobox.Options`
);

// Move anchor from Listbox.Options to Transition
content = content.replace(
  /<Transition (as=\{Fragment\} \{...transitionProps\})>\s*<Listbox\.Options anchor=\{\{ to: "bottom", gap: "8px" \}\}/g,
  `<Transition $1 anchor="bottom">\n            <Listbox.Options`
);

fs.writeFileSync('src/components/ui/SmartSelect.tsx', content);
