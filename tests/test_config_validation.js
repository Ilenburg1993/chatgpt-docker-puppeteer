#!/usr/bin/env node
/**
 * Test: Configuration Validation
 * Status: Development (Pre-v1.0)
 * Purpose: Validate config.json and dynamic_rules.json structure and schemas
 */

const fs = require('fs');
const path = require('path');

console.log('\n=== TEST: Configuration Validation ===');

let errors = 0;

// Test 1: config.json exists and is valid JSON
console.log('\n> Testing config.json...');
try {
    const configPath = path.join(__dirname, '../config.json');
    if (!fs.existsSync(configPath)) {
        throw new Error('config.json not found');
    }

    const configContent = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(configContent);

    // Check required fields
    const requiredFields = ['DEBUG_PORT', 'IDLE_SLEEP', 'CYCLE_DELAY', 'allowedDomains'];
    for (const field of requiredFields) {
        if (!(field in config)) {
            throw new Error(`Missing required field: ${field}`);
        }
    }

    // Check types
    if (typeof config.IDLE_SLEEP !== 'number') {
        throw new Error('IDLE_SLEEP must be a number');
    }
    if (!Array.isArray(config.allowedDomains)) {
        throw new Error('allowedDomains must be an array');
    }
    if (config.allowedDomains.length === 0) {
        throw new Error('allowedDomains cannot be empty');
    }

    console.log('✓ config.json is valid');
    console.log(`  - Fields: ${Object.keys(config).filter(k => !k.startsWith('//')).length}`);
    console.log(`  - Allowed domains: ${config.allowedDomains.length}`);
} catch (err) {
    console.error('✗ config.json validation failed:', err.message);
    errors++;
}

// Test 2: dynamic_rules.json exists and is valid JSON
console.log('\n> Testing dynamic_rules.json...');
try {
    const rulesPath = path.join(__dirname, '../dynamic_rules.json');
    if (!fs.existsSync(rulesPath)) {
        throw new Error('dynamic_rules.json not found');
    }

    const rulesContent = fs.readFileSync(rulesPath, 'utf-8');
    const rules = JSON.parse(rulesContent);

    // Check metadata
    if (!rules._meta) {
        throw new Error('Missing _meta section');
    }
    if (typeof rules._meta.version !== 'number') {
        throw new Error('_meta.version must be a number');
    }

    // Check targets structure
    if (!rules.targets || typeof rules.targets !== 'object') {
        throw new Error('Missing or invalid targets section');
    }

    // Check global_selectors
    if (!rules.global_selectors || typeof rules.global_selectors !== 'object') {
        throw new Error('Missing or invalid global_selectors section');
    }

    // Validate at least one target has selectors
    const targetNames = Object.keys(rules.targets).filter(k => !k.startsWith('//'));
    if (targetNames.length === 0) {
        throw new Error('No targets defined');
    }

    for (const targetName of targetNames) {
        const target = rules.targets[targetName];
        if (!target.selectors || typeof target.selectors !== 'object') {
            throw new Error(`Target ${targetName} missing selectors`);
        }
    }

    console.log('✓ dynamic_rules.json is valid');
    console.log(`  - Version: ${rules._meta.version}`);
    console.log(`  - Targets: ${targetNames.length}`);
    console.log(`  - Last updated: ${rules._meta.last_updated || 'N/A'}`);
} catch (err) {
    console.error('✗ dynamic_rules.json validation failed:', err.message);
    errors++;
}

// Test 3: config.js Zod schema loads without errors
console.log('\n> Testing Zod schema integration...');
try {
    const CONFIG = require('../src/core/config');

    // Check exports
    if (!CONFIG.reload) {
        throw new Error('CONFIG.reload not exported');
    }
    if (!CONFIG.all) {
        throw new Error('CONFIG.all not accessible');
    }

    // Check if initialized
    if (!CONFIG.isInitialized) {
        console.log('  ⚠️  Config not yet initialized (expected on first load)');
    }

    console.log('✓ Zod schema integration working');
} catch (err) {
    console.error('✗ Zod schema test failed:', err.message);
    errors++;
}

// Test 4: .gitignore includes sensitive patterns
console.log('\n> Testing .gitignore security patterns...');
try {
    const gitignorePath = path.join(__dirname, '../.gitignore');
    if (!fs.existsSync(gitignorePath)) {
        throw new Error('.gitignore not found');
    }

    const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');

    const requiredPatterns = ['.env', 'logs/', 'fila/', 'respostas/', 'profile/', 'node_modules/'];

    const missing = [];
    for (const pattern of requiredPatterns) {
        if (!gitignoreContent.includes(pattern)) {
            missing.push(pattern);
        }
    }

    if (missing.length > 0) {
        throw new Error(`Missing security patterns: ${missing.join(', ')}`);
    }

    console.log('✓ .gitignore includes all security patterns');
    console.log(`  - Total patterns: ${gitignoreContent.split('\n').filter(l => l && !l.startsWith('#')).length}`);
} catch (err) {
    console.error('✗ .gitignore validation failed:', err.message);
    errors++;
}

// Summary
console.log(`\n${'='.repeat(50)}`);
if (errors === 0) {
    console.log('✓ PASS: All configuration validations passed\n');
    process.exit(0);
} else {
    console.log(`✗ FAIL: ${errors} validation(s) failed\n`);
    process.exit(1);
}
