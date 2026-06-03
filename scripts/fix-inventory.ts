import fs from 'fs';
import path from 'path';

const SRC_DIR = path.resolve(process.cwd(), 'src');

function walkDir(dir: string, callback: (filePath: string) => void) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      walkDir(filePath, callback);
    } else if (stat.isFile() && (filePath.endsWith('.ts') || filePath.endsWith('.tsx'))) {
      callback(filePath);
    }
  }
}

console.log("Starting script to clean up table name references from 'inventory' to 'inventory_items'...");

let modifiedCount = 0;

walkDir(SRC_DIR, (filePath) => {
  let content = fs.readFileSync(filePath, 'utf-8');
  let hasChanges = false;

  // 1. Replace supabase.from('inventory') with supabase.from('inventory_items')
  if (content.includes("from('inventory')")) {
    content = content.replace(/from\('inventory'\)/g, "from('inventory_items')");
    hasChanges = true;
  }
  if (content.includes('from("inventory")')) {
    content = content.replace(/from\("inventory"\)/g, 'from("inventory_items")');
    hasChanges = true;
  }

  // 2. Replace table: 'inventory' with table: 'inventory_items'
  if (content.includes("table: 'inventory'")) {
    content = content.replace(/table:\s*'inventory'/g, "table: 'inventory_items'");
    hasChanges = true;
  }
  if (content.includes('table: "inventory"')) {
    content = content.replace(/table:\s*"inventory"/g, 'table: "inventory_items"');
    hasChanges = true;
  }

  // 3. Replace 'inventory' in clean-up arrays
  // For safety, let's check if the file is one of the files where we found an array.
  // Those are Settings.tsx, Dashboard.tsx, SaaSSystemSettings.tsx
  const fileName = path.basename(filePath);
  if (['Settings.tsx', 'Dashboard.tsx', 'SaaSSystemSettings.tsx'].includes(fileName)) {
    if (content.includes("'inventory'")) {
      // Specifically replace 'inventory' item inside arrays like ['orders', 'customers', 'inventory', 'staff', 'notifications']
      // Or in SaaSSystemSettings.tsx's tables array
      content = content.replace(/'inventory'/g, "'inventory_items'");
      hasChanges = true;
      console.log(`Replacing array item in ${fileName}`);
    }
  }

  if (hasChanges) {
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`Updated file: ${filePath}`);
    modifiedCount++;
  }
});

console.log(`Completed table name alignment! Modified ${modifiedCount} files.`);
