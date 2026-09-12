require('dotenv').config();
const assert = require('assert');
const { Client } = require('pg');

const layer3Tables = ['store', 'store_offer', 'price_history'];

async function connect() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set in .env');
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 15000
  });
  await client.connect();
  return client;
}

async function preflight(client) {
  const tables = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ANY($1::text[])
    ORDER BY table_name
  `, [layer3Tables]);
  assert.deepStrictEqual(tables.rows.map(row => row.table_name), [...layer3Tables].sort(), 'Layer 3 tables are incomplete');

  const counts = {};
  for (const table of layer3Tables) {
    const result = await client.query(`SELECT count(*)::int AS count FROM ${table}`);
    counts[table] = result.rows[0].count;
  }
  console.log('Layer 3 row counts:', counts);
  assert(Object.values(counts).every(count => count === 0), 'STOP: Layer 3 tables contain rows');

  const requiredColumns = {
    store: ['id', 'name', 'is_active', 'created_at', 'updated_at'],
    store_offer: ['id', 'store_id', 'product_id', 'product_variant_id', 'price', 'currency', 'availability', 'last_checked_at', 'created_at', 'updated_at'],
    price_history: ['id', 'store_offer_id', 'price', 'currency', 'availability', 'observed_at', 'created_at']
  };
  for (const [table, columns] of Object.entries(requiredColumns)) {
    const result = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = ANY($2::text[])
    `, [table, columns]);
    assert.deepStrictEqual(result.rows.map(row => row.column_name).sort(), [...columns].sort(), `${table} columns are incomplete`);
  }

  const fks = await client.query(`
    SELECT tc.table_name, kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public' AND tc.table_name = ANY($1::text[])
    ORDER BY tc.table_name, kcu.column_name
  `, [layer3Tables]);
  const actualFks = fks.rows.map(row => `${row.table_name}.${row.column_name}->${row.foreign_table_name}.${row.foreign_column_name}`).sort();
  const expectedFks = [
    'price_history.store_offer_id->store_offer.id',
    'store_offer.product_id->product.id',
    'store_offer.product_variant_id->product_variant.id',
    'store_offer.store_id->store.id'
  ].sort();
  assert.deepStrictEqual(actualFks, expectedFks, 'Layer 3 foreign keys do not match');
  console.log('Preflight: PASS');
}

