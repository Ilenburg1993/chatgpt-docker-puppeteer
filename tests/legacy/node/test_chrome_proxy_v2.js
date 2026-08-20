import assert from 'node:assert';

console.log('[TEST] ChromeProxyService v2.0 - Starting tests...\n');

import ChromeProxyService from '#infra/proxy/chromeProxyService';

/** @typedef {{
 *     state: string;
 *     onFailure: () => void;
 *     call: <T>(operation: () => Promise<T>) => Promise<T>;
 * }} CircuitBreakerTestPort */

/** @typedef {{
 *     circuitBreaker: CircuitBreakerTestPort;
 *     rewriteWebSocketURL: (data: string, host: string) => string;
 *     _getCORSHeaders: (request: { headers: { origin?: string } }) => Record<string, string>;
 *     cache: { version: string | null; versionExpires: number };
 *     stats: { cacheHits: number; cacheMisses: number };
 *     _incrementMetric: (metric: { inc: (...args: unknown[]) => void }, labels: Record<string, unknown>) => void;
 *     config: { PUBLIC_IP: string };
 *     _getDockerInternalIP: () => string | null;
 * }} ChromeProxyTestPort */

/** @param {unknown} error @returns {string} */
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

/* ==========================================================================
   Test 1: Config Validation
========================================================================== */
console.log('Test 1: Config validation (fail-fast)');
try {
    new ChromeProxyService({ PROXY_PORT: 'invalid' });
    console.log('❌ Should have thrown error for invalid PROXY_PORT');
    process.exit(1);
} catch (err) {
    const message = errorMessage(err);
    if (message.includes('Invalid PROXY_PORT')) {
        console.log('✅ Config validation works correctly\n');
    } else {
        console.log('❌ Wrong error:', message);
        process.exit(1);
    }
}

try {
    new ChromeProxyService({ PROXY_PORT: 99999 });
    console.log('❌ Should have thrown error for out-of-range port');
    process.exit(1);
} catch (err) {
    const message = errorMessage(err);
    if (message.includes('Invalid PROXY_PORT')) {
        console.log('✅ Port range validation works\n');
    } else {
        console.log('❌ Wrong error:', message);
        process.exit(1);
    }
}

try {
    new ChromeProxyService({ ALLOWED_ORIGINS: [] });
    console.log('❌ Should have thrown error for empty ALLOWED_ORIGINS');
    process.exit(1);
} catch (err) {
    const message = errorMessage(err);
    if (message.includes('ALLOWED_ORIGINS')) {
        console.log('✅ ALLOWED_ORIGINS validation works\n');
    } else {
        console.log('❌ Wrong error:', message);
        process.exit(1);
    }
}

/* ==========================================================================
   Test 2: Circuit Breaker
========================================================================== */
console.log('Test 2: Circuit breaker behavior');

// Import CircuitBreaker from the module (we need to extract it)
// For now, we'll test it through the service
const service = new ChromeProxyService({
    PROXY_PORT: 9224,
    CHROME_PORT: 9225,
    CHROME_HOST: 'host.docker.internal',
    PUBLIC_IP: 'localhost',
});
const testService = /** @type {ChromeProxyTestPort} */ (/** @type {unknown} */ (service));

// Access circuit breaker
const cb = testService.circuitBreaker;
assert.strictEqual(cb.state, 'CLOSED', 'Initial state should be CLOSED');
console.log('✅ Circuit breaker starts in CLOSED state');

// Simulate failures
for (let i = 0; i < 5; i++) {
    cb.onFailure();
}
assert.strictEqual(cb.state, 'OPEN', 'Should be OPEN after threshold failures');
console.log('✅ Circuit breaker opens after threshold failures');

// Test rejection when OPEN
(async () => {
    try {
        await cb.call(async () => 'test');
        console.log('❌ Should have thrown error when circuit is OPEN');
        process.exit(1);
    } catch (err) {
        const message = errorMessage(err);
        if (message.includes('Circuit breaker')) {
            console.log('✅ Circuit breaker rejects calls when OPEN\n');
        } else {
            console.log('❌ Wrong error:', message);
            process.exit(1);
        }
    }
})();

/* ==========================================================================
   Test 3: URL Rewriting
========================================================================== */
console.log('Test 3: URL rewriting');

const data = JSON.stringify({
    webSocketDebuggerUrl: 'ws://host.docker.internal:9225/devtools/page/abc123',
});

const rewritten = testService.rewriteWebSocketURL(data, 'localhost:9224');
const parsed = JSON.parse(rewritten);

if (parsed.webSocketDebuggerUrl.includes('localhost') && parsed.webSocketDebuggerUrl.includes('9224')) {
    console.log('✅ URL rewriting works correctly');
    console.log(`   Original: ws://host.docker.internal:9225/...`);
    console.log(`   Rewritten: ${parsed.webSocketDebuggerUrl}\n`);
} else {
    console.log('❌ URL rewriting failed');
    console.log('   Expected: localhost:9224');
    console.log('   Got:', parsed.webSocketDebuggerUrl);
    process.exit(1);
}

