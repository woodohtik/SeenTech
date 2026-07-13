const fs = require('fs');
let content = fs.readFileSync('src/components/Inventory/InventoryManager.tsx', 'utf8');

// Undo the bad replace
content = content.replace(/\{formData\.category === "ready_made" && \(\s*<motion\.div\s*initial=\{\{ height: 0, opacity: 0 \}\}\s*animate=\{\{ height: "auto", opacity: 1 \}\}\s*exit=\{\{ height: 0, opacity: 0 \}\}\s*className="overflow-hidden"\s*> \(\s*<motion\.div\s*initial=\{\{ height: 0, opacity: 0, overflow: "hidden" \}\}\s*animate=\{\{ height: "auto", opacity: 1, transitionEnd: \{ overflow: "visible" \} \}\}\s*exit=\{\{ height: 0, opacity: 0, overflow: "hidden" \}\}\s*>/g, 
`{formData.category === "ready_made" && (
              <motion.div
                initial={{ height: 0, opacity: 0, overflow: "hidden" }}
                animate={{ height: "auto", opacity: 1, transitionEnd: { overflow: "visible" } }}
                exit={{ height: 0, opacity: 0, overflow: "hidden" }}
              >`);
              
fs.writeFileSync('src/components/Inventory/InventoryManager.tsx', content);
