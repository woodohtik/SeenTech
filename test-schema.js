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
  const res = await client.query(`
    SELECT data_type 
    FROM information_schema.columns 
    WHERE table_name = 'audit_logs' AND column_name = 'performed_by';
  `);
  console.log('Type:', res.rows[0].data_type);
  await client.end();
}
run().catch(console.error);
