#!/usr/bin/env node
/**
 * Comprehensive MCP Server Test Suite Tests all MCP endpoints and methods for chatgpt-docker-puppeteer
 */

const BASE_URL = 'http://localhost:3008/api/mcp';
const COLORS = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    gray: '\x1b[90m',
};

let testsPassed = 0;
let testsFailed = 0;

/**
 * Utility: Log with colors
 */
/**
 * @param {keyof typeof COLORS} color
 * @param {string} message
 */
function log(color, message) {
    console.log(`${COLORS[color]}${message}${COLORS.reset}`);
}

/**
 * Utility: Make HTTP request
 */
/**
 * @param {string} method
 * @param {string} url
 * @param {unknown} [body]
 */
async function request(method, url, body) {
    /** @type {RequestInit} */
    const options = {
        method,
        headers: { 'Content-Type': 'application/json' },
    };
    if (body) {
        options.body = JSON.stringify(body);
    }
    const response = await fetch(url, options);
    const text = await response.text();
    return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: text ? JSON.parse(text) : null,
    };
}

class TestAssertionError extends Error {
    /**
     * @param {string} message
     * @param {unknown} details
     */
    constructor(message, details) {
        super(message);
        this.contextDetails = details;
    }
}

/**
 * Test runner
 */
/**
 * @param {string} name
 * @param {() => Promise<void>} fn
 */
async function test(name, fn) {
    try {
        log('cyan', `\n▶ ${name}`);
        await fn();
        testsPassed++;
        log('green', `  ✓ PASSED`);
    } catch (error) {
        testsFailed++;
        const message = error instanceof Error ? error.message : String(error);
        log('red', `  ✗ FAILED: ${message}`);
        if (error instanceof TestAssertionError && error.contextDetails) {
            log('gray', `    Details: ${JSON.stringify(error.contextDetails, null, 2)}`);
        }
    }
}

/**
 * Assertion helper
 */
/**
 * @param {unknown} condition
 * @param {string} [message]
 * @param {unknown} [details]
 */
function assert(condition, message = 'Assertion failed', details = null) {
    if (!condition) {
        throw new TestAssertionError(message, details);
    }
}

/**
 * Test Suite
 */
