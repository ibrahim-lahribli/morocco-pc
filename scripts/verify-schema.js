require('dotenv').config();
const { Client } = require('pg');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('ERROR: DATABASE_URL is not set in .env');
    process.exit(1);
  }

  const client = new Client({ connectionString });

  try {
    await client.connect();

    const tables = ['manufacturer', 'socket', 'platform', 'memory_type', 'platform_memory_support', 'product_family', 'product', 'product_variant'];

    for (const table of tables) {
      const cols = await client.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position
      `, [table]);

      console.log(`\n${table}:`);
      cols.rows.forEach(r => {
        console.log(`  ${r.column_name}: ${r.data_type}${r.is_nullable === 'YES' ? ' NULL' : ' NOT NULL'}${r.column_default ? ' DEFAULT ' + r.column_default : ''}`);
      });
    }

    await client.end();
  } catch (err) {
    console.error('ERROR:', err.message);
    if (client) await client.end();
    process.exit(1);
  }
}

main();
