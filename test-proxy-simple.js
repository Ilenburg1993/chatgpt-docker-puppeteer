#!/usr/bin/env node
/**
 * test-proxy-simple.js Simple test for Chrome Proxy (Docker Desktop Edition) Tests: Proxy → host.docker.internal:9225 →
 * Windows Chrome
 */

const puppeteer = require('puppeteer');
const axios = require('axios');

const PROXY_URL = 'http://localhost:9224';

async function main() {
    console.log('🧪 CHROME PROXY INTEGRATION TEST (Docker Desktop Edition)\n');

    // Test 1: Proxy Health
    console.log('[TEST 1] Checking proxy health...');
    try {
        const health = await axios.get(`${PROXY_URL}/health`, { timeout: 3000 });
        console.log(`✅ Proxy health: ${health.data.status}`);
    } catch (err) {
        console.error(`❌ Proxy health failed: ${err.message}`);
        process.exit(1);
    }

    // Test 2: Chrome version via proxy
    console.log('\n[TEST 2] Getting Chrome version via proxy...');
    try {
        const version = await axios.get(`${PROXY_URL}/json/version`, { timeout: 3000 });
        console.log(`✅ Chrome version: ${version.data.Browser}`);
    } catch (err) {
        console.error(`❌ Version check failed: ${err.message}`);
        process.exit(1);
    }

    // Test 3: Get browser WS endpoint
    console.log('\n[TEST 3] Getting browser WebSocket endpoint...');
    let wsEndpoint;
    try {
        const version = await axios.get(`${PROXY_URL}/json/version`, { timeout: 3000 });
        wsEndpoint = version.data.webSocketDebuggerUrl;
        console.log(`✅ WS Endpoint: ${wsEndpoint}`);
    } catch (err) {
        console.error(`❌ Failed to get WS endpoint: ${err.message}`);
        process.exit(1);
    }

    // Test 4: Connect via Puppeteer
    console.log('\n[TEST 4] Connecting Puppeteer via proxy...');
    let browser;
    try {
        browser = await puppeteer.connect({
            browserWSEndpoint: wsEndpoint,
            defaultViewport: null,
        });
        console.log('✅ Puppeteer connected');
    } catch (err) {
        console.error(`❌ Puppeteer connection failed: ${err.message}`);
        process.exit(1);
    }

    // Test 5: Create page and navigate
    console.log('\n[TEST 5] Creating page and navigating...');
    try {
        const page = await browser.newPage();
        await page.goto('https://example.com', { waitUntil: 'networkidle2', timeout: 30000 });
        const title = await page.title();
        console.log(`✅ Page loaded: ${title}`);
        await page.close();
    } catch (err) {
        console.error(`❌ Page navigation failed: ${err.message}`);
        if (browser) await browser.disconnect();
        process.exit(1);
    }

    // Cleanup
    console.log('\n[TEST 6] Disconnecting...');
    try {
        await browser.disconnect();
        console.log('✅ Disconnected');
    } catch (err) {
        console.error(`❌ Disconnect failed: ${err.message}`);
    }

    console.log('\n🎉 ALL TESTS PASSED!\n');
    console.log('Summary:');
    console.log('  ✅ Proxy health check');
    console.log('  ✅ Chrome version retrieval');
    console.log('  ✅ WebSocket endpoint discovery');
    console.log('  ✅ Puppeteer connection');
    console.log('  ✅ Page navigation (example.com)');
    console.log('  ✅ Clean disconnect');
    console.log('\nArchitecture: Container → Proxy (0.0.0.0:9224) → host.docker.internal:9225 → Windows Chrome');
}

main().catch((err) => {
    console.error('\n💥 TEST SUITE FAILED:', err.message);
    process.exit(1);
});
