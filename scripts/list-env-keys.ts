import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

console.log('All process.env keys:', Object.keys(process.env).sort());
