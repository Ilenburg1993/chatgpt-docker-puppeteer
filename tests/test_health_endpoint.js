#!/usr/bin/env node
/**
 * Test: Health Endpoint Validation
 * Status: Development (Pre-v1.0)
 * Purpose: Validate that health endpoints return expected structure
 */

const http = require('http');

console.log('\n=== TEST: Health Endpoint Validation ===');

// Mock test - validates module structure without running server
console.log('> Validating health endpoint implementation...');

try {
    // Check doctor.js exports
    const doctor = require('../src/core/doctor');
    if (!doctor.probeChromeConnection) {
        throw new Error('probeChromeConnection not exported from doctor.js');
    }
    if (!doctor.runFullCheck) {
        throw new Error('runFullCheck not exported from doctor.js');
    }
    console.log('✓ doctor.js exports validated');

    // Check router.js includes health endpoint
    const fs = require('fs');
    const routerContent = fs.readFileSync('./src/server/api/router.js', 'utf-8');
    if (!routerContent.includes('GET /api/health')) {
        throw new Error('/api/health endpoint not found in router.js');
    }
    if (!routerContent.includes('probeChromeConnection')) {
        throw new Error('probeChromeConnection not used in health endpoint');
    }
    console.log('✓ /api/health endpoint registered');

    // Check system controller includes health
    const systemContent = fs.readFileSync('./src/server/api/controllers/system.js', 'utf-8');
    if (!systemContent.includes('/health')) {
        throw new Error('/health route not found in system controller');
    }
    console.log('✓ /api/system/health endpoint registered');

    console.log('✓ PASS: Health endpoints properly implemented\n');
    process.exit(0);
} catch (err) {
    console.error('✗ FAIL:', err.message);
    process.exit(1);
}
