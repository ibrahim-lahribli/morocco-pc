require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function runMigration(filePath, client) {
  const sql = fs.readFileSync(filePath, 'utf8');
  await client.query(sql);
  console.log(`MIGRATED: ${path.basename(filePath)}`);
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('ERROR: DATABASE_URL is not set in .env');
    process.exit(1);
  }

  const client = new Client({ connectionString });

  try {
    await client.connect();
    console.log('Connected to PostgreSQL database');

    const migrationsDir = path.join(process.cwd(), 'database', 'migrations');
    const files = fs.readdirSync(migrationsDir).sort();

    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      await runMigration(filePath, client);
    }

    console.log('\n--- Verification ---');

    const tablesResult = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
    );
    console.log('Tables:', tablesResult.rows.length === 0 ? 'None' : tablesResult.rows.map(r => r.table_name).join(', '));

    const fksResult = await client.query(`
      SELECT tc.table_name, kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
      ORDER BY tc.table_name, kcu.column_name
    `);
    console.log('Foreign keys:', fksResult.rows.length === 0 ? 'None' : `${fksResult.rows.length} found`);

    const enumsResult = await client.query(
      "SELECT typname FROM pg_type WHERE typtype = 'e' AND typnamespace = 'public'::regnamespace::oid ORDER BY typname"
    );
    console.log('Enums:', enumsResult.rows.length === 0 ? 'None' : enumsResult.rows.map(r => r.typname).join(', '));

    const uuidTest = await client.query('SELECT gen_random_uuid()');
    console.log('UUID generation works:', !!uuidTest.rows[0].gen_random_uuid);

    await client.end();
  } catch (err) {
    console.error('ERROR:', err.message);
    if (client) await client.end();
    process.exit(1);
  }
}

main();
