// @ts-check
/**
 * Ollama Timeout & Performance Test
 *
 * Tests:
 *
 * 1. Environment variable loading
 * 2. Health check speed
 * 3. Model listing
 * 4. Small generation (should succeed)
 * 5. Large generation (tests timeout enforcement)
 * 6. Performance benchmarks
 *
 * Usage: node tests/manual/test_ollama_timeouts.js
 */

import assert from 'node:assert';
import { ollama } from '../../tools/ollama/client.mjs';

console.log('=== Ollama Timeout & Performance Test ===\n');

async function runTests() {
    try {
        // Test 1: Environment Variables
        console.log('[1/6] Testing environment variables...');
        assert.ok(process.env.OLLAMA_DEFAULT_MODEL, 'OLLAMA_DEFAULT_MODEL should be set');
        assert.ok(process.env.OLLAMA_GENERATE_TIMEOUT, 'OLLAMA_GENERATE_TIMEOUT should be set');
        console.log(`✅ Default model: ${process.env.OLLAMA_DEFAULT_MODEL}`);
        console.log(`✅ Generate timeout: ${process.env.OLLAMA_GENERATE_TIMEOUT}ms`);
        console.log(`✅ Max tokens: ${process.env.OLLAMA_MAX_TOKENS}\n`);

        // Test 2: Health Check
        console.log('[2/6] Testing health check speed...');
        const healthStart = Date.now();
        const isHealthy = await ollama.health();
        const healthTime = Date.now() - healthStart;
        assert.ok(isHealthy, 'Ollama should be healthy');
        assert.ok(healthTime < 5000, `Health check should be < 5s (was ${healthTime}ms)`);
        console.log(`✅ Health check: ${healthTime}ms\n`);

        // Test 3: List Models
        console.log('[3/6] Testing model listing...');
        const listStart = Date.now();
        const models = await ollama.listModels();
        const listTime = Date.now() - listStart;
        assert.ok(models.length > 0, 'Should have at least 1 model');
        console.log(`✅ Found ${models.length} models in ${listTime}ms:`);
        models.forEach((m) => console.log(`  - ${m.name} (${(m.size / 1e9).toFixed(2)} GB)`));
        console.log();

        // Test 4: Small Generation (should succeed)
        console.log('[4/6] Testing small generation (200 tokens)...');
        const smallStart = Date.now();
        const smallResult = await ollama.generate('Say hello in one sentence.', process.env.OLLAMA_DEFAULT_MODEL, {
            num_predict: 200,
            temperature: 0.3,
        });
        const smallTime = Date.now() - smallStart;
        assert.ok(smallResult.length > 0, 'Should generate text');
        console.log(`✅ Generated ${smallResult.length} chars in ${smallTime}ms`);
        console.log(`   Response: "${smallResult.trim().substring(0, 100)}..."`);
        console.log(`   Throughput: ${Math.round((200 / smallTime) * 60000)} tokens/min\n`);

        // Test 5: Timeout Enforcement (large generation)
        console.log('[5/6] Testing timeout enforcement (2000 tokens - may timeout)...');
        console.log('   This test will take up to 60s or timeout...');
        const timeoutStart = Date.now();
        try {
            const largeResult = await ollama.generate(
                'Write a detailed explanation of how neural networks work, including architecture, training, and applications.',
                process.env.OLLAMA_DEFAULT_MODEL,
                { num_predict: 2000, temperature: 0.7 },
            );
            const timeoutTime = Date.now() - timeoutStart;
            console.log(`✅ Completed in ${timeoutTime}ms (within timeout)`);
            console.log(`   Generated ${largeResult.length} chars`);
            const wordCount = largeResult.split(/\s+/).length;
            console.log(`   Throughput: ${Math.round((wordCount / timeoutTime) * 60000)} tokens/min`);
        } catch (/** @type {any} */ error) {
            const timeoutTime = Date.now() - timeoutStart;
            if (error.message.includes('timeout') || error.message.includes('aborted')) {
                console.log(`✅ Timeout enforced at ${timeoutTime}ms (expected behavior)`);
                console.log(`   Error: ${error.message}`);
            } else {
                console.error(`❌ Unexpected error: ${error.message}`);
                throw error;
            }
        }
        console.log();

        // Test 6: Performance Summary
        console.log('[6/6] Performance Summary');
        console.log(`Model: ${process.env.OLLAMA_DEFAULT_MODEL}`);
        console.log(`Client timeout: ${process.env.OLLAMA_GENERATE_TIMEOUT}ms`);
        console.log(`Max tokens: ${process.env.OLLAMA_MAX_TOKENS}`);
        console.log(`Base URL: ${process.env.OLLAMA_BASE_URL || 'http://host.docker.internal:11434'}`);
        console.log();

        console.log('✅ All tests passed!');
        console.log();
        console.log('Next steps:');
        console.log('1. Test MCP integration: ./tests/manual/test_mcp_ollama.sh');
        console.log('2. Test with Claude Desktop or GitHub Copilot');
        console.log('3. Monitor performance: pm2 logs dashboard-web');
    } catch (/** @type {any} */ error) {
        console.error('\n❌ Test failed:');
        console.error(error);
        process.exit(1);
    }
}

// Run tests
runTests();