async function verifyMetadata(client) {
  const columns = await client.query(`
    SELECT table_name, column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ANY($1::text[])
  `, [layer3Tables]);
  const timestampColumns = new Set([
    'store.created_at', 'store.updated_at',
    'store_offer.last_checked_at', 'store_offer.created_at', 'store_offer.updated_at',
    'price_history.observed_at', 'price_history.created_at'
  ]);
  for (const row of columns.rows) {
    if (timestampColumns.has(`${row.table_name}.${row.column_name}`)) assert.strictEqual(row.data_type, 'timestamp with time zone');
  }
  const notNullColumns = new Set(['store_offer.availability', 'store_offer.last_checked_at', 'price_history.availability']);
  for (const row of columns.rows) {
    if (notNullColumns.has(`${row.table_name}.${row.column_name}`)) assert.strictEqual(row.is_nullable, 'NO');
  }

  const checks = await client.query(`
    SELECT conname, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid IN ('store'::regclass, 'store_offer'::regclass, 'price_history'::regclass)
      AND contype = 'c'
    ORDER BY conname
  `);
  const requiredChecks = [
    'chk_price_history_availability_not_empty', 'chk_price_history_currency_not_empty', 'chk_price_history_price_positive',
    'chk_store_name_not_empty', 'chk_store_offer_availability_not_empty', 'chk_store_offer_currency_not_empty', 'chk_store_offer_price_positive'
  ];
  assert.deepStrictEqual(checks.rows.map(row => row.conname).sort(), requiredChecks.sort(), 'Layer 3 CHECK constraints do not match');
  assert(checks.rows.every(row => !row.definition.includes('>= 0')), 'Non-negative price check remains');

  const indexes = await client.query(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = ANY($1::text[])
      AND indexname NOT LIKE '%_pkey'
    ORDER BY indexname
  `, [layer3Tables]);
  const expectedIndexes = [
    'idx_price_history_observed_at', 'idx_price_history_store_offer_observed', 'idx_store_active',
    'idx_store_offer_last_checked_at', 'idx_store_offer_product_id', 'idx_store_offer_product_variant_id', 'idx_store_offer_store_id'
  ].sort();
  assert.deepStrictEqual(indexes.rows.map(row => row.indexname).sort(), expectedIndexes, 'Layer 3 indexes do not match');
  const observedIndex = indexes.rows.find(row => row.indexname === 'idx_price_history_store_offer_observed');
  assert(observedIndex.indexdef.includes('(store_offer_id, observed_at DESC)'), 'Canonical price history index definition is wrong');

  const uniqueOffer = await client.query(`
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'store_offer'::regclass AND contype = 'u' AND conname = 'uq_store_offer_store_product_variant'
  `);
  assert.strictEqual(uniqueOffer.rowCount, 0, 'Offer-level unique constraint still exists');
  console.log('Metadata verification: PASS');
}

async function rejects(client, name, sql, values) {
  await client.query('SAVEPOINT layer3_test');
  let rejected = false;
  try {
    await client.query(sql, values);
  } catch (error) {
    rejected = true;
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT layer3_test');
    await client.query('RELEASE SAVEPOINT layer3_test');
  }
  assert(rejected, `${name} unexpectedly passed`);
}

async function functionalTests(client) {
  await client.query('BEGIN');
  await client.query("SET LOCAL statement_timeout = '5000ms'");
  try {
    const manufacturer = await client.query("INSERT INTO manufacturer (name) VALUES ('Layer3Test Manufacturer') RETURNING id");
    const family = await client.query("INSERT INTO product_family (name, manufacturer_id) VALUES ('Layer3Test Family', $1) RETURNING id", [manufacturer.rows[0].id]);
    const product = await client.query("INSERT INTO product (product_family_id, manufacturer_id, name) VALUES ($1, $2, 'Layer3Test Product') RETURNING id", [family.rows[0].id, manufacturer.rows[0].id]);
    const variant = await client.query("INSERT INTO product_variant (product_id, sku) VALUES ($1, 'LAYER3-TEST-SKU') RETURNING id", [product.rows[0].id]);
    const store = await client.query("INSERT INTO store (name) VALUES ('Layer3Test Store') RETURNING id");
    const storeId = store.rows[0].id;
    const productId = product.rows[0].id;
    const variantId = variant.rows[0].id;

    await rejects(client, 'Empty store name', "INSERT INTO store (name) VALUES ('   ')");
    const offer = await client.query("INSERT INTO store_offer (store_id, product_id, product_variant_id, price, currency, availability, last_checked_at) VALUES ($1, $2, $3, 100, 'MAD', 'in stock', NOW()) RETURNING id", [storeId, productId, variantId]);
    await client.query("INSERT INTO store_offer (store_id, product_id, price, currency, availability, last_checked_at) VALUES ($1, $2, 101, 'MAD', 'in stock', NOW())", [storeId, productId]);
    await client.query("INSERT INTO store_offer (store_id, product_id, product_variant_id, price, currency, availability, last_checked_at, seller_name) VALUES ($1, $2, $3, 102, 'MAD', 'in stock', NOW(), 'Second seller')", [storeId, productId, variantId]);
    await rejects(client, 'Zero offer price', "INSERT INTO store_offer (store_id, product_id, price, currency, availability, last_checked_at) VALUES ($1, $2, 0, 'MAD', 'in stock', NOW())", [storeId, productId]);
    await rejects(client, 'Negative offer price', "INSERT INTO store_offer (store_id, product_id, price, currency, availability, last_checked_at) VALUES ($1, $2, -1, 'MAD', 'in stock', NOW())", [storeId, productId]);
    await rejects(client, 'NULL offer availability', "INSERT INTO store_offer (store_id, product_id, price, currency, availability, last_checked_at) VALUES ($1, $2, 1, 'MAD', NULL, NOW())", [storeId, productId]);
    await rejects(client, 'Empty offer availability', "INSERT INTO store_offer (store_id, product_id, price, currency, availability, last_checked_at) VALUES ($1, $2, 1, 'MAD', ' ', NOW())", [storeId, productId]);
    await rejects(client, 'Empty offer currency', "INSERT INTO store_offer (store_id, product_id, price, currency, availability, last_checked_at) VALUES ($1, $2, 1, ' ', 'in stock', NOW())", [storeId, productId]);

    await client.query("INSERT INTO price_history (store_offer_id, price, currency, availability, observed_at) VALUES ($1, 100, 'MAD', 'in stock', NOW())", [offer.rows[0].id]);
    await client.query("INSERT INTO price_history (store_offer_id, price, currency, availability, observed_at) VALUES ($1, 99, 'MAD', 'in stock', NOW() + INTERVAL '1 hour')", [offer.rows[0].id]);
    await rejects(client, 'Zero history price', "INSERT INTO price_history (store_offer_id, price, currency, availability, observed_at) VALUES ($1, 0, 'MAD', 'in stock', NOW())", [offer.rows[0].id]);
    await rejects(client, 'Negative history price', "INSERT INTO price_history (store_offer_id, price, currency, availability, observed_at) VALUES ($1, -1, 'MAD', 'in stock', NOW())", [offer.rows[0].id]);
    await rejects(client, 'NULL history availability', "INSERT INTO price_history (store_offer_id, price, currency, availability, observed_at) VALUES ($1, 1, 'MAD', NULL, NOW())", [offer.rows[0].id]);
    await rejects(client, 'Empty history availability', "INSERT INTO price_history (store_offer_id, price, currency, availability, observed_at) VALUES ($1, 1, 'MAD', ' ', NOW())", [offer.rows[0].id]);
    await rejects(client, 'Empty history currency', "INSERT INTO price_history (store_offer_id, price, currency, availability, observed_at) VALUES ($1, 1, ' ', 'in stock', NOW())", [offer.rows[0].id]);
    console.log('Functional tests: PASS');
  } finally {
    await client.query('ROLLBACK');
  }
}

async function main() {
  const client = await connect();
  const verifyRequested = process.argv.includes('--verify');
  const functionalRequested = process.argv.includes('--functional');
  try {
    await preflight(client);
    if (verifyRequested) await verifyMetadata(client);
    if (functionalRequested) await functionalTests(client);
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error('FAIL:', error.message);
  process.exit(1);
});