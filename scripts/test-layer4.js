require('dotenv').config();
const { Client } = require('pg');

// ===========================================================================
// Layer 4 functional/integration test suite (migration 011 canonical schema).
//
// Runs against the already-migrated Neon database. Uses one transaction plus
// SAVEPOINTs: all TestL4% fixtures are removed by explicit reverse-dependency
// cleanup (executed even when assertions fail) and a final ROLLBACK as a
// safety net. No TRUNCATE; no non-test data is touched.
//
// Limitation: a fresh 001 -> 011 migration on an isolated scratch database
// is NOT AVAILABLE (no isolated scratch database exists). This suite only
// exercises the already-migrated Neon environment.
// ===========================================================================

const layer4Tables = [
  'recommendation_profile',
  'recommendation_query',
  'build_candidate',
  'build_component',
  'recommendation_result'
];

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log('PASS: ' + message);
    passed++;
  } else {
    console.log('FAIL: ' + message);
    failed++;
  }
}

// Expected constraint rejection: the statement must fail with a PostgreSQL
// constraint-class error (235xx: CHECK 23514, NOT NULL 23502, FK 23503,
// UNIQUE 23505). Any other error is unexpected and counts as a failure.
async function rejects(client, message, sql, values, expectedConstraint) {
  await client.query('SAVEPOINT testl4_sp');
  try {
    await client.query(sql, values);
    assert(false, message + ' (statement unexpectedly succeeded)');
  } catch (error) {
    if (error && typeof error.code === 'string' && error.code.startsWith('23')) {
      if (expectedConstraint && error.constraint !== expectedConstraint) {
        assert(false, message + ' (WRONG constraint: expected ' + expectedConstraint + ', got ' + error.constraint + ')');
        return;
      }
      assert(true, message + ' [rejected: ' + error.code + (error.constraint ? ' ' + error.constraint : '') + ']');
    } else {
      assert(false, message + ' (UNEXPECTED error: ' + (error ? (error.code || '') + ' ' + error.message : String(error)) + ')');
    }
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT testl4_sp');
    await client.query('RELEASE SAVEPOINT testl4_sp');
  }
}

async function connect() {
  if (!process.env.DATABASE_URL) throw new Error('CONNECTION FAILURE: DATABASE_URL is not set in .env');
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 15000
  });
  await client.connect();
  return client;
}

