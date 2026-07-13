const fs = require('fs');
let content = fs.readFileSync('src/components/ui/SmartSelect.tsx', 'utf8');

// Change popoverClasses
content = content.replace(
  /'absolute left-0 right-0 z-\[100\] mt-2 max-h-64 overflow-y-auto rounded-3xl bg-surface p-2.5 text-sm shadow-xl border border-border dark:border-gray-800 focus:outline-none scrollbar-hide',/g,
  `'z-[100] w-[var(--button-width)] max-h-64 overflow-y-auto rounded-3xl bg-surface p-2.5 text-sm shadow-xl border border-border dark:border-gray-800 focus:outline-none scrollbar-hide',`
);

// Add anchor to Combobox.Options
content = content.replace(
  /<Combobox\.Options className=\{popoverClasses\}>/g,
  `<Combobox.Options anchor={{ to: "bottom", gap: "8px" }} className={popoverClasses}>`
);

// Add anchor to Listbox.Options
content = content.replace(
  /<Listbox\.Options className=\{popoverClasses\}>/g,
  `<Listbox.Options anchor={{ to: "bottom", gap: "8px" }} className={popoverClasses}>`
);

fs.writeFileSync('src/components/ui/SmartSelect.tsx', content);
