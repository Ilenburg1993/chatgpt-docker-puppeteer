#!/usr/bin/env node
require('module-alias/register');

console.log('Testing SADI migration...\n');

try {
    // Test 1: SADI module loads
    console.log('1. Loading SADI analyzer...');
    const analyzer = require('@shared/sadi/analyzer');
    console.log('   ✅ SADI module loaded');
    console.log('   Exports:', Object.keys(analyzer).join(', '));

    // Test 2: prerequisite_validator loads
    console.log('\n2. Loading prerequisite_validator...');
    const validator = require('@core/validators/prerequisite_validator');
    console.log('   ✅ prerequisite_validator loaded');

    // Test 3: input_resolver loads
    console.log('\n3. Loading input_resolver...');
    const input = require('@driver/modules/input_resolver');
    console.log('   ✅ input_resolver loaded');

    // Test 4: biomechanics_engine loads
    console.log('\n4. Loading biomechanics_engine...');
    const bio = require('@driver/modules/biomechanics_engine');
    console.log('   ✅ biomechanics_engine loaded');

    console.log('\n✅ SUCCESS: All modules load correctly after SADI migration!');
    console.log('\nMigration Summary:');
    console.log('  - analyzer.js moved: src/driver/modules/ → src/shared/sadi/');
    console.log('  - 4 imports updated to use @shared/sadi/analyzer');
    console.log('  - All critical modules compile and load successfully');

    process.exit(0);
} catch (err) {
    console.error('\n❌ ERROR:', err.message);
    console.error(err.stack);
    process.exit(1);
}