// ---------------------------------------------------------------------------
// Read-only catalog preflight (schema verification; no data written)
// ---------------------------------------------------------------------------
async function preflight(client) {
  console.log('--- Preflight (catalog verification) ---');

  const tables = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ANY($1::text[])
  `, [layer4Tables]);
  assert(tables.rows.length === 5, 'All five Layer 4 tables exist');

  for (const table of layer4Tables) {
    const result = await client.query('SELECT count(*)::int AS count FROM ' + table);
    console.log('  ' + table + ' rows: ' + result.rows[0].count);
  }

  // Timestamps must be TIMESTAMPTZ.
  const tsCols = await client.query(`
    SELECT table_name, column_name, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ANY($1::text[])
      AND column_name IN ('created_at', 'updated_at', 'price_checked_at')
  `, [layer4Tables]);
  const naive = tsCols.rows.filter(r => r.data_type !== 'timestamp with time zone');
  assert(naive.length === 0, 'All Layer 4 timestamp columns are TIMESTAMPTZ' +
    (naive.length ? ' (non-TZ: ' + naive.map(r => r.table_name + '.' + r.column_name).join(', ') + ')' : ''));

  // Canonical columns present / redundant column gone.
  const cols = await client.query(`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ANY($1::text[])
  `, [layer4Tables]);
  const have = new Set(cols.rows.map(r => r.table_name + '.' + r.column_name));
  const required = [
    'recommendation_profile.id', 'recommendation_profile.name', 'recommendation_profile.priority',
    'recommendation_query.recommendation_profile_id', 'recommendation_query.scoring_model_id',
    'recommendation_query.budget_amount', 'recommendation_query.currency', 'recommendation_query.resolution',
    'build_candidate.recommendation_query_id', 'build_candidate.total_price',
    'build_candidate.compatibility_status', 'build_candidate.score',
    'build_component.build_candidate_id', 'build_component.product_id', 'build_component.product_variant_id',
    'build_component.component_role', 'build_component.selected_price', 'build_component.currency',
    'build_component.store_id', 'build_component.price_checked_at',
    'recommendation_result.recommendation_query_id', 'recommendation_result.build_candidate_id',
    'recommendation_result.rank', 'recommendation_result.explanation'
  ];
  const missing = required.filter(c => !have.has(c));
  assert(missing.length === 0, 'Canonical Layer 4 columns present' +
    (missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''));
  assert(!have.has('build_component.category'), 'build_component.category removed (reconciled)');

  // Nullability requirements.
  const nullability = await client.query(`
    SELECT table_name, column_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ANY($1::text[])
      AND (table_name, column_name) IN (
        ('recommendation_query','scoring_model_id'),
        ('build_candidate','compatibility_status'),
        ('build_component','component_role'),
        ('build_component','selected_price'),
        ('build_component','price_checked_at'),
        ('build_candidate','total_price'),
        ('recommendation_result','rank'),
        ('recommendation_result','build_candidate_id')
      )
  `, [layer4Tables]);
  const nullableMap = new Map(nullability.rows.map(r => [r.table_name + '.' + r.column_name, r]));
  assert(nullableMap.get('recommendation_query.scoring_model_id').is_nullable === 'NO', 'recommendation_query.scoring_model_id is NOT NULL');
  const cs = nullableMap.get('build_candidate.compatibility_status');
  assert(cs.is_nullable === 'NO' && cs.column_default === "'UNKNOWN'::compatibility_status", "build_candidate.compatibility_status NOT NULL DEFAULT 'UNKNOWN'");
  assert(nullableMap.get('build_component.price_checked_at').is_nullable === 'YES', 'build_component.price_checked_at is nullable');
  assert(nullableMap.get('build_candidate.total_price').is_nullable === 'YES', 'build_candidate.total_price is nullable');
  assert(nullableMap.get('recommendation_result.rank').is_nullable === 'YES', 'recommendation_result.rank is nullable');
  assert(nullableMap.get('recommendation_result.build_candidate_id').is_nullable === 'YES', 'recommendation_result.build_candidate_id is nullable');

  // CHECK constraints.
  const checks = await client.query(`
    SELECT conname FROM pg_constraint
    WHERE conrelid = ANY($1::regclass[]) AND contype = 'c'
  `, [layer4Tables.map(t => 'public.' + t)]);
  const checkNames = new Set(checks.rows.map(r => r.conname));
  const requiredChecks = [
    'chk_recommendation_query_budget_positive',
    'chk_build_candidate_total_price_positive',
    'chk_build_candidate_score_range',
    'chk_build_component_selected_price_positive',
    'chk_build_component_store_requires_checked_at',
    'chk_recommendation_result_rank_positive'
  ];
  const missingChecks = requiredChecks.filter(c => !checkNames.has(c));
  assert(missingChecks.length === 0, 'Six canonical CHECK constraints present' +
    (missingChecks.length ? ' (missing: ' + missingChecks.join(', ') + ')' : ''));

  // Unique indexes.
  const indexes = await client.query(`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = ANY($1::text[])
      AND indexname IN ('uq_recommendation_result_query_rank', 'uq_build_component_role_singular', 'idx_recommendation_profile_name')
  `, [layer4Tables]);
  assert(indexes.rows.length === 3, 'Profile-name, result-rank and singular-role unique indexes exist');

  // component_role enum values.
  const enumVals = await client.query(`
    SELECT string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) AS values
    FROM pg_enum e WHERE e.enumtypid = 'public.component_role'::regtype
  `);
  assert(enumVals.rows[0].values === 'CPU, GPU, MOTHERBOARD, RAM, SSD_BOOT, SSD_SECONDARY, PSU, CASE, CPU_COOLER', 'component_role enum has the nine canonical values');

  console.log('--- End preflight ---\n');
}


// ---------------------------------------------------------------------------
// Functional tests (fixture data inside one transaction)
// ---------------------------------------------------------------------------
async function functionalTests(client) {
  console.log('--- Functional tests ---');

  // Layer 1 fixtures (identity only; no spec tables needed for Layer 4 FKs).
  const manufacturer = await client.query(
    "INSERT INTO manufacturer (name) VALUES ('TestL4 Manufacturer') RETURNING id");
  const manufacturerId = manufacturer.rows[0].id;

  const family = await client.query(
    "INSERT INTO product_family (name, manufacturer_id) VALUES ('TestL4 Family', $1) RETURNING id",
    [manufacturerId]);
  const familyId = family.rows[0].id;

  const productNames = ['TestL4 CPU', 'TestL4 GPU', 'TestL4 Motherboard', 'TestL4 RAM',
    'TestL4 PSU', 'TestL4 Case', 'TestL4 CPU Cooler', 'TestL4 SSD Boot', 'TestL4 SSD Secondary'];
  const productIds = {};
  for (const name of productNames) {
    const p = await client.query(
      'INSERT INTO product (product_family_id, manufacturer_id, name) VALUES ($1, $2, $3) RETURNING id',
      [familyId, manufacturerId, name]);
    productIds[name] = p.rows[0].id;
  }

  // GPU product variant for build_component.product_variant_id tests.
  const variant = await client.query(
    "INSERT INTO product_variant (product_id, sku) VALUES ($1, 'TestL4-GPU-V1') RETURNING id",
    [productIds['TestL4 GPU']]);
  const gpuVariantId = variant.rows[0].id;

  // Layer 2 fixture: one scoring model used by every recommendation query.
  const model = await client.query(
    "INSERT INTO scoring_model (name, version) VALUES ('TestL4 Scoring Model', '1.0') RETURNING id");
  const scoringModelId = model.rows[0].id;

  // Layer 3 fixture: one store (store_offer / price_history not required:
  // no Layer 4 FK references them).
  const store = await client.query(
    "INSERT INTO store (name) VALUES ('TestL4 Store') RETURNING id");
  const storeId = store.rows[0].id;

  // =========================================================================
  // 1. Profile tests
  // =========================================================================
  console.log('\n-- Profiles --');
  const prof1 = await client.query(
    "INSERT INTO recommendation_profile (name, description, use_case, priority, default_resolution) " +
    "VALUES ('TestL4 Profile A', 'Test profile', 'GAMING', 2, '1440p') RETURNING id, created_at, updated_at");
  const profileId = prof1.rows[0].id;
  assert(prof1.rows[0].created_at instanceof Date && prof1.rows[0].updated_at instanceof Date,
    'recommendation_profile created_at/updated_at defaulted');

  await rejects(client, 'duplicate profile name rejected',
    "INSERT INTO recommendation_profile (name) VALUES ('TestL4 Profile A')");
  const prof2 = await client.query(
    "INSERT INTO recommendation_profile (name) VALUES ('TestL4 Profile B') RETURNING id");
  assert(!!prof2.rows[0].id, 'different profile name accepted');

  // =========================================================================
  // 2. Recommendation query tests
  // =========================================================================
  console.log('\n-- Recommendation queries --');
  const q1 = await client.query(
    'INSERT INTO recommendation_query (recommendation_profile_id, scoring_model_id, budget_amount, currency, use_case, priority, resolution) ' +
    "VALUES ($1, $2, 8000, 'MAD', 'GAMING', 2, '1440p') RETURNING id, created_at", [profileId, scoringModelId]);
  const queryId = q1.rows[0].id;
  assert(q1.rows[0].created_at instanceof Date, 'recommendation_query created_at defaulted');

  const q2 = await client.query(
    'INSERT INTO recommendation_query (scoring_model_id, budget_amount, currency) ' +
    "VALUES ($1, 5000, 'MAD') RETURNING id", [scoringModelId]);
  const query2Id = q2.rows[0].id;
  assert(!!query2Id, 'nullable profile accepted (query without profile)');

  await rejects(client, 'budget = 0 rejected',
    'INSERT INTO recommendation_query (scoring_model_id, budget_amount, currency) VALUES ($1, 0, $2)', [scoringModelId, 'MAD']);
  await rejects(client, 'negative budget rejected',
    'INSERT INTO recommendation_query (scoring_model_id, budget_amount, currency) VALUES ($1, -100, $2)', [scoringModelId, 'MAD']);
  await rejects(client, 'missing scoring_model_id rejected (NOT NULL)',
    "INSERT INTO recommendation_query (budget_amount, currency) VALUES (5000, 'MAD')");
  await rejects(client, 'query -> nonexistent profile rejected',
    'INSERT INTO recommendation_query (recommendation_profile_id, scoring_model_id, budget_amount, currency) ' +
    "VALUES (gen_random_uuid(), $1, 5000, 'MAD')", [scoringModelId]);
  await rejects(client, 'query -> nonexistent scoring model rejected',
    "INSERT INTO recommendation_query (scoring_model_id, budget_amount, currency) VALUES (gen_random_uuid(), 5000, 'MAD')");

  // =========================================================================
  // 3. Candidate tests
  // =========================================================================
  console.log('\n-- Build candidates --');
  const c1 = await client.query(
    'INSERT INTO build_candidate (recommendation_query_id, total_price, score) ' +
    'VALUES ($1, 7500, 50) RETURNING id, compatibility_status, created_at', [queryId]);
  const candidateId = c1.rows[0].id;
  assert(c1.rows[0].compatibility_status === 'UNKNOWN',
    "candidate compatibility_status defaults to UNKNOWN when omitted");
  assert(c1.rows[0].created_at instanceof Date, 'build_candidate created_at defaulted');

  const c2 = await client.query(
    'INSERT INTO build_candidate (recommendation_query_id, total_price, score) VALUES ($1, 7200, 0) RETURNING id',
    [queryId]);
  const candidateZeroId = c2.rows[0].id;
  assert(!!candidateZeroId, 'candidate score 0 accepted');

  const c3 = await client.query(
    'INSERT INTO build_candidate (recommendation_query_id, total_price, score) VALUES ($1, 7600, 100) RETURNING id',
    [queryId]);
  const candidateMaxId = c3.rows[0].id;
  assert(!!candidateMaxId, 'candidate score 100 accepted');
  assert(c1.rows[0] && c2.rows[0] && c3.rows[0] && candidateId !== candidateZeroId && candidateZeroId !== candidateMaxId,
    'multiple candidates allowed for one query (different scores: 50 / 0 / 100)');

  await rejects(client, 'candidate score 101 rejected',
    'INSERT INTO build_candidate (recommendation_query_id, score) VALUES ($1, 101)', [queryId]);
  await rejects(client, 'candidate total_price = 0 rejected',
    'INSERT INTO build_candidate (recommendation_query_id, total_price) VALUES ($1, 0)', [queryId]);
  await rejects(client, 'candidate negative total_price rejected',
    'INSERT INTO build_candidate (recommendation_query_id, total_price) VALUES ($1, -1)', [queryId]);
  const cNull = await client.query(
    'INSERT INTO build_candidate (recommendation_query_id) VALUES ($1) RETURNING id, total_price', [queryId]);
  assert(cNull.rows[0].total_price === null, 'candidate total_price NULL accepted (nullable)');
  const cExplicit = await client.query(
    "INSERT INTO build_candidate (recommendation_query_id, compatibility_status) VALUES ($1, 'PASS') RETURNING id, compatibility_status",
    [queryId]);
  assert(cExplicit.rows[0].compatibility_status === 'PASS', 'explicit compatibility_status PASS accepted');
  await rejects(client, 'candidate -> nonexistent query rejected',
    'INSERT INTO build_candidate (recommendation_query_id) VALUES (gen_random_uuid())');

  // =========================================================================
  // 4. Component / build tests
  // =========================================================================
  console.log('\n-- Build components --');
  async function insertComponent(candidate, role, productId, price, extra) {
    const params = [candidate, productId, role, price, 'MAD'];
    let sql = 'INSERT INTO build_component (build_candidate_id, product_id, component_role, selected_price, currency' +
      (extra && extra.variant ? ', product_variant_id' : '') +
      (extra && extra.store ? ', store_id, price_checked_at' : '') +
      ') VALUES ($1, $2, $3, $4, $5' +
      (extra && extra.variant ? ', $6' : '') +
      (extra && extra.store ? ', $7, $8' : '') + ') RETURNING id, created_at, updated_at';
    if (extra && extra.variant) params.push(extra.variant);
    if (extra && extra.store) { params.push(extra.store, extra.checkedAt || new Date()); }
    return client.query(sql, params);
  }

  // Full valid build on candidate A.
  const roles = [
    ['CPU', 'TestL4 CPU', null],
    ['MOTHERBOARD', 'TestL4 Motherboard', null],
    ['PSU', 'TestL4 PSU', null],
    ['CASE', 'TestL4 Case', null],
    ['CPU_COOLER', 'TestL4 CPU Cooler', null],
    ['SSD_BOOT', 'TestL4 SSD Boot', null],
    ['GPU', 'TestL4 GPU', gpuVariantId],
    ['RAM', 'TestL4 RAM', null],
    ['RAM', 'TestL4 RAM', null],
    ['SSD_SECONDARY', 'TestL4 SSD Secondary', null]
  ];
  let firstComponentMeta = null;
  for (const [role, productName, variantId] of roles) {
    const r = await insertComponent(candidateId, role, productIds[productName], 100, variantId ? { variant: variantId } : null);
    if (!firstComponentMeta) firstComponentMeta = r.rows[0];
  }
  assert(firstComponentMeta.created_at instanceof Date && firstComponentMeta.updated_at instanceof Date,
    'build_component created_at/updated_at defaulted');
  assert(true, 'full valid build (CPU, motherboard, PSU, case, cooler, boot SSD, GPU+variant, 2x RAM, secondary SSD) accepted');

  // Singular roles: second component must be rejected.
  for (const [role, productName] of [
    ['CPU', 'TestL4 CPU'],
    ['MOTHERBOARD', 'TestL4 Motherboard'],
    ['PSU', 'TestL4 PSU'],
    ['CASE', 'TestL4 Case'],
    ['CPU_COOLER', 'TestL4 CPU Cooler'],
    ['SSD_BOOT', 'TestL4 SSD Boot']
  ]) {
    await rejects(client, 'second ' + role + ' rejected',
      'INSERT INTO build_component (build_candidate_id, product_id, component_role, selected_price, currency) ' +
      'VALUES ($1, $2, $3, 100, $4)', [candidateId, productIds[productName], role, 'MAD']);
  }

  // Multiple roles remain allowed.
  await insertComponent(candidateId, 'GPU', productIds['TestL4 GPU'], 100);
  await insertComponent(candidateId, 'RAM', productIds['TestL4 RAM'], 100);
  await insertComponent(candidateId, 'SSD_SECONDARY', productIds['TestL4 SSD Secondary'], 100);
  assert(true, 'multiple GPU / RAM / SSD_SECONDARY components allowed');

  // Product / variant relationships.
  const plainComp = await insertComponent(candidateId, 'RAM', productIds['TestL4 PSU'], 100);
  assert(!!plainComp.rows[0].id, 'normal component with product_id accepted');
  const variantComp = await client.query(
    'INSERT INTO build_component (build_candidate_id, product_id, product_variant_id, component_role, selected_price, currency) ' +
    'VALUES ($1, $2, $3, $4, 100, $5) RETURNING id',
    [candidateId, productIds['TestL4 GPU'], gpuVariantId, 'GPU', 'MAD']);
  assert(!!variantComp.rows[0].id, 'GPU component with product_id AND product_variant_id accepted');
  const nullVariantComp = await client.query(
    'INSERT INTO build_component (build_candidate_id, product_id, product_variant_id, component_role, selected_price, currency) ' +
    'VALUES ($1, $2, NULL, $3, 100, $4) RETURNING id, product_variant_id',
    [candidateId, productIds['TestL4 RAM'], 'RAM', 'MAD']);
  assert(nullVariantComp.rows[0].product_variant_id === null, 'component with product_variant_id = NULL accepted');

  await rejects(client, 'component -> nonexistent product rejected',
    'INSERT INTO build_component (build_candidate_id, product_id, component_role, selected_price, currency) ' +
    'VALUES ($1, gen_random_uuid(), $2, 100, $3)', [candidateId, 'RAM', 'MAD']);
  await rejects(client, 'component -> nonexistent product variant rejected',
    'INSERT INTO build_component (build_candidate_id, product_id, product_variant_id, component_role, selected_price, currency) ' +
    'VALUES ($1, $2, gen_random_uuid(), $3, 100, $4)', [candidateId, productIds['TestL4 GPU'], 'GPU', 'MAD']);
  await rejects(client, 'component -> nonexistent candidate rejected',
    'INSERT INTO build_component (build_candidate_id, product_id, component_role, selected_price, currency) ' +
    "VALUES (gen_random_uuid(), $1, 'RAM', 100, 'MAD')", [productIds['TestL4 RAM']]);

  // =========================================================================
  // 5. Price tests
  // =========================================================================
  console.log('\n-- Prices --');
  await rejects(client, 'selected_price = 0 rejected',
    'INSERT INTO build_component (build_candidate_id, product_id, component_role, selected_price, currency) ' +
    'VALUES ($1, $2, $3, 0, $4)', [candidateId, productIds['TestL4 RAM'], 'RAM', 'MAD']);
  await rejects(client, 'negative selected_price rejected',
    'INSERT INTO build_component (build_candidate_id, product_id, component_role, selected_price, currency) ' +
    'VALUES ($1, $2, $3, -1, $4)', [candidateId, productIds['TestL4 RAM'], 'RAM', 'MAD']);
  const pricedComp = await insertComponent(candidateId, 'SSD_SECONDARY', productIds['TestL4 SSD Secondary'], 500);
  assert(!!pricedComp.rows[0].id, 'positive selected_price accepted');

  // =========================================================================
  // 6. Store / price-snapshot tests
  // =========================================================================
  console.log('\n-- Store / timestamp snapshot --');
  const noSnapshot = await client.query(
    'INSERT INTO build_component (build_candidate_id, product_id, component_role, selected_price, currency, store_id, price_checked_at) ' +
    'VALUES ($1, $2, $3, 100, $4, NULL, NULL) RETURNING id',
    [candidateId, productIds['TestL4 RAM'], 'RAM', 'MAD']);
  assert(!!noSnapshot.rows[0].id, 'store_id NULL + price_checked_at NULL accepted');

  const checkedAtInput = '2026-09-12T10:00:00+01:00';
  const withSnapshot = await client.query(
    'INSERT INTO build_component (build_candidate_id, product_id, component_role, selected_price, currency, store_id, price_checked_at) ' +
    'VALUES ($1, $2, $3, 100, $4, $5, $6) RETURNING id, price_checked_at',
    [candidateId, productIds['TestL4 RAM'], 'RAM', 'MAD', storeId, checkedAtInput]);
  const storedTs = withSnapshot.rows[0].price_checked_at;
  assert(storedTs instanceof Date && storedTs.toISOString() === '2026-09-12T09:00:00.000Z',
    'price_checked_at behaves as TIMESTAMPTZ (offset-normalized instant preserved)');

  await rejects(client, 'store_id set + price_checked_at NULL rejected (CHECK)',
    'INSERT INTO build_component (build_candidate_id, product_id, component_role, selected_price, currency, store_id, price_checked_at) ' +
    'VALUES ($1, $2, $3, 100, $4, $5, NULL)',
    [candidateId, productIds['TestL4 RAM'], 'RAM', 'MAD', storeId]);
  await rejects(client, 'component -> nonexistent store rejected',
    'INSERT INTO build_component (build_candidate_id, product_id, component_role, selected_price, currency, store_id, price_checked_at) ' +
    'VALUES ($1, $2, $3, 100, $4, gen_random_uuid(), NOW())',
    [candidateId, productIds['TestL4 RAM'], 'RAM', 'MAD']);

  // =========================================================================
  // 7. Recommendation result tests
  // =========================================================================
  console.log('\n-- Recommendation results --');
  for (const rank of [1, 2, 3]) {
    const cand = [candidateId, candidateZeroId, candidateMaxId][rank - 1];
    const r = await client.query(
      'INSERT INTO recommendation_result (recommendation_query_id, build_candidate_id, "rank", explanation) ' +
      "VALUES ($1, $2, $3, 'Test explanation') RETURNING id, created_at", [queryId, cand, rank]);
    assert(!!r.rows[0].id && r.rows[0].created_at instanceof Date,
      'result rank ' + rank + ' accepted (created_at defaulted)');
  }

  await rejects(client, 'rank 0 rejected',
    'INSERT INTO recommendation_result (recommendation_query_id, build_candidate_id, "rank") VALUES ($1, $2, 0)',
    [queryId, candidateId]);
  await rejects(client, 'negative rank rejected',
    'INSERT INTO recommendation_result (recommendation_query_id, build_candidate_id, "rank") VALUES ($1, $2, -1)',
    [queryId, candidateId]);
  await rejects(client, 'duplicate rank within same query rejected',
    'INSERT INTO recommendation_result (recommendation_query_id, build_candidate_id, "rank") VALUES ($1, $2, 1)',
    [queryId, candidateZeroId]);
  const otherRank1 = await client.query(
    'INSERT INTO recommendation_result (recommendation_query_id, build_candidate_id, "rank") VALUES ($1, $2, 1) RETURNING id',
    [query2Id, candidateId]);
  assert(!!otherRank1.rows[0].id, 'same rank 1 allowed in a DIFFERENT recommendation query');

  await rejects(client, 'result -> nonexistent query rejected',
    'INSERT INTO recommendation_result (recommendation_query_id, build_candidate_id, "rank") VALUES (gen_random_uuid(), $1, 1)',
    [candidateId]);
  const resultNullCandidate = await client.query(
    'INSERT INTO recommendation_result (recommendation_query_id, "rank") VALUES ($1, NULL) RETURNING id, build_candidate_id',
    [queryId]);
  assert(resultNullCandidate.rows[0].build_candidate_id === null, 'NULL-rank / NULL-candidate result accepted (nullable)');
  await rejects(client, 'result -> nonexistent candidate rejected',
    'INSERT INTO recommendation_result (recommendation_query_id, build_candidate_id, "rank") VALUES ($1, gen_random_uuid(), 4)',
    [queryId], 'recommendation_result_build_candidate_id_fkey');
  console.log('\n-- End functional tests --');
}

// ---------------------------------------------------------------------------
// Cleanup in reverse dependency order. Runs even when assertions failed.
// Only TestL4-prefixed fixture rows are removed; no TRUNCATE anywhere.
// ---------------------------------------------------------------------------
async function cleanup(client) {
  console.log('\n--- Cleanup (reverse dependency order) ---');
  const steps = [
    "DELETE FROM recommendation_result WHERE recommendation_query_id IN (SELECT id FROM recommendation_query WHERE scoring_model_id IN (SELECT id FROM scoring_model WHERE name LIKE 'TestL4%'))",
    "DELETE FROM build_component WHERE build_candidate_id IN (SELECT id FROM build_candidate WHERE recommendation_query_id IN (SELECT id FROM recommendation_query WHERE scoring_model_id IN (SELECT id FROM scoring_model WHERE name LIKE 'TestL4%')))",
    "DELETE FROM build_candidate WHERE recommendation_query_id IN (SELECT id FROM recommendation_query WHERE scoring_model_id IN (SELECT id FROM scoring_model WHERE name LIKE 'TestL4%'))",
    "DELETE FROM recommendation_query WHERE scoring_model_id IN (SELECT id FROM scoring_model WHERE name LIKE 'TestL4%')",
    "DELETE FROM recommendation_profile WHERE name LIKE 'TestL4%'",
    "DELETE FROM store WHERE name LIKE 'TestL4%'",
    "DELETE FROM scoring_model WHERE name LIKE 'TestL4%'",
    "DELETE FROM product_variant WHERE sku LIKE 'TestL4%' OR product_id IN (SELECT id FROM product WHERE name LIKE 'TestL4%')",
    "DELETE FROM product WHERE name LIKE 'TestL4%'",
    "DELETE FROM product_family WHERE name LIKE 'TestL4%'",
    "DELETE FROM manufacturer WHERE name LIKE 'TestL4%'"
  ];
  for (const sql of steps) {
    const result = await client.query(sql);
    console.log('  deleted ' + result.rowCount + ' row(s)');
  }
  console.log('Cleanup: done');
}

async function main() {
  let client;
  try {
    client = await connect();
  } catch (error) {
    console.error('CONNECTION FAILURE: ' + error.message);
    process.exit(1);
  }

  try {
    await preflight(client);

    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '60000ms'");
    let functionalError = null;
    try {
      await functionalTests(client);
    } catch (ftError) {
      functionalError = ftError;
      console.error('FUNCTIONAL TESTS UNEXPECTED ERROR: ' + (ftError.stack || ftError.message));
    } finally {
      // Explicit cleanup inside the transaction, in dependency order,
      // executed even if a test threw.
      try {
        await cleanup(client);
      } catch (cleanupError) {
        console.error('IN-TRANSACTION CLEANUP ERROR (rolling back): ' + cleanupError.message);
      }
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('ROLLBACK ERROR: ' + rollbackError.message);
      }
      if (functionalError) {
        try { await cleanupAfterError(client); } catch (e) {
          console.error('POST-ERROR CLEANUP FAILED: ' + e.message);
        }
        failed++;
        console.log('Layer 4 tests: ' + passed + ' passed, ' + failed + ' failed (aborted by unexpected error)');
        process.exitCode = 1;
        return;
      }
    }

    // Verify no TestL4 fixtures survived.
    const leftovers = await client.query(`
      SELECT
        (SELECT count(*) FROM recommendation_profile WHERE name LIKE 'TestL4%') +
        (SELECT count(*) FROM scoring_model WHERE name LIKE 'TestL4%') +
        (SELECT count(*) FROM store WHERE name LIKE 'TestL4%') +
        (SELECT count(*) FROM manufacturer WHERE name LIKE 'TestL4%') AS total
    `);
    assert(leftovers.rows[0].total === '0' || leftovers.rows[0].total === 0, 'No TestL4 fixtures remain after cleanup');

    console.log('\n--- Summary ---');
    console.log('Layer 4 tests: ' + passed + ' passed, ' + failed + ' failed');
    console.log('Fresh 001 -> 011 migration on isolated scratch DB: NOT AVAILABLE (no scratch database exists; only the already-migrated Neon environment was tested)');
    process.exitCode = failed > 0 ? 1 : 0;
  } catch (error) {
    // Unexpected error (assertion throw or SQL failure outside expected paths).
    console.error('UNEXPECTED ERROR: ' + (error.stack || error.message));
    try {
      await client.query('ROLLBACK');
      await cleanupAfterError(client);
    } catch (cleanupError) {
      console.error('CLEANUP ERROR: ' + cleanupError.message);
    }
    failed++;
    console.log('Layer 4 tests: ' + passed + ' passed, ' + failed + ' failed (aborted by unexpected error)');
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

// Best-effort cleanup after an unexpected error aborted the transaction.
async function cleanupAfterError(client) {
  console.log('\n--- Post-error cleanup (reverse dependency order) ---');
  const steps = [
    "DELETE FROM recommendation_result WHERE recommendation_query_id IN (SELECT id FROM recommendation_query WHERE scoring_model_id IN (SELECT id FROM scoring_model WHERE name LIKE 'TestL4%'))",
    "DELETE FROM build_component WHERE build_candidate_id IN (SELECT id FROM build_candidate WHERE recommendation_query_id IN (SELECT id FROM recommendation_query WHERE scoring_model_id IN (SELECT id FROM scoring_model WHERE name LIKE 'TestL4%')))",
    "DELETE FROM build_candidate WHERE recommendation_query_id IN (SELECT id FROM recommendation_query WHERE scoring_model_id IN (SELECT id FROM scoring_model WHERE name LIKE 'TestL4%'))",
    "DELETE FROM recommendation_query WHERE scoring_model_id IN (SELECT id FROM scoring_model WHERE name LIKE 'TestL4%')",
    "DELETE FROM recommendation_profile WHERE name LIKE 'TestL4%'",
    "DELETE FROM store WHERE name LIKE 'TestL4%'",
    "DELETE FROM scoring_model WHERE name LIKE 'TestL4%'",
    "DELETE FROM product_variant WHERE sku LIKE 'TestL4%' OR product_id IN (SELECT id FROM product WHERE name LIKE 'TestL4%')",
    "DELETE FROM product WHERE name LIKE 'TestL4%'",
    "DELETE FROM product_family WHERE name LIKE 'TestL4%'",
    "DELETE FROM manufacturer WHERE name LIKE 'TestL4%'"
  ];
  for (const sql of steps) {
    const result = await client.query(sql);
    console.log('  deleted ' + result.rowCount + ' row(s)');
  }
}

main();
