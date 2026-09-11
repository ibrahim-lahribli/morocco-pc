require('dotenv').config();
const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL });

(async () => {
  await client.connect();

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log('  PASS: ' + message);
      passed++;
    } else {
      console.log('  FAIL: ' + message);
      failed++;
    }
  }

  async function assertRejects(fn, message) {
    try {
      await fn();
      assert(false, message);
    } catch (e) {
      assert(true, message);
    }
  }

  try {
    // ------------------------------------------------------------------
    // Clean up any previous test data
    // ------------------------------------------------------------------
    await client.query(`DELETE FROM cpu_motherboard_support WHERE motherboard_product_id IN (SELECT id FROM product WHERE name LIKE 'TestCompat%')`);
    await client.query(`DELETE FROM cooler_socket_support WHERE cooler_product_id IN (SELECT id FROM product WHERE name LIKE 'TestCompat%')`);
    await client.query(`DELETE FROM case_motherboard_form_factor WHERE case_product_id IN (SELECT id FROM product WHERE name LIKE 'TestCompat%')`);
    await client.query(`DELETE FROM case_radiator_support WHERE case_product_id IN (SELECT id FROM product WHERE name LIKE 'TestCompat%')`);
    await client.query(`DELETE FROM spec_provenance WHERE target_table IN ('cpu_motherboard_support', 'cooler_socket_support', 'case_motherboard_form_factor', 'case_radiator_support')`);
    await client.query(`DELETE FROM product_candidate WHERE source_identifier LIKE 'TestCompat%'`);
    await client.query(`DELETE FROM ingestion_record WHERE source_identifier LIKE 'TestCompat%'`);
    await client.query(`DELETE FROM retailer_listing_alias WHERE listing_identifier LIKE 'TestCompat%'`);
    await client.query(`DELETE FROM product WHERE name LIKE 'TestCompat%'`);
    await client.query(`DELETE FROM product_family WHERE name IN ('TestCPUFamily', 'TestMBBFamily', 'TestCaseFamily', 'TestCoolerFamily')`);
    await client.query(`DELETE FROM chipset WHERE name = 'TestChipsetCompat'`);
    await client.query(`DELETE FROM socket WHERE name = 'TestSocketCompat'`);
    await client.query(`DELETE FROM manufacturer WHERE name = 'TestManufacturerCompat'`);

    // ------------------------------------------------------------------
    // Seed reference data
    // ------------------------------------------------------------------
    const manufacturer = await client.query(
      `INSERT INTO manufacturer (name) VALUES ($1) RETURNING id`,
      ['TestManufacturerCompat']
    );
    const manufacturerId = manufacturer.rows[0].id;

    const socket = await client.query(
      `INSERT INTO socket (name) VALUES ($1) RETURNING id`,
      ['TestSocketCompat']
    );
    const socketId = socket.rows[0].id;

    const chipset = await client.query(
      `INSERT INTO chipset (manufacturer_id, name) VALUES ($1, $2) RETURNING id`,
      [manufacturerId, 'TestChipsetCompat']
    );
    const chipsetId = chipset.rows[0].id;

    const memoryType = await client.query(
      `INSERT INTO memory_type (name) VALUES ($1) RETURNING id`,
      ['TestDDR5Compat']
    );
    const memoryTypeId = memoryType.rows[0].id;

    // Product family for CPUs
    const cpuFamily = await client.query(
      `INSERT INTO product_family (name, manufacturer_id) VALUES ($1, $2) RETURNING id`,
      ['TestCPUFamily', manufacturerId]
    );
    const cpuFamilyId = cpuFamily.rows[0].id;

    // Product family for motherboards
    const mbFamily = await client.query(
      `INSERT INTO product_family (name, manufacturer_id) VALUES ($1, $2) RETURNING id`,
      ['TestMBBFamily', manufacturerId]
    );
    const mbFamilyId = mbFamily.rows[0].id;

    // Product family for cases
    const caseFamily = await client.query(
      `INSERT INTO product_family (name, manufacturer_id) VALUES ($1, $2) RETURNING id`,
      ['TestCaseFamily', manufacturerId]
    );
    const caseFamilyId = caseFamily.rows[0].id;

    // Product family for coolers
    const coolerFamily = await client.query(
      `INSERT INTO product_family (name, manufacturer_id) VALUES ($1, $2) RETURNING id`,
      ['TestCoolerFamily', manufacturerId]
    );
    const coolerFamilyId = coolerFamily.rows[0].id;

    // Motherboard product
    const mbProduct = await client.query(
      `INSERT INTO product (product_family_id, manufacturer_id, name) VALUES ($1, $2, $3) RETURNING id`,
      [mbFamilyId, manufacturerId, 'TestCompatMotherboard']
    );
    const mbProductId = mbProduct.rows[0].id;

    // Add motherboard_spec so the product is a valid motherboard
    await client.query(
      `INSERT INTO motherboard_spec (product_id, socket_id, chipset_id, memory_type_id) VALUES ($1, $2, $3, $4)`,
      [mbProductId, socketId, chipsetId, memoryTypeId]
    );

    // CPU product (exact CPU)
    const cpuProduct = await client.query(
      `INSERT INTO product (product_family_id, manufacturer_id, name) VALUES ($1, $2, $3) RETURNING id`,
      [cpuFamilyId, manufacturerId, 'TestCompatCPU']
    );
    const cpuProductId = cpuProduct.rows[0].id;

    // Add cpu_spec so the product is a valid CPU
    await client.query(
      `INSERT INTO cpu_spec (product_id, socket_id, cores, threads, base_clock_mhz, boost_clock_mhz, tdp_watts) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [cpuProductId, socketId, 8, 16, 3600, 5200, 65]
    );

    // Cooler product
    const coolerProduct = await client.query(
      `INSERT INTO product (product_family_id, manufacturer_id, name) VALUES ($1, $2, $3) RETURNING id`,
      [coolerFamilyId, manufacturerId, 'TestCompatCooler']
    );
    const coolerProductId = coolerProduct.rows[0].id;

    await client.query(
      `INSERT INTO cooler_spec (product_id, cooling_type, max_tdp_watts, height_mm, length_mm, width_mm) VALUES ($1, $2, $3, $4, $5, $6)`,
      [coolerProductId, 'AIR', 150, 160, 120, 120]
    );

    // Case product
    const caseProduct = await client.query(
      `INSERT INTO product (product_family_id, manufacturer_id, name) VALUES ($1, $2, $3) RETURNING id`,
      [caseFamilyId, manufacturerId, 'TestCompatCase']
    );
    const caseProductId = caseProduct.rows[0].id;

    await client.query(
      `INSERT INTO case_spec (product_id, max_gpu_length_mm, max_gpu_thickness_slots, max_cpu_cooler_height_mm, max_psu_length_mm) VALUES ($1, $2, $3, $4, $5)`,
      [caseProductId, 350, 3, 160, 200]
    );

    assert(mbProductId, 'motherboard product seeded');
    assert(cpuFamilyId, 'CPU product family seeded');
    assert(cpuProductId, 'CPU product seeded');
    assert(coolerProductId, 'cooler product seeded');
    assert(caseProductId, 'case product seeded');
    assert(socketId, 'socket seeded');

    // ------------------------------------------------------------------
    // TEST 1: Family-level CPU compatibility
    // (cpu_product_family_id set, cpu_product_id NULL)
    // ------------------------------------------------------------------
    console.log('\n--- Test 1: Family-level CPU compatibility ---');
    const familyResult = await client.query(
      `INSERT INTO cpu_motherboard_support
         (motherboard_product_id, cpu_product_family_id, cpu_product_id, support_status, min_bios_version, source_note)
       VALUES ($1, $2, NULL, 'PASS', '1.2.0', 'Official ASUS compatibility list')
       RETURNING id, motherboard_product_id, cpu_product_family_id, cpu_product_id, support_status, min_bios_version`,
      [mbProductId, cpuFamilyId]
    );
    assert(familyResult.rows.length === 1, 'Family-level CPU compatibility rule inserted');
    assert(familyResult.rows[0].cpu_product_family_id === cpuFamilyId, 'cpu_product_family_id correctly stored');
    assert(familyResult.rows[0].cpu_product_id === null, 'cpu_product_id is NULL for family-level rule');
    assert(familyResult.rows[0].support_status === 'PASS', 'support_status is PASS');
    assert(familyResult.rows[0].min_bios_version === '1.2.0', 'min_bios_version stored');

    // ------------------------------------------------------------------
    // TEST 2: Exact-CPU compatibility
    // (cpu_product_id set, cpu_product_family_id NULL)
    // ------------------------------------------------------------------
    console.log('\n--- Test 2: Exact-CPU compatibility ---');
    const exactResult = await client.query(
      `INSERT INTO cpu_motherboard_support
         (motherboard_product_id, cpu_product_family_id, cpu_product_id, support_status)
       VALUES ($1, NULL, $2, 'PASS')
       RETURNING id, motherboard_product_id, cpu_product_family_id, cpu_product_id, support_status`,
      [mbProductId, cpuProductId]
    );
    assert(exactResult.rows.length === 1, 'Exact-CPU compatibility rule inserted');
    assert(exactResult.rows[0].cpu_product_id === cpuProductId, 'cpu_product_id correctly stored');
    assert(exactResult.rows[0].cpu_product_family_id === null, 'cpu_product_family_id is NULL for exact-CPU rule');
    assert(exactResult.rows[0].support_status === 'PASS', 'support_status is PASS');

    // ------------------------------------------------------------------
    // TEST 3: Duplicate family-level rule rejected
    // ------------------------------------------------------------------
    console.log('\n--- Test 3: Duplicate support rules rejected ---');
    await assertRejects(async () => {
      await client.query(
        `INSERT INTO cpu_motherboard_support
           (motherboard_product_id, cpu_product_family_id, cpu_product_id, support_status)
         VALUES ($1, $2, NULL, 'PASS')`,
        [mbProductId, cpuFamilyId]
      );
    }, 'Duplicate family-level rule for same motherboard + family rejected by partial unique index');

    // ------------------------------------------------------------------
    // TEST 4: Duplicate exact-CPU rule rejected
    // ------------------------------------------------------------------
    await assertRejects(async () => {
      await client.query(
        `INSERT INTO cpu_motherboard_support
           (motherboard_product_id, cpu_product_family_id, cpu_product_id, support_status)
         VALUES ($1, NULL, $2, 'PASS')`,
        [mbProductId, cpuProductId]
      );
    }, 'Duplicate exact-CPU rule for same motherboard + CPU rejected by partial unique index');

    // ------------------------------------------------------------------
    // TEST 5: Both NULL specificity fields rejected
    // ------------------------------------------------------------------
    console.log('\n--- Test 5: Both NULL specificity fields rejected ---');
    await assertRejects(async () => {
      await client.query(
        `INSERT INTO cpu_motherboard_support
           (motherboard_product_id, cpu_product_family_id, cpu_product_id, support_status)
         VALUES ($1, NULL, NULL, 'PASS')`,
        [mbProductId]
      );
    }, 'Both cpu_product_family_id and cpu_product_id NULL rejected by CHECK constraint');

    // ------------------------------------------------------------------
    // TEST 6: Both populated specificity fields rejected
    // ------------------------------------------------------------------
    console.log('\n--- Test 6: Both populated specificity fields rejected ---');
    await assertRejects(async () => {
      await client.query(
        `INSERT INTO cpu_motherboard_support
           (motherboard_product_id, cpu_product_family_id, cpu_product_id, support_status)
         VALUES ($1, $2, $3, 'PASS')`,
        [mbProductId, cpuFamilyId, cpuProductId]
      );
    }, 'Both cpu_product_family_id and cpu_product_id populated rejected by CHECK constraint');

    // ------------------------------------------------------------------
    // Additional tests: cooler_socket_support, case tables
    // ------------------------------------------------------------------
    console.log('\n--- Additional: Cooler/socket support ---');
    const coolerSocketResult = await client.query(
      `INSERT INTO cooler_socket_support (cooler_product_id, socket_id, support_status, mounting_note)
       VALUES ($1, $2, 'PASS', 'Backplate included')
       RETURNING id`,
      [coolerProductId, socketId]
    );
    assert(coolerSocketResult.rows.length === 1, 'Cooler/socket support rule inserted');

    await assertRejects(async () => {
      await client.query(
        `INSERT INTO cooler_socket_support (cooler_product_id, socket_id, support_status)
         VALUES ($1, $2, 'PASS')`,
        [coolerProductId, socketId]
      );
    }, 'Duplicate cooler/socket rule rejected');

    console.log('\n--- Additional: Case/motherboard form factor ---');
    const caseFormResult = await client.query(
      `INSERT INTO case_motherboard_form_factor (case_product_id, form_factor)
       VALUES ($1, 'ATX')
       RETURNING id`,
      [caseProductId]
    );
    assert(caseFormResult.rows.length === 1, 'Case/motherboard form factor rule inserted');

    await assertRejects(async () => {
      await client.query(
        `INSERT INTO case_motherboard_form_factor (case_product_id, form_factor)
         VALUES ($1, 'ATX')`,
        [caseProductId]
      );
    }, 'Duplicate case/form_factor rule rejected');

    console.log('\n--- Additional: Case/radiator support ---');
    const radiatorResult = await client.query(
      `INSERT INTO case_radiator_support (case_product_id, radiator_size_mm, position)
       VALUES ($1, 360, 'FRONT')
       RETURNING id`,
      [caseProductId]
    );
    assert(radiatorResult.rows.length === 1, 'Case/radiator support rule inserted');

    await assertRejects(async () => {
      await client.query(
        `INSERT INTO case_radiator_support (case_product_id, radiator_size_mm, position)
         VALUES ($1, 360, 'FRONT')`,
        [caseProductId]
      );
    }, 'Duplicate case/radiator rule rejected');

    await assertRejects(async () => {
      await client.query(
        `INSERT INTO case_radiator_support (case_product_id, radiator_size_mm, position)
         VALUES ($1, 0, 'FRONT')`,
        [caseProductId]
      );
    }, 'Zero radiator_size_mm rejected by CHECK constraint');

    // ------------------------------------------------------------------
    // Additional tests: Provenance tables
    // ------------------------------------------------------------------
    console.log('\n--- Additional: Provenance tables ---');

    // ingestion_record
    const ingestion = await client.query(
      `INSERT INTO ingestion_record (source_type, source_identifier, status, record_count)
       VALUES ('RETAILER', 'TestCompatIngestion', 'COMPLETED', 42)
       RETURNING id`,
      []
    );
    const ingestionId = ingestion.rows[0].id;
    assert(ingestionId, 'ingestion_record inserted');

    await assertRejects(async () => {
      await client.query(
        `INSERT INTO ingestion_record (source_type, source_identifier, status)
         VALUES ('RETAILER', 'TestCompatIngestion', 'INVALID_STATUS')`
      );
    }, 'Invalid ingestion status rejected by CHECK constraint');

    // product_candidate with UNVERIFIED confidence and NULL matched_product_id
    const candidate = await client.query(
      `INSERT INTO product_candidate
         (ingestion_record_id, source_type, source_identifier, manufacturer_name,
          product_name, sku, confidence, status, raw_data)
       VALUES ($1, 'RETAILER', 'TestCompatListing', 'TestMfg',
               'Test Product', 'TEST-SKU-CANDIDATE', 'UNVERIFIED', 'UNREVIEWED',
               '{"name": "Test Product"}')
       RETURNING id`,
      [ingestionId]
    );
    assert(candidate.rows[0].id, 'product_candidate with UNVERIFIED confidence inserted');

    // product_candidate with UNVERIFIED confidence cannot reference canonical product
    await assertRejects(async () => {
      await client.query(
        `INSERT INTO product_candidate
           (ingestion_record_id, source_type, source_identifier, manufacturer_name,
            product_name, confidence, status, matched_product_id)
         VALUES ($1, 'RETAILER', 'TestCompatListing2', 'TestMfg',
                 'Test Product 2', 'UNVERIFIED', 'UNREVIEWED', $2)`,
        [ingestionId, mbProductId]
      );
    }, 'Unverified candidate cannot reference canonical product (CHECK constraint)');

    // product_candidate with MEDIUM confidence CAN reference canonical product
    const verifiedCandidate = await client.query(
      `INSERT INTO product_candidate
         (ingestion_record_id, source_type, source_identifier, manufacturer_name,
          product_name, confidence, status, matched_product_id)
       VALUES ($1, 'DATASHEET', 'TestCompatListing3', 'TestMfg',
               'Test Product 3', 'MEDIUM', 'MATCHED', $2)
       RETURNING id`,
      [ingestionId, mbProductId]
    );
    assert(verifiedCandidate.rows[0].id, 'Verified candidate (MEDIUM) can reference canonical product');

    // retailer_listing_alias with UNVERIFIED confidence and NULL matched_product_id
    const alias = await client.query(
      `INSERT INTO retailer_listing_alias (retailer_name, listing_identifier, confidence)
       VALUES ('TestRetailer', 'TestCompatListingAlias', 'UNVERIFIED')
       RETURNING id`,
      []
    );
    assert(alias.rows[0].id, 'retailer_listing_alias with UNVERIFIED confidence inserted');

    // retailer_listing_alias with UNVERIFIED confidence cannot reference canonical product
    await assertRejects(async () => {
      await client.query(
        `INSERT INTO retailer_listing_alias
           (retailer_name, listing_identifier, confidence, matched_product_id)
         VALUES ('TestRetailer', 'TestCompatListingAlias2', 'UNVERIFIED', $1)`,
        [mbProductId]
      );
    }, 'Unverified alias cannot reference canonical product (CHECK constraint)');

    // retailer_listing_alias with CONFIRMED confidence CAN reference canonical product
    const verifiedAlias = await client.query(
      `INSERT INTO retailer_listing_alias
         (retailer_name, listing_identifier, confidence, matched_product_id)
       VALUES ('TestRetailer', 'TestCompatListingAlias3', 'CONFIRMED', $1)
       RETURNING id`,
      [mbProductId]
    );
    assert(verifiedAlias.rows[0].id, 'Verified alias (CONFIRMED) can reference canonical product');

    // Duplicate alias rejected
    await assertRejects(async () => {
      await client.query(
        `INSERT INTO retailer_listing_alias (retailer_name, listing_identifier, confidence)
         VALUES ('TestRetailer', 'TestCompatListingAlias', 'UNVERIFIED')`
      );
    }, 'Duplicate retailer_listing_alias (same retailer + identifier) rejected');

    // spec_provenance
    const familySupportId = familyResult.rows[0].id;
    const provenance = await client.query(
      `INSERT INTO spec_provenance
         (target_table, target_id, target_column, source_type, confidence, source_identifier, source_note)
       VALUES ('cpu_motherboard_support', $1, 'support_status', 'OFFICIAL', 'CONFIRMED',
               'TestCompatSourceURL', 'ASUS support matrix')
       RETURNING id`,
      [familySupportId]
    );
    assert(provenance.rows[0].id, 'spec_provenance inserted');

    // Duplicate provenance rejected
    await assertRejects(async () => {
      await client.query(
        `INSERT INTO spec_provenance
           (target_table, target_id, target_column, source_type, confidence, source_identifier)
         VALUES ('cpu_motherboard_support', $1, 'support_status', 'OFFICIAL', 'CONFIRMED', 'TestCompatSourceURL')`,
        [familySupportId]
      );
    }, 'Duplicate spec_provenance for same target+source+field rejected');

    // ------------------------------------------------------------------
    // Verify schema structure
    // ------------------------------------------------------------------
    console.log('\n--- Schema verification ---');

    // platform_memory_support was not duplicated
    const pmsExists = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'platform_memory_support'
    `);
    assert(pmsExists.rows.length === 1, 'platform_memory_support exists (not duplicated)');

    // cpu_motherboard_support has the CHECK constraint
    const chkExists = await client.query(`
      SELECT constraint_name FROM information_schema.table_constraints
      WHERE table_name = 'cpu_motherboard_support' AND constraint_type = 'CHECK'
      AND constraint_name = 'chk_cpu_motherboard_specificity'
    `);
    assert(chkExists.rows.length === 1, 'cpu_motherboard_support has specificity CHECK constraint');

    // Partial unique indexes exist
    const familyIdx = await client.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'cpu_motherboard_support' AND indexname = 'idx_cpu_mb_support_family'
    `);
    assert(familyIdx.rows.length === 1, 'Partial unique index idx_cpu_mb_support_family exists');

    const cpuIdx = await client.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'cpu_motherboard_support' AND indexname = 'idx_cpu_mb_support_cpu'
    `);
    assert(cpuIdx.rows.length === 1, 'Partial unique index idx_cpu_mb_support_cpu exists');

    // Verify partial index predicates
    const familyIdxDef = await client.query(`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_cpu_mb_support_family'
    `);
    assert(familyIdxDef.rows[0].indexdef.includes('WHERE'), 'Family index has WHERE clause');
    assert(familyIdxDef.rows[0].indexdef.includes('cpu_product_id IS NULL'), 'Family index predicates on cpu_product_id IS NULL');

    const cpuIdxDef = await client.query(`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_cpu_mb_support_cpu'
    `);
    assert(cpuIdxDef.rows[0].indexdef.includes('WHERE'), 'CPU index has WHERE clause');
    assert(cpuIdxDef.rows[0].indexdef.includes('cpu_product_id IS NOT NULL'), 'CPU index predicates on cpu_product_id IS NOT NULL');

    // Verify gpu_case_compatibility and gpu_psu_compatibility were NOT created
    const gpuCaseExists = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'gpu_case_compatibility'
    `);
    assert(gpuCaseExists.rows.length === 0, 'gpu_case_compatibility NOT created (derived later)');

    const gpuPsuExists = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'gpu_psu_compatibility'
    `);
    assert(gpuPsuExists.rows.length === 0, 'gpu_psu_compatibility NOT created (derived later)');

    // ------------------------------------------------------------------
    // Summary
    // ------------------------------------------------------------------
    console.log('\n--- Summary ---');
    console.log('Passed: ' + passed);
    console.log('Failed: ' + failed);

    await client.end();
  } catch (err) {
    console.error('ERROR:', err.message);
    if (client) await client.end();
    process.exit(1);
  }
})();
