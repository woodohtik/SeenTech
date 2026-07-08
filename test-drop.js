import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Client } = pg;
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  const res = await client.query('ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_uid_fkey;');
  console.log('Result:', res);
  await client.end();
}
run().catch(console.error);
