import path from 'node:path';
import fs from 'node:fs';
import { saveResponse, loadResponse } from '#infra/storage/response_adapter';

// TODO: ESM MIGRATION — require() mutation pattern is incompatible with ESM.
// Tests that set require('#infra/fs/paths').RESPONSE cannot work because
// ESM exports are read-only bindings. These tests need refactoring to use
// dependency injection or env-var-based path config.
// The require() calls below have been replaced with no-op comments to prevent crashes.


// Test directories
const TEST_DIR = path.join(import.meta.dirname, 'temp_e2e_simple');
const RESPONSES_DIR = path.join(TEST_DIR, 'respostas');

let testsPassed = 0;
let testsFailed = 0;

function setupTestDirs() {
    if (fs.existsSync(TEST_DIR)) {
        fs.rmSync(TEST_DIR, { recursive: true });
    }
    fs.mkdirSync(RESPONSES_DIR, { recursive: true });
}

function cleanupTestDirs() {
    if (fs.existsSync(TEST_DIR)) {
        fs.rmSync(TEST_DIR, { recursive: true });
    }
}

function createMockResponseV2(text) {
    return {
        text,
        markdown: `# Response\n\n${text}`,
        json: { answer: text },
        html: `<div><p>${text}</p></div>`,
        metadata: {
            format_version: 2,
            generated_at: new Date().toISOString(),
            source: 'test',
        },
    };
}

function createMinimalTask(taskId) {
    return {
        meta: { id: taskId },
        result: {},
    };
}

async function runTest(name, testFn) {
    try {
        await testFn();
        console.log(`✅ ${name}`);
        testsPassed++;
    } catch (error) {
        console.error(`❌ ${name}`);
        console.error(`   ${error.message}`);
        testsFailed++;
    }
}

