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

  try {
    // Clean up any previous test data
    await client.query(`DELETE FROM cooler_spec WHERE product_id IN (SELECT id FROM product WHERE name LIKE 'Test Product%')`);
    await client.query(`DELETE FROM case_spec WHERE product_id IN (SELECT id FROM product WHERE name LIKE 'Test Product%')`);
    await client.query(`DELETE FROM psu_spec WHERE product_id IN (SELECT id FROM product WHERE name LIKE 'Test Product%')`);
    await client.query(`DELETE FROM ssd_spec WHERE product_id IN (SELECT id FROM product WHERE name LIKE 'Test Product%')`);
    await client.query(`DELETE FROM ram_spec WHERE product_id IN (SELECT id FROM product WHERE name LIKE 'Test Product%')`);
    await client.query(`DELETE FROM motherboard_spec WHERE product_id IN (SELECT id FROM product WHERE name LIKE 'Test Product%')`);
    await client.query(`DELETE FROM cpu_spec WHERE product_id IN (SELECT id FROM product WHERE name LIKE 'Test Product%')`);
    await client.query(`DELETE FROM gpu_board_spec WHERE product_variant_id IN (SELECT id FROM product_variant WHERE sku LIKE 'TEST-%')`);
    await client.query(`DELETE FROM gpu_chipset WHERE name LIKE 'Test GPU Chipset%'`);
    await client.query(`DELETE FROM product_variant WHERE sku LIKE 'TEST-%'`);
    await client.query(`DELETE FROM product WHERE name LIKE 'Test Product%'`);
    await client.query(`DELETE FROM product_family WHERE name = 'Test Family'`);
    await client.query(`DELETE FROM chipset WHERE name = 'Test Chipset'`);
    await client.query(`DELETE FROM memory_type WHERE name = 'DDR5'`);
    await client.query(`DELETE FROM socket WHERE name = 'Test Socket'`);
    await client.query(`DELETE FROM manufacturer WHERE name = 'Test Manufacturer'`);

    // Seed minimal reference data for testing
    const manufacturer = await client.query(`INSERT INTO manufacturer (name) VALUES ($1) RETURNING id`, ['Test Manufacturer']);
    const manufacturerId = manufacturer.rows[0].id;

    const socket = await client.query(`INSERT INTO socket (name) VALUES ($1) RETURNING id`, ['Test Socket']);
    const socketId = socket.rows[0].id;

    const memoryType = await client.query(`INSERT INTO memory_type (name) VALUES ($1) RETURNING id`, ['DDR5']);
    const memoryTypeId = memoryType.rows[0].id;

    const productFamily = await client.query(`INSERT INTO product_family (name, manufacturer_id) VALUES ($1, $2) RETURNING id`, ['Test Family', manufacturerId]);
    const productFamilyId = productFamily.rows[0].id;

    const chipset = await client.query(`INSERT INTO chipset (manufacturer_id, name) VALUES ($1, $2) RETURNING id`, [manufacturerId, 'Test Chipset']);
    const chipsetId = chipset.rows[0].id;

    assert(manufacturerId, 'manufacturer exists');
    assert(socketId, 'socket exists');
    assert(memoryTypeId, 'memory_type exists');
    assert(productFamilyId, 'product_family exists');
    assert(chipsetId, 'chipset exists');

    // Create GPU chipset for tests
    const gpuChipset = await client.query(`
      INSERT INTO gpu_chipset (manufacturer_id, name, vram_capacity_gb, vram_type, memory_bus_width_bit, pcie_interface, base_tgp_watts)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id
    `, [manufacturerId, 'Test GPU Chipset', 16, 'GDDR6X', 256, 'PCIe 4.0 x16', 350]);
    const gpuChipsetId = gpuChipset.rows[0].id;
    assert(gpuChipsetId, 'GPU chipset inserted');

    // Test 1: Valid GPU chipset
    assert(true, 'Valid GPU chipset inserted');

    // Helper to create a product + variant for gpu_board_spec tests
    async function createPv(sku) {
      const p = await client.query(`INSERT INTO product (product_family_id, manufacturer_id, name) VALUES ($1, $2, $3) RETURNING id`, [productFamilyId, manufacturerId, 'Test Product ' + sku]);
      const pv = await client.query(`INSERT INTO product_variant (product_id, sku) VALUES ($1, $2) RETURNING id`, [p.rows[0].id, sku]);
      return pv.rows[0].id;
    }

    // Test 2: Valid GPU board spec with JSONB and decimal width
    const pv2 = await createPv('TEST-SKU-002');
    const gpuBoard = await client.query(`
      INSERT INTO gpu_board_spec (product_variant_id, gpu_chipset_id, board_tgp_watts, length_mm, width_slots, height_mm, required_power_connectors, recommended_psu_watts)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING product_variant_id
    `, [pv2, gpuChipsetId, 320, 300, 2.5, 40, JSON.stringify([{ type: '8-pin', count: 2 }]), 650]);
    assert(gpuBoard.rows[0].product_variant_id, 'Valid GPU board spec inserted with JSONB and width_slots=2.5');

    // Test 3: GPU JSONB - verify valid connector data
    const gpuBoardCheck = await client.query('SELECT required_power_connectors FROM gpu_board_spec WHERE product_variant_id = $1', [gpuBoard.rows[0].product_variant_id]);
    const connectors = gpuBoardCheck.rows[0].required_power_connectors;
    assert(Array.isArray(connectors) && connectors[0].type === '8-pin' && connectors[0].count === 2, 'GPU JSONB connectors stored correctly');

    // Test 4: width_slots accepts 2.0
    const pv3 = await createPv('TEST-SKU-003');
    const gpuBoard2 = await client.query(`INSERT INTO gpu_board_spec (product_variant_id, gpu_chipset_id, width_slots) VALUES ($1, $2, $3) RETURNING product_variant_id`, [pv3, gpuChipsetId, 2.0]);
    assert(gpuBoard2.rows[0].product_variant_id, 'width_slots accepts 2.0');

    // Test 5: width_slots accepts 2.7
    const pv4 = await createPv('TEST-SKU-004');
    const gpuBoard3 = await client.query(`INSERT INTO gpu_board_spec (product_variant_id, gpu_chipset_id, width_slots) VALUES ($1, $2, $3) RETURNING product_variant_id`, [pv4, gpuChipsetId, 2.7]);
    assert(gpuBoard3.rows[0].product_variant_id, 'width_slots accepts 2.7');

    // Test 6: width_slots accepts 3.5
    const pv5 = await createPv('TEST-SKU-005');
    const gpuBoard4 = await client.query(`INSERT INTO gpu_board_spec (product_variant_id, gpu_chipset_id, width_slots) VALUES ($1, $2, $3) RETURNING product_variant_id`, [pv5, gpuChipsetId, 3.5]);
    assert(gpuBoard4.rows[0].product_variant_id, 'width_slots accepts 3.5');

    // Test 7: width_slots rejects 0
    const pv6 = await createPv('TEST-SKU-006');
    try {
      await client.query(`INSERT INTO gpu_board_spec (product_variant_id, gpu_chipset_id, width_slots) VALUES ($1, $2, $3)`, [pv6, gpuChipsetId, 0]);
      assert(false, 'width_slots rejects 0');
    } catch (e) {
      assert(true, 'width_slots rejects 0');
    }

    // Test 8: width_slots rejects negative
    const pv7 = await createPv('TEST-SKU-007');
    try {
      await client.query(`INSERT INTO gpu_board_spec (product_variant_id, gpu_chipset_id, width_slots) VALUES ($1, $2, $3)`, [pv7, gpuChipsetId, -1]);
      assert(false, 'width_slots rejects negative');
    } catch (e) {
      assert(true, 'width_slots rejects negative');
    }

    // Test 9: NULL width_slots is allowed
    const pv8 = await createPv('TEST-SKU-008');
    const gpuBoardNull = await client.query(`INSERT INTO gpu_board_spec (product_variant_id, gpu_chipset_id) VALUES ($1, $2) RETURNING product_variant_id`, [pv8, gpuChipsetId]);
    assert(gpuBoardNull.rows[0].product_variant_id, 'NULL width_slots is allowed');

    // Test 10: Valid CPU spec
    const pCPU = await client.query(`INSERT INTO product (product_family_id, manufacturer_id, name) VALUES ($1, $2, $3) RETURNING id`, [productFamilyId, manufacturerId, 'Test Product CPU']);
    const cpuSpec = await client.query(`
      INSERT INTO cpu_spec (product_id, socket_id, cores, threads, base_clock_mhz, boost_clock_mhz, tdp_watts)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING product_id
    `, [pCPU.rows[0].id, socketId, 8, 16, 3400, 5000, 65]);
    assert(cpuSpec.rows[0].product_id, 'Valid CPU spec inserted');

    // Test 11: Valid motherboard spec
    const pMB = await client.query(`INSERT INTO product (product_family_id, manufacturer_id, name) VALUES ($1, $2, $3) RETURNING id`, [productFamilyId, manufacturerId, 'Test Product Motherboard']);
    const mbSpec = await client.query(`
      INSERT INTO motherboard_spec (product_id, socket_id, chipset_id, memory_type_id, dimm_slots, max_memory_capacity_gb)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING product_id
    `, [pMB.rows[0].id, socketId, chipsetId, memoryTypeId, 4, 64]);
    assert(mbSpec.rows[0].product_id, 'Valid motherboard spec inserted');

    // Test 12: Valid RAM spec
    const pRAM = await client.query(`INSERT INTO product (product_family_id, manufacturer_id, name) VALUES ($1, $2, $3) RETURNING id`, [productFamilyId, manufacturerId, 'Test Product RAM']);
    const ramSpec = await client.query(`
      INSERT INTO ram_spec (product_id, memory_type_id, module_count, capacity_per_module_gb, rated_speed_mtps, voltage_v)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING product_id
    `, [pRAM.rows[0].id, memoryTypeId, 2, 16, 3200, 1.35]);
    assert(ramSpec.rows[0].product_id, 'Valid RAM spec inserted');

    // Test 13: Valid SSD spec
    const pSSD = await client.query(`INSERT INTO product (product_family_id, manufacturer_id, name) VALUES ($1, $2, $3) RETURNING id`, [productFamilyId, manufacturerId, 'Test Product SSD']);
    const ssdSpec = await client.query(`
      INSERT INTO ssd_spec (product_id, capacity_gb, form_factor, interface, protocol, pcie_generation)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING product_id
    `, [pSSD.rows[0].id, 1000, 'M_2_2280', 'PCIe', 'NVMe', 4]);
    assert(ssdSpec.rows[0].product_id, 'Valid SSD spec inserted');

    // Test 14: Valid PSU spec
    const pPSU = await client.query(`INSERT INTO product (product_family_id, manufacturer_id, name) VALUES ($1, $2, $3) RETURNING id`, [productFamilyId, manufacturerId, 'Test Product PSU']);
    const psuSpec = await client.query(`
      INSERT INTO psu_spec (product_id, rated_wattage, form_factor, length_mm)
      VALUES ($1, $2, $3, $4) RETURNING product_id
    `, [pPSU.rows[0].id, 750, 'ATX', 160]);
    assert(psuSpec.rows[0].product_id, 'Valid PSU spec inserted');

    // Test 15: Valid case spec
    const pCase = await client.query(`INSERT INTO product (product_family_id, manufacturer_id, name) VALUES ($1, $2, $3) RETURNING id`, [productFamilyId, manufacturerId, 'Test Product Case']);
    const caseSpec = await client.query(`
      INSERT INTO case_spec (product_id, max_gpu_length_mm, max_gpu_thickness_slots, max_cpu_cooler_height_mm, max_psu_length_mm)
      VALUES ($1, $2, $3, $4, $5) RETURNING product_id
    `, [pCase.rows[0].id, 350, 3, 160, 200]);
    assert(caseSpec.rows[0].product_id, 'Valid case spec inserted');

    // Test 16: Valid cooler spec
    const pCooler = await client.query(`INSERT INTO product (product_family_id, manufacturer_id, name) VALUES ($1, $2, $3) RETURNING id`, [productFamilyId, manufacturerId, 'Test Product Cooler']);
    const coolerSpec = await client.query(`
      INSERT INTO cooler_spec (product_id, cooling_type, max_tdp_watts, height_mm, length_mm, width_mm)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING product_id
    `, [pCooler.rows[0].id, 'AIR', 150, 160, 120, 120]);
    assert(coolerSpec.rows[0].product_id, 'Valid cooler spec inserted');

    // Test 17: NULL recommended_psu_watts is allowed
    const pv9 = await createPv('TEST-SKU-009');
    const gpuBoardNullPsu = await client.query(`INSERT INTO gpu_board_spec (product_variant_id, gpu_chipset_id, recommended_psu_watts) VALUES ($1, $2, $3) RETURNING product_variant_id`, [pv9, gpuChipsetId, null]);
    assert(gpuBoardNullPsu.rows[0].product_variant_id, 'NULL recommended_psu_watts is allowed');

    // Test 18: GPU chipset NULL fields are allowed
    const gpuChipsetNull = await client.query(`
      INSERT INTO gpu_chipset (manufacturer_id, name) VALUES ($1, $2) RETURNING id
    `, [manufacturerId, 'Test GPU Chipset 2']);
    assert(gpuChipsetNull.rows[0].id, 'GPU chipset with NULL optional fields is allowed');

    // Test 19: GPU chipset rejects negative base_tgp_watts
    try {
      await client.query(`INSERT INTO gpu_chipset (manufacturer_id, name, base_tgp_watts) VALUES ($1, $2, $3)`, [manufacturerId, 'Bad GPU Chipset', -1]);
      assert(false, 'GPU chipset rejects negative base_tgp_watts');
    } catch (e) {
      assert(true, 'GPU chipset rejects negative base_tgp_watts');
    }

    // Test 20: GPU chipset rejects zero vram_capacity_gb
    try {
      await client.query(`INSERT INTO gpu_chipset (manufacturer_id, name, vram_capacity_gb) VALUES ($1, $2, $3)`, [manufacturerId, 'Bad GPU Chipset 2', 0]);
      assert(false, 'GPU chipset rejects zero vram_capacity_gb');
    } catch (e) {
      assert(true, 'GPU chipset rejects zero vram_capacity_gb');
    }

    // Test 21: CPU spec allows NULL boost_clock_mhz
    const pCPU2 = await client.query(`INSERT INTO product (product_family_id, manufacturer_id, name) VALUES ($1, $2, $3) RETURNING id`, [productFamilyId, manufacturerId, 'Test Product CPU NullBoost']);
    const cpuSpecNullBoost = await client.query(`
      INSERT INTO cpu_spec (product_id, socket_id, cores, threads, base_clock_mhz, tdp_watts)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING product_id
    `, [pCPU2.rows[0].id, socketId, 4, 8, 3000, 95]);
    assert(cpuSpecNullBoost.rows[0].product_id, 'CPU spec allows NULL boost_clock_mhz');

    // Test 22: motherboard_spec.socket_id is authoritative (verify FK exists)
    const mbFk = await client.query(`
      SELECT tc.constraint_name
      FROM information_schema.table_constraints tc
      WHERE tc.table_name = 'motherboard_spec' AND tc.constraint_type = 'FOREIGN KEY' AND tc.constraint_name LIKE '%socket%'
    `);
    assert(mbFk.rows.length > 0, 'motherboard_spec.socket_id FK exists');

    // Test 23: chipset does NOT contain socket_id
    const chipsetCols = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'chipset' AND column_name = 'socket_id'
    `);
    assert(chipsetCols.rows.length === 0, 'chipset does NOT contain socket_id');

    // Test 24: gpu_chipset does NOT contain socket_id
    const gpuChipsetCols = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'gpu_chipset' AND column_name = 'socket_id'
    `);
    assert(gpuChipsetCols.rows.length === 0, 'gpu_chipset does NOT contain socket_id');

    // Test 25: gpu_chipset does NOT contain inferred fields
    const inferredFields = ['architecture', 'compute_units', 'base_clock_mhz', 'boost_clock_mhz', 'tdp_watts', 'memory_type', 'memory_bandwidth_gbps', 'memory_bus_width_bits'];
    const gpuChipsetAllCols = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'gpu_chipset'
    `);
    const gpuChipsetColNames = gpuChipsetAllCols.rows.map(r => r.column_name);
    const hasInferred = inferredFields.some(f => gpuChipsetColNames.includes(f));
    assert(!hasInferred, 'gpu_chipset does NOT contain inferred fields');

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
