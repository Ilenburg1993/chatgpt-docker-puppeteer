/**
 * Integration test for OpenAI-compatible API
 *
 * Tests end-to-end flow: HTTP → Handler → Ollama → Response
 *
 * Prerequisites:
 *
 * - Server running: npx pm2 start ecosystem.config.cjs --only dashboard-web
 * - OPENAI_COMPATIBLE_ENABLED=true in .env.local
 * - Ollama Cloud configured with API key
 *
 * Run: node test-openai-compat.mjs
 */

console.log('🧪 Testing OpenAI-Compatible API\n');
console.log('Prerequisites:');
console.log('  - Server: npx pm2 start ecosystem.config.cjs --only dashboard-web');
console.log('  - Config: OPENAI_COMPATIBLE_ENABLED=true in .env.local\n');

const BASE_URL = 'http://localhost:3008/v1';
let passedTests = 0;
let totalTests = 0;

/**
 * Test helper
 */
async function runTest(name, testFn) {
    totalTests++;
    process.stdout.write(`▶ ${totalTests}. ${name}... `);

    try {
        await testFn();
        passedTests++;
        console.log('✅ PASSED');
        return true;
    } catch (error) {
        console.log('❌ FAILED');
        console.error(`   Error: ${error.message}`);
        return false;
    }
}

// ============================================================================
// Test Suite
// ============================================================================

// Test 1: Chat Completions (basic)
await runTest('POST /v1/chat/completions (basic request)', async () => {
    const req = {
        model: 'qwen3-coder-next',
        messages: [{ role: 'user', content: 'Say "test successful" in exactly 2 words' }],
        temperature: 0.3,
        max_tokens: 50,
    };

    const resp = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
    });

    if (!resp.ok) {
        const error = await resp.json().catch(() => ({ error: { message: 'Unknown' } }));
        throw new Error(`HTTP ${resp.status}: ${error.error?.message || resp.statusText}`);
    }

    const data = await resp.json();

    // Validate response structure
    if (!data.id || !data.id.startsWith('chatcmpl-')) {
        throw new Error(`Invalid id: ${data.id}`);
    }
    if (data.object !== 'chat.completion') {
        throw new Error(`Invalid object: ${data.object}`);
    }
    if (!data.choices || data.choices.length !== 1) {
        throw new Error('Invalid choices array');
    }
    if (!data.choices[0].message?.content) {
        throw new Error('Missing message content');
    }
    if (data.choices[0].finish_reason !== 'stop') {
        throw new Error(`Invalid finish_reason: ${data.choices[0].finish_reason}`);
    }
    if (!data.usage || typeof data.usage.total_tokens !== 'number') {
        throw new Error('Invalid usage data');
    }

    console.log(`\n   Response: "${data.choices[0].message.content.substring(0, 50)}..."`);
    console.log(`   Tokens: ${data.usage.total_tokens} (${data.usage.prompt_tokens}+${data.usage.completion_tokens})`);
});

// Test 2: Multi-turn conversation
await runTest('POST /v1/chat/completions (multi-turn)', async () => {
    const req = {
        model: 'qwen3-coder-next',
        messages: [
            { role: 'system', content: 'You are a helpful assistant' },
            { role: 'user', content: 'What is 2+2?' },
            { role: 'assistant', content: '4' },
            { role: 'user', content: 'What about 3+3?' },
        ],
        temperature: 0.3,
        max_tokens: 50,
    };

    const resp = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
    });

    if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
    }

    const data = await resp.json();
    if (!data.choices[0].message.content.includes('6')) {
        throw new Error('Model did not answer correctly');
    }
});

// Test 3: List Models
await runTest('GET /v1/models', async () => {
    const resp = await fetch(`${BASE_URL}/models`);

    if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
    }

    const data = await resp.json();

    if (data.object !== 'list') {
        throw new Error(`Invalid object: ${data.object}`);
    }
    if (!Array.isArray(data.data) || data.data.length === 0) {
        throw new Error('No models returned');
    }
    if (!data.data.some((m) => m.id === 'qwen3-coder-next')) {
        throw new Error('qwen3-coder-next not in model list');
    }

    console.log(`\n   Models: ${data.data.map((m) => m.id).join(', ')}`);
});

// Test 4: Error handling (empty messages)
await runTest('Error Handling (empty messages)', async () => {
    const req = { messages: [] };

    const resp = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
    });

    if (resp.status !== 400) {
        throw new Error(`Expected 400, got ${resp.status}`);
    }

    const data = await resp.json();
    if (!data.error || !data.error.message) {
        throw new Error('Error response missing error object');
    }
    if (!data.error.message.includes('messages')) {
        throw new Error(`Unexpected error message: ${data.error.message}`);
    }

    console.log(`\n   Error: ${data.error.message}`);
});

// Test 5: Error handling (vision content)
await runTest('Error Handling (vision content)', async () => {
    const req = {
        model: 'qwen3-coder-next',
        messages: [
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'What is in this image?' },
                    { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
                ],
            },
        ],
    };

    const resp = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
    });

    if (resp.status !== 400) {
        throw new Error(`Expected 400, got ${resp.status}`);
    }

    const data = await resp.json();
    if (!data.error.message.toLowerCase().includes('vision')) {
        throw new Error(`Unexpected error message: ${data.error.message}`);
    }

    console.log(`\n   Error: ${data.error.message}`);
});

// Test 6: Error handling (n > 1)
await runTest('Error Handling (n > 1)', async () => {
    const req = {
        model: 'qwen3-coder-next',
        messages: [{ role: 'user', content: 'Hello' }],
        n: 3,
    };

    const resp = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
    });

    if (resp.status !== 400) {
        throw new Error(`Expected 400, got ${resp.status}`);
    }

    const data = await resp.json();
    if (!data.error.message.includes('Multiple completions')) {
        throw new Error(`Unexpected error message: ${data.error.message}`);
    }

    console.log(`\n   Error: ${data.error.message}`);
});

// ============================================================================
// Results
// ============================================================================

console.log('\n═══════════════════════════════════════════════════════');
console.log(`  Test Results: ${passedTests}/${totalTests} passed`);
console.log('═══════════════════════════════════════════════════════');

if (passedTests === totalTests) {
    console.log('✅ All tests PASSED\n');
    process.exit(0);
} else {
    console.log(`❌ ${totalTests - passedTests} test(s) FAILED\n`);
    process.exit(1);
}
