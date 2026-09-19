require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// run-seeds.js — applies database/seeds/*.sql in sorted filename order.
// SEPARATE from scripts/run-migrations.js (schema/DDL only). Seed files are
// DML-only, idempotent (INSERT ... WHERE NOT EXISTS on natural keys), and
// wrapped in transactions, so re-running is safe on the shared Neon DB.
// Usage: node scripts/run-seeds.js [--dry-run]
//   --dry-run: parse + report statements without executing.

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString && !dryRun) {
    console.error('ERROR: DATABASE_URL is not set in .env');
    process.exit(1);
  }

  const seedsDir = path.join(process.cwd(), 'database', 'seeds');
  let files;
  try {
    files = fs.readdirSync(seedsDir).filter((f) => f.endsWith('.sql')).sort();
  } catch (err) {
    console.error(`ERROR: cannot read seeds dir (${seedsDir}): ${err.message}`);
    process.exit(1);
  }
  if (files.length === 0) {
    console.log('No seed files found.');
    return;
  }

  if (dryRun) {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(seedsDir, file), 'utf8');
      const statements = sql.split(';').filter((s) => s.trim().length > 0);
      console.log(`DRY-RUN ${file}: ${statements.length} statements, ${sql.length} chars`);
    }
    return;
  }

  const client = new Client({ connectionString });
  try {
    await client.connect();
    console.log('Connected to PostgreSQL database');
    for (const file of files) {
      const sql = fs.readFileSync(path.join(seedsDir, file), 'utf8');
      await client.query(sql);
      console.log(`SEEDED: ${file}`);
    }

    const seedProducts = await client.query(
      "SELECT count(*)::int AS n FROM product WHERE name LIKE 'Seed %'"
    );
    const seedOffers = await client.query(
      `SELECT count(*)::int AS n FROM store_offer o
        JOIN product p ON p.id = o.product_id WHERE p.name LIKE 'Seed %'`
    );
    const seedAssessments = await client.query(
      `SELECT count(*)::int AS n FROM component_assessment a
        JOIN product p ON p.id = a.product_id WHERE p.name LIKE 'Seed %'`
    );
    console.log(
      `Seed rows: products=${seedProducts.rows[0].n}, ` +
      `offers=${seedOffers.rows[0].n}, assessments=${seedAssessments.rows[0].n}`
    );
    await client.end();
  } catch (err) {
    console.error('ERROR:', err.message);
    if (client) await client.end();
    process.exit(1);
  }
}

main();
