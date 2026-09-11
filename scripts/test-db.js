require('dotenv').config();
const { Client } = require('pg');

async function testConnection() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    console.error('ERROR: DATABASE_URL is not set in .env');
    process.exit(1);
  }

  const client = new Client({ connectionString });

  try {
    await client.connect();
    console.log('SUCCESS: Connected to PostgreSQL database');

    const versionResult = await client.query('SELECT version()');
    console.log('PostgreSQL version:', versionResult.rows[0].version);

    const dbResult = await client.query("SELECT current_database()");
    console.log('Current database:', dbResult.rows[0].current_database);

    const tablesResult = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
    );
    console.log('Public tables:', tablesResult.rows.length === 0 ? 'None (database is empty)' : tablesResult.rows.map(r => r.table_name).join(', '));

    await client.end();
  } catch (err) {
    console.error('ERROR: Connection failed:', err.message);
    process.exit(1);
  }
}

testConnection();