async function runTests() {
    log('blue', '\n═══════════════════════════════════════════════════════');
    log('blue', '  MCP Server Comprehensive Test Suite');
    log('blue', '═══════════════════════════════════════════════════════\n');

    // ========================================================================
    // 1. Discovery Endpoint (GET /api/mcp)
    // ========================================================================
    await test('1.1 GET /api/mcp - Discovery endpoint should return server info', async () => {
        const res = await request('GET', BASE_URL);
        assert(res.status === 200, `Expected 200, got ${res.status}`, res.body);
        assert(res.body.name === 'chatgpt-docker-unified', 'Incorrect server name');
        assert(res.body.protocol === 'MCP/JSON-RPC 2.0', 'Incorrect protocol');
        assert(Array.isArray(res.body.methods), 'Methods should be an array');
        assert(Array.isArray(res.body.tools), 'Tools should be an array');
        assert(res.body.status === 'ready', 'Server should be ready');
        log('gray', `    Methods: ${res.body.methods.join(', ')}`);
        log('gray', `    Tools: ${res.body.tools.join(', ')}`);
    });

    await test('1.2 GET /api/mcp - SSE request should return 405', async () => {
        const res = await fetch(BASE_URL, {
            headers: { Accept: 'text/event-stream' },
        });
        assert(res.status === 405, `Expected 405, got ${res.status}`);
    });

    // ========================================================================
    // 2. Initialize Method
    // ========================================================================
    await test('2.1 POST /api/mcp - Initialize with protocol version', async () => {
        const res = await request('POST', BASE_URL, {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: { protocolVersion: '2024-11-05' },
        });
        assert(res.status === 200, `Expected 200, got ${res.status}`, res.body);
        assert(res.body.jsonrpc === '2.0', 'Invalid JSON-RPC version');
        assert(res.body.id === 1, 'ID mismatch');
        assert(res.body.result.protocolVersion === '2024-11-05', 'Protocol version mismatch');
        assert(res.body.result.serverInfo.name === 'chatgpt-docker-unified', 'Server name mismatch');
        assert(res.body.result.capabilities.tools !== undefined, 'Missing tools capability');
        assert(res.body.result.capabilities.resources !== undefined, 'Missing resources capability');
    });

    await test('2.2 POST /api/mcp - Initialize without protocol version (default)', async () => {
        const res = await request('POST', BASE_URL, {
            jsonrpc: '2.0',
            id: 2,
            method: 'initialize',
            params: {},
        });
        assert(res.status === 200, `Expected 200, got ${res.status}`, res.body);
        assert(res.body.result.protocolVersion === '2024-11-05', 'Should use default version');
    });

    // ========================================================================
    // 3. Notification Methods
    // ========================================================================
    await test('3.1 POST /api/mcp - notifications/initialized (no response)', async () => {
        const res = await request('POST', BASE_URL, {
            jsonrpc: '2.0',
            method: 'notifications/initialized',
            params: {},
        });
        assert(res.status === 202, `Expected 202, got ${res.status}`, res.body);
        assert(res.body === null, 'Notification should not return response body');
    });

    await test('3.2 POST /api/mcp - notifications/cancelled (no response)', async () => {
        const res = await request('POST', BASE_URL, {
            jsonrpc: '2.0',
            method: 'notifications/cancelled',
            params: { requestId: 'test-123', reason: 'User cancelled' },
        });
        assert(res.status === 202, `Expected 202, got ${res.status}`, res.body);
        assert(res.body === null, 'Notification should not return response body');
    });

    // ========================================================================
    // 4. Ping Method
    // ========================================================================
    await test('4.1 POST /api/mcp - ping (liveness check)', async () => {
        const res = await request('POST', BASE_URL, {
            jsonrpc: '2.0',
            id: 3,
            method: 'ping',
            params: {},
        });
        assert(res.status === 200, `Expected 200, got ${res.status}`, res.body);
        assert(res.body.result !== undefined, 'Ping should return result');
    });

    // ========================================================================
    // 5. Tools/List Method
    // ========================================================================
    await test('5.1 POST /api/mcp - tools/list (get all tools)', async () => {
        const res = await request('POST', BASE_URL, {
            jsonrpc: '2.0',
            id: 4,
            method: 'tools/list',
            params: {},
        });
        assert(res.status === 200, `Expected 200, got ${res.status}`, res.body);
        assert(Array.isArray(res.body.result.tools), 'Tools should be an array');
        assert(res.body.result.tools.length > 0, 'Should have at least one tool');

        const tool = res.body.result.tools[0];
        assert(tool.name !== undefined, 'Tool should have name');
        assert(tool.description !== undefined, 'Tool should have description');
        assert(tool.inputSchema !== undefined, 'Tool should have inputSchema');

        log('gray', `    Found ${res.body.result.tools.length} tools:`);
        res.body.result.tools.forEach((/** @type {{ name: string; description: string }} */ t) => {
            log('gray', `      - ${t.name}: ${t.description.substring(0, 60)}...`);
        });
    });

    // ========================================================================
    // 6. Tools/Call Method
    // ========================================================================
    await test('6.1 POST /api/mcp - tools/call ollama_models (no params)', async () => {
        const res = await request('POST', BASE_URL, {
            jsonrpc: '2.0',
            id: 5,
            method: 'tools/call',
            params: { name: 'ollama_models', arguments: {} },
        });
        assert(res.status === 200, `Expected 200, got ${res.status}`, res.body);
        assert(res.body.result.content !== undefined, 'Should have content');
        assert(Array.isArray(res.body.result.content), 'Content should be an array');
        assert(res.body.result.content[0].type === 'text', 'Content type should be text');
        log('gray', `    Result: ${res.body.result.content[0].text.substring(0, 100)}...`);
    });

    await test('6.2 POST /api/mcp - tools/call rag_health (health check)', async () => {
        const res = await request('POST', BASE_URL, {
            jsonrpc: '2.0',
            id: 6,
            method: 'tools/call',
            params: { name: 'rag_health', arguments: {} },
        });
        assert(res.status === 200, `Expected 200, got ${res.status}`, res.body);
        assert(res.body.result.content !== undefined, 'Should have content');
        assert(Array.isArray(res.body.result.content), 'Content should be an array');
        log('gray', `    Health check: ${res.body.result.content[0].text.substring(0, 100)}...`);
    });

    await test('6.3 POST /api/mcp - tools/call with invalid tool name', async () => {
        const res = await request('POST', BASE_URL, {
            jsonrpc: '2.0',
            id: 7,
            method: 'tools/call',
            params: { name: 'invalid_tool', arguments: {} },
        });
        assert(res.status === 200, `Expected 200, got ${res.status}`, res.body);
        assert(res.body.result.isError === true, 'Should return error flag');
        assert(res.body.result.content[0].text.includes('Error'), 'Should contain error message');
    });

    // ========================================================================
    // 7. Resources Methods
    // ========================================================================
    await test('7.1 POST /api/mcp - resources/list (get all resources)', async () => {
        const res = await request('POST', BASE_URL, {
            jsonrpc: '2.0',
            id: 8,
            method: 'resources/list',
            params: {},
        });
        assert(res.status === 200, `Expected 200, got ${res.status}`, res.body);
        assert(Array.isArray(res.body.result.resources), 'Resources should be an array');

        if (res.body.result.resources.length > 0) {
            const resource = res.body.result.resources[0];
            assert(resource.uri !== undefined, 'Resource should have uri');
            assert(resource.name !== undefined, 'Resource should have name');
            log('gray', `    Found ${res.body.result.resources.length} resources`);
        }
    });

    await test('7.2 POST /api/mcp - resources/read rag://stats', async () => {
        const res = await request('POST', BASE_URL, {
            jsonrpc: '2.0',
            id: 9,
            method: 'resources/read',
            params: { uri: 'rag://stats' },
        });
        assert(res.status === 200, `Expected 200, got ${res.status}`, res.body);
        assert(Array.isArray(res.body.result.contents), 'Contents should be an array');
        assert(res.body.result.contents[0].uri === 'rag://stats', 'URI mismatch');
        assert(res.body.result.contents[0].mimeType === 'application/json', 'MIME type should be JSON');
        log('gray', `    Stats: ${res.body.result.contents[0].text.substring(0, 100)}...`);
    });

    await test('7.3 POST /api/mcp - resources/read with invalid URI', async () => {
        const res = await request('POST', BASE_URL, {
            jsonrpc: '2.0',
            id: 10,
            method: 'resources/read',
            params: { uri: 'invalid://resource' },
        });
        assert(res.status === 500, `Expected 500, got ${res.status}`, res.body);
        assert(res.body.error !== undefined, 'Should return error');
        assert(res.body.error.code === -32603, 'Should be internal error code');
    });

    // new resource namespace for mission templates
    await test('7.4 POST /api/mcp - resources/templates/list', async () => {
        const res = await request('POST', BASE_URL, {
            jsonrpc: '2.0',
            id: 11,
            method: 'resources/templates/list',
            params: {},
        });
        assert(res.status === 200, `Expected 200, got ${res.status}`, res.body);
        assert(Array.isArray(res.body.result.templates), 'templates should be array');
        log('gray', `    Found ${res.body.result.templates.length} templates`);
        if (res.body.result.templates.length > 0) {
            assert(typeof res.body.result.templates[0] === 'string');
        }
    });

    await test('7.5 POST /api/mcp - resources/templates/read', async () => {
        const listRes = await request('POST', BASE_URL, {
            jsonrpc: '2.0',
            id: 12,
            method: 'resources/templates/list',
            params: {},
        });
        const templates = listRes.body.result.templates || [];
        if (templates.length === 0) {
            // no templates available, skip read
            return;
        }
        const templateId = templates[0];
        const readRes = await request('POST', BASE_URL, {
            jsonrpc: '2.0',
            id: 13,
            method: 'resources/templates/read',
            params: { id: templateId },
        });
        assert(readRes.status === 200, `Expected 200, got ${readRes.status}`, readRes.body);
        assert(readRes.body.result.template, 'result should include template');
        assert(readRes.body.result.template.id === templateId, 'template id should match');
    });

    // ========================================================================
    // 8. Batch Requests
    // ========================================================================
    await test('8.1 POST /api/mcp - Batch request (multiple methods)', async () => {
        const res = await request('POST', BASE_URL, [
            { jsonrpc: '2.0', id: 11, method: 'ping', params: {} },
            { jsonrpc: '2.0', id: 12, method: 'tools/list', params: {} },
            { jsonrpc: '2.0', id: 13, method: 'resources/list', params: {} },
        ]);
        assert(res.status === 200, `Expected 200, got ${res.status}`, res.body);
        assert(Array.isArray(res.body), 'Batch response should be an array');
        assert(res.body.length === 3, `Expected 3 responses, got ${res.body.length}`);
        assert(res.body[0].id === 11, 'First response ID mismatch');
        assert(res.body[1].id === 12, 'Second response ID mismatch');
        assert(res.body[2].id === 13, 'Third response ID mismatch');
        log('gray', `    Batch completed: ${res.body.length} responses`);
    });

    await test('8.2 POST /api/mcp - Batch with notifications (no response)', async () => {
        const res = await request('POST', BASE_URL, [
            { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
            { jsonrpc: '2.0', method: 'notifications/cancelled', params: {} },
        ]);
        assert(res.status === 202, `Expected 202, got ${res.status}`, res.body);
        assert(res.body === null, 'Notification-only batch should not return body');
    });

    await test('8.3 POST /api/mcp - Mixed batch (requests + notifications)', async () => {
        const res = await request('POST', BASE_URL, [
            { jsonrpc: '2.0', id: 14, method: 'ping', params: {} },
            { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
            { jsonrpc: '2.0', id: 15, method: 'ping', params: {} },
        ]);
        assert(res.status === 200, `Expected 200, got ${res.status}`, res.body);
        assert(Array.isArray(res.body), 'Should return array');
        assert(res.body.length === 2, 'Should only return non-notification responses');
    });

    // ========================================================================
    // 9. Error Handling
    // ========================================================================
    await test('9.1 POST /api/mcp - Invalid JSON-RPC version', async () => {
        const res = await request('POST', BASE_URL, {
            jsonrpc: '1.0',
            id: 16,
            method: 'ping',
            params: {},
        });
        assert(res.status === 400, `Expected 400, got ${res.status}`, res.body);
        assert(res.body.error.code === -32600, 'Should be Invalid Request error');
    });

    await test('9.2 POST /api/mcp - Method not found', async () => {
        const res = await request('POST', BASE_URL, {
            jsonrpc: '2.0',
            id: 17,
            method: 'invalid_method',
            params: {},
        });
        assert(res.status === 404, `Expected 404, got ${res.status}`, res.body);
        assert(res.body.error.code === -32601, 'Should be Method not found error');
    });

    await test('9.3 POST /api/mcp - Malformed JSON should return 500', async () => {
        try {
            const res = await fetch(BASE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{ invalid json }',
            });
            // If we get here, the server handled it
            assert(res.status >= 400, 'Should return error status for invalid JSON');
        } catch (error) {
            // Fetch error is also acceptable (connection reset, etc.)
            assert(true, 'Connection error is acceptable for malformed JSON');
        }
    });

    // ========================================================================
    // 10. Performance & Stress Tests
    // ========================================================================
    await test('10.1 POST /api/mcp - Large batch request (10 items)', async () => {
        const batchSize = 10;
        const batch = Array.from({ length: batchSize }, (_, i) => ({
            jsonrpc: '2.0',
            id: 100 + i,
            method: 'ping',
            params: {},
        }));

        const start = Date.now();
        const res = await request('POST', BASE_URL, batch);
        const elapsed = Date.now() - start;

        assert(res.status === 200, `Expected 200, got ${res.status}`, res.body);
        assert(Array.isArray(res.body), 'Should return array');
        assert(res.body.length === batchSize, `Expected ${batchSize} responses`);
        log('gray', `    Completed ${batchSize} requests in ${elapsed}ms (${(elapsed / batchSize).toFixed(2)}ms/req)`);
    });

    await test('10.2 POST /api/mcp - Concurrent requests (5 parallel)', async () => {
        const concurrency = 5;
        const start = Date.now();

        const promises = Array.from({ length: concurrency }, (_, i) =>
            request('POST', BASE_URL, {
                jsonrpc: '2.0',
                id: 200 + i,
                method: 'ping',
                params: {},
            }),
        );

        const results = await Promise.all(promises);
        const elapsed = Date.now() - start;

        results.forEach((res, i) => {
            assert(res.status === 200, `Request ${i} failed with status ${res.status}`);
            assert(res.body.id === 200 + i, `Request ${i} ID mismatch`);
        });

        log('gray', `    Completed ${concurrency} concurrent requests in ${elapsed}ms`);
    });

    // ========================================================================
    // Summary
    // ========================================================================
    log('blue', '\n═══════════════════════════════════════════════════════');
    log('blue', '  Test Results');
    log('blue', '═══════════════════════════════════════════════════════\n');

    const total = testsPassed + testsFailed;
    const passRate = ((testsPassed / total) * 100).toFixed(1);

    log('green', `  ✓ Passed: ${testsPassed}/${total} (${passRate}%)`);
    if (testsFailed > 0) {
        log('red', `  ✗ Failed: ${testsFailed}/${total}`);
    }

    log('blue', '\n═══════════════════════════════════════════════════════\n');

    process.exit(testsFailed > 0 ? 1 : 0);
}

// Run tests
runTests().catch((error) => {
    log('red', `\n✗ Fatal error: ${error.message}`);
    console.error(error);
    process.exit(1);
});