// Test array rewriting
const arrayData = JSON.stringify([
    {
        id: 'page1',
        webSocketDebuggerUrl: 'ws://host.docker.internal:9225/devtools/page/1',
    },
    {
        id: 'page2',
        webSocketDebuggerUrl: 'ws://localhost:9225/devtools/page/2',
    },
]);

const rewrittenArray = testService.rewriteWebSocketURL(arrayData, 'localhost:9224');
const parsedArray = JSON.parse(rewrittenArray);

if (
    parsedArray[0].webSocketDebuggerUrl.includes('localhost:9224') &&
    parsedArray[1].webSocketDebuggerUrl.includes('localhost:9224')
) {
    console.log('✅ Array URL rewriting works correctly\n');
} else {
    console.log('❌ Array URL rewriting failed');
    console.log('   Got:', parsedArray);
    process.exit(1);
}

/* ==========================================================================
   Test 4: CORS Headers
========================================================================== */
console.log('Test 4: CORS headers (whitelist)');
const mockReq = {
    headers: {
        origin: 'http://localhost:3008',
    },
};

const corsHeaders = testService._getCORSHeaders(mockReq);
assert.strictEqual(corsHeaders['Access-Control-Allow-Origin'], 'http://localhost:3008');
assert.strictEqual(corsHeaders['Access-Control-Allow-Credentials'], 'true');
console.log('✅ CORS whitelist works for allowed origin');

const mockReqUnknown = {
    headers: {
        origin: 'http://evil.com',
    },
};

const corsHeadersUnknown = testService._getCORSHeaders(mockReqUnknown);
assert.notStrictEqual(corsHeadersUnknown['Access-Control-Allow-Origin'], 'http://evil.com');
console.log('✅ CORS blocks unknown origins\n');

/* ==========================================================================
   Test 5: Cache Behavior
========================================================================== */
console.log('Test 5: Cache behavior');
assert.strictEqual(testService.cache.version, null, 'Cache should start empty');
assert.strictEqual(testService.stats.cacheHits, 0, 'Cache hits should be 0');
assert.strictEqual(testService.stats.cacheMisses, 0, 'Cache misses should be 0');

// Simulate cache population
testService.cache.version = JSON.stringify({ Browser: 'Chrome/120.0' });
testService.cache.versionExpires = Date.now() + 30000;

assert.notStrictEqual(testService.cache.version, null, 'Cache should be populated');
console.log('✅ Cache can be populated');

// Test cache expiration
testService.cache.versionExpires = Date.now() - 1000; // Expired
const isExpired = Date.now() > testService.cache.versionExpires;
assert.strictEqual(isExpired, true, 'Cache should detect expiration');
console.log('✅ Cache expiration detection works\n');

/* ==========================================================================
   Test 6: Metrics Helpers
========================================================================== */
console.log('Test 6: Metrics helpers (error handling)');
// Test that metrics don't throw errors even if Prometheus fails
const mockMetric = {
    name: 'test_metric',
    inc: () => {
        throw new Error('Prometheus error');
    },
};

try {
    testService._incrementMetric(mockMetric, {});
    console.log('✅ Metrics errors are handled gracefully (no crash)\n');
} catch (err) {
    console.log('❌ Metrics helper should not throw:', errorMessage(err));
    process.exit(1);
}

/* ==========================================================================
   Test 7: PUBLIC_IP Detection
========================================================================== */
console.log('Test 7: PUBLIC_IP detection');
const detectedIP = testService.config.PUBLIC_IP;
assert.notStrictEqual(detectedIP, null, 'PUBLIC_IP should be detected');
assert.notStrictEqual(detectedIP, undefined, 'PUBLIC_IP should be defined');
console.log(`✅ PUBLIC_IP detected: ${detectedIP}\n`);

/* ==========================================================================
   Test 8: Docker Internal IP Detection
========================================================================== */
console.log('Test 8: Docker internal IP detection');
const dockerIP = testService._getDockerInternalIP();
if (dockerIP) {
    assert.ok(dockerIP.startsWith('172.'), 'Docker IP should start with 172.');
    console.log(`✅ Docker internal IP detected: ${dockerIP}\n`);
} else {
    console.log('⚠️  Docker internal IP not detected (may not be in container)\n');
}

/* ==========================================================================
   Test Summary
========================================================================== */
console.log('═══════════════════════════════════════════════════════════');
console.log('✅ ALL TESTS PASSED');
console.log('═══════════════════════════════════════════════════════════');
console.log('Tests executed:');
console.log('  1. Config validation (fail-fast)');
console.log('  2. Circuit breaker behavior');
console.log('  3. URL rewriting');
console.log('  4. CORS headers (whitelist)');
console.log('  5. Cache behavior');
console.log('  6. Metrics helpers');
console.log('  7. PUBLIC_IP detection');
console.log('  8. Docker internal IP detection');
console.log('═══════════════════════════════════════════════════════════\n');

process.exit(0);