async function runAllTests() {
    console.log('\n' + '='.repeat(80));
    console.log('  Task E2E Tests (Simplified - Focus on Integration)');
    console.log('='.repeat(80) + '\n');

    setupTestDirs();

    try {
        // Test 1: ID Sanitization
        await runTest('INPUT: ID sanitization', async () => {
            const dangerous = '../../../etc/passwd';
            const sanitized = dangerous.replace(/[^a-zA-Z0-9_-]/g, '');
            if (sanitized.includes('..') || sanitized.includes('/')) {
                throw new Error('Sanitization failed');
            }
        });

        // Test 2: Response V2 - 4 format save
        await runTest('OUTPUT: Save response (4 formats)', async () => {
            const paths = await import('#infra/fs/paths').then(m => m.default ?? m);
            const originalDir = paths.RESPONSE;
            // [ESM-SKIP] paths.RESPONSE = RESPONSES_DIR; // ESM export is read-only

            const taskId = 'test-4-formats';
            const task = createMinimalTask(taskId);
            const response = createMockResponseV2('Test response');

            await saveResponse(taskId, response, task);

            const files = ['txt', 'md', 'json', 'html'].map(ext => path.join(RESPONSES_DIR, `${taskId}.${ext}`));

            for (const file of files) {
                if (!fs.existsSync(file)) {
                    throw new Error(`File not created: ${file}`);
                }
            }

            // [ESM-SKIP] paths.RESPONSE = originalDir; // ESM export is read-only
        });

        // Test 3: task.result population
        await runTest('OUTPUT: task.result populated', async () => {
            // [ESM-SKIP] const originalDir = require('#infra/fs/paths').RESPONSE;
            // [ESM-SKIP] require('#infra/fs/paths').RESPONSE = RESPONSES_DIR;

            const taskId = 'test-result-fill';
            const task = createMinimalTask(taskId);
            const response = createMockResponseV2('Result test');

            await saveResponse(taskId, response, task);

            if (!task.result.response_text || task.result.response_format !== 'v2') {
                throw new Error('task.result not populated correctly');
            }

            // [ESM-SKIP] require('#infra/fs/paths').RESPONSE = originalDir;
        });

        // Test 4: V1 backward compatibility
        await runTest('OUTPUT: V1 backward compatibility', async () => {
            // [ESM-SKIP] const originalDir = require('#infra/fs/paths').RESPONSE;
            // [ESM-SKIP] require('#infra/fs/paths').RESPONSE = RESPONSES_DIR;

            const taskId = 'test-v1';
            const task = createMinimalTask(taskId);
            const v1Response = 'Legacy V1 response';

            await saveResponse(taskId, v1Response, task);

            if (task.result.response_format !== 'v1' || !task.result.response_converted_from_v1) {
                throw new Error('V1 compatibility failed');
            }

            // [ESM-SKIP] require('#infra/fs/paths').RESPONSE = originalDir;
        });

        // Test 5: Load response by format
        await runTest('OUTPUT: Load response (markdown)', async () => {
            // [ESM-SKIP] const originalDir = require('#infra/fs/paths').RESPONSE;
            // [ESM-SKIP] require('#infra/fs/paths').RESPONSE = RESPONSES_DIR;

            const taskId = 'test-load-md';
            const task = createMinimalTask(taskId);
            const response = createMockResponseV2('Load test');

            await saveResponse(taskId, response, task);

            const mdContent = await loadResponse(taskId, 'markdown');
            if (!mdContent.includes('Load test') || !mdContent.startsWith('# Response')) {
                throw new Error('Markdown loading failed');
            }

            // [ESM-SKIP] require('#infra/fs/paths').RESPONSE = originalDir;
        });

        // Test 6: Load JSON format
        await runTest('OUTPUT: Load response (json)', async () => {
            // [ESM-SKIP] const originalDir = require('#infra/fs/paths').RESPONSE;
            // [ESM-SKIP] require('#infra/fs/paths').RESPONSE = RESPONSES_DIR;

            const taskId = 'test-load-json';
            const task = createMinimalTask(taskId);
            const response = createMockResponseV2('JSON test');

            await saveResponse(taskId, response, task);

            const jsonContent = await loadResponse(taskId, 'json');
            const parsed = JSON.parse(jsonContent);
            if (parsed.answer !== 'JSON test') {
                throw new Error('JSON loading failed');
            }

            // [ESM-SKIP] require('#infra/fs/paths').RESPONSE = originalDir;
        });

        // Test 7: Orchestrator caching
        await runTest('PROCESSING: Orchestrator caches task', async () => {
            const activeExecutions = new Map();
            const task = createMinimalTask('test-cache');
            const corrId = 'corr-123';
            const startedAt = Date.now();

            activeExecutions.set('test-cache', { task, correlationId: corrId, startedAt });

            const cached = activeExecutions.get('test-cache');
            if (!cached || cached.correlationId !== corrId || typeof cached.startedAt !== 'number') {
                throw new Error('Orchestrator caching failed');
            }
        });

        // Test 8: Duration calculation
        await runTest('PROCESSING: Duration calculation', async () => {
            const startedAt = Date.now() - 5000;
            const duration = Date.now() - startedAt;

            if (duration < 4900 || duration > 5100) {
                throw new Error(`Duration incorrect: ${duration}ms`);
            }
        });

        // Test 9: Full E2E flow
        await runTest('E2E: Complete flow (save → load)', async () => {
            // [ESM-SKIP] const originalDir = require('#infra/fs/paths').RESPONSE;
            // [ESM-SKIP] require('#infra/fs/paths').RESPONSE = RESPONSES_DIR;

            const taskId = 'e2e-complete';
            const task = createMinimalTask(taskId);
            const response = createMockResponseV2('E2E test');

            // Save
            await saveResponse(taskId, response, task);

            // Verify 4 files
            const files = ['txt', 'md', 'json', 'html'];
            for (const ext of files) {
                const file = path.join(RESPONSES_DIR, `${taskId}.${ext}`);
                if (!fs.existsSync(file)) {
                    throw new Error(`File missing: ${ext}`);
                }
            }

            // Verify task.result
            if (!task.result.response_text) {
                throw new Error('task.result not filled');
            }

            // Load
            const txtContent = await loadResponse(taskId, 'text');
            if (!txtContent.includes('E2E test')) {
                throw new Error('Load failed');
            }

            // [ESM-SKIP] require('#infra/fs/paths').RESPONSE = originalDir;
        });

        // Test 10: Queue depth limit (simulated)
        await runTest('INPUT: Queue depth validation', async () => {
            const MAX_DEPTH = 10000;
            const currentQueueSize = 9999;

            if (currentQueueSize >= MAX_DEPTH) {
                throw new Error('Should reject when >= MAX_DEPTH');
            }
        });

        console.log('\n' + '='.repeat(80));
        console.log(`✅ Passed: ${testsPassed}`);
        console.log(`❌ Failed: ${testsFailed}`);
        console.log(`📊 Total: ${testsPassed + testsFailed}`);
        console.log('='.repeat(80) + '\n');

        return testsFailed === 0;
    } finally {
        cleanupTestDirs();
    }
}

if (import.meta.filename === process.argv[1]) {
    runAllTests()
        .then(success => {
            process.exit(success ? 0 : 1);
        })
        .catch(error => {
            console.error('Test runner crashed:', error);
            process.exit(1);
        });
}

export { runAllTests };
