console.log(Object.keys(process.env).filter(k => !k.includes('KEY') && !k.includes('SECRET') && !k.includes('PASSWORD')));
console.log("Database related keys:", Object.keys(process.env).filter(k => k.toLowerCase().includes('db') || k.toLowerCase().includes('pass') || k.toLowerCase().includes('postgres')));
