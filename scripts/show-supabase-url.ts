import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

console.log('Supabase URL:', process.env.VITE_SUPABASE_URL);
