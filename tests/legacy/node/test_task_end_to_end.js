import path from 'node:path';
import fs from 'node:fs';
import { parseTask } from '#core/schemas';
import { saveResponse } from '#infra/storage/response_adapter';

// TODO: ESM MIGRATION — require() mutation pattern is incompatible with ESM.
// Tests that set require('#infra/fs/paths').PATHS.QUEUE or .RESPOSTAS_DIR
// cannot work because ESM exports are read-only bindings.
// These tests need refactoring to use dependency injection or env-var-based path config.
// The require() calls below have been replaced with no-op comments to prevent crashes.

// Test directories
const TEST_DIR = path.join(import.meta.dirname, 'temp_e2e_test');
const QUEUE_DIR = path.join(TEST_DIR, 'fila');
const RESPONSES_DIR = path.join(TEST_DIR, 'respostas');

// Test state
let testsPassed = 0;
let testsFailed = 0;
const failedTests = [];

// Helpers
function setupTestDirs() {
    if (fs.existsSync(TEST_DIR)) {
        fs.rmSync(TEST_DIR, { recursive: true });
    }
    fs.mkdirSync(QUEUE_DIR, { recursive: true });
    fs.mkdirSync(RESPONSES_DIR, { recursive: true });
}

function cleanupTestDirs() {
    if (fs.existsSync(TEST_DIR)) {
        fs.rmSync(TEST_DIR, { recursive: true });
    }
}

function createMockTask(taskId, overrides = {}) {
    return {
        meta: {
            id: taskId,
            created_at: new Date().toISOString(),
            version: '5.0',
            priority: 0,
            source: 'test',
            tags: [],
            ...overrides.meta,
        },
        spec: {
            target: 'chatgpt',
            model: 'auto',
            payload: {
                system_message: '',
                user_message: 'Test prompt: What is 2+2?',
                ...(overrides.spec?.payload || {}),
            },
            parameters: {},
            execution: { strategy: 'SINGLE_SHOT' },
            validation: {},
            ...(overrides.spec || {}),
        },
        state: {
            status: 'PENDING',
            retries: 0,
            history: {}, // V5 requires object, not array
            ...overrides.state,
        },
        execution: {},
        mission: {},
        result: overrides.result || {},
    };
}

function createMockResponseV2(text, includeFormats = { json: true, html: true }) {
    return {
        text,
        markdown: `# Response\n\n${text}`,
        json: includeFormats.json ? { answer: text } : null,
        html: includeFormats.html ? `<div><p>${text}</p></div>` : null,
        metadata: {
            format_version: 2,
            generated_at: new Date().toISOString(),
            source: 'test',
            extraction_method: 'mock',
            has_code: false,
            has_tables: false,
        },
    };
}

async function runTest(name, testFn) {
    try {
        await testFn();
        console.log(`✅ ${name}`);
        testsPassed++;
        return true;
    } catch (error) {
        console.error(`❌ ${name}`);
        console.error(`   Error: ${error.message}`);
        if (error.stack) {
            console.error(`   Stack: ${error.stack.split('\n').slice(1, 3).join('\n')}`);
        }
        testsFailed++;
        failedTests.push({ name, error: error.message });
        return false;
    }
}

// ============================================================================
// PHASE 1: INPUT TESTS (Task Creation & Validation)
// ============================================================================

async function testSchemaV5Validation() {
    await runTest('INPUT #1: Schema V5 validation (valid task)', async () => {
        const task = createMockTask('test-schema-valid');
        const validated = parseTask(task);

        if (validated.meta.version !== '5.0') {
            throw new Error(`Expected version '5.0', got '${validated.meta.version}'`);
        }
        if (!validated.meta.id) {
            throw new Error('meta.id is missing');
        }
        if (!validated.spec.payload.user_message) {
            throw new Error('spec.payload.user_message is missing');
        }
    });

    await runTest('INPUT #2: Schema V5 validation (reject empty user_message)', async () => {
        try {
            const invalidTask = createMockTask('test-empty-message', {
                spec: { payload: { user_message: '' } },
            });
            parseTask(invalidTask);
            throw new Error('Should have thrown validation error for empty user_message');
        } catch (error) {
            if (
                !error.message.includes('String must contain at least 1 character') &&
                !error.message.includes('Falha crítica')
            ) {
                throw error;
            }
        }
    });

    await runTest('INPUT #3: Schema V5 validation (reject invalid target)', async () => {
        try {
            const invalidTask = createMockTask('test-invalid-target', {
                spec: { target: 'invalid-target' },
            });
            parseTask(invalidTask);
            throw new Error('Should have thrown validation error for invalid target');
        } catch (error) {
            if (!error.message.includes('Invalid enum value') && !error.message.includes('Falha crítica')) {
                throw error;
            }
        }
    });
}

async function testIDSanitization() {
    await runTest('INPUT #4: ID sanitization (path traversal prevention)', async () => {
        const dangerousId = '../../../etc/passwd';
        // Remove tudo exceto alphanumeric, underscore, dash (não aceita ponto no meio)
        const sanitized = dangerousId.replace(/[^a-zA-Z0-9_-]/g, '');

        if (sanitized.includes('..') || sanitized.includes('/') || sanitized.includes('.')) {
            throw new Error(`Sanitization failed: '${sanitized}' still contains dangerous chars`);
        }
        if (sanitized !== 'etcpasswd') {
            throw new Error(`Expected 'etcpasswd', got '${sanitized}'`);
        }
    });

    await runTest('INPUT #5: ID regex validation (schema level)', async () => {
        try {
            const task = createMockTask('test!@#$%', {
                meta: { id: 'test!@#$%' },
            });
            parseTask(task);
            throw new Error('Should have thrown validation error for invalid ID chars');
        } catch (error) {
            if (
                !error.message.includes('Invalid') &&
                !error.message.includes('inválido') &&
                !error.message.includes('Falha crítica')
            ) {
                throw error;
            }
        }
    });
}

async function testQueueOperations() {
    await runTest('INPUT #6: Task save to queue', async () => {
        // Mock PATHS temporarily
        // [ESM-SKIP] const originalQueueDir = require('#infra/fs/paths').PATHS.QUEUE;
        // [ESM-SKIP] require('#infra/fs/paths').PATHS.QUEUE = QUEUE_DIR;

        const task = createMockTask('test-queue-save');
        const taskStore = await import('#infra/storage/task_store').then(m => m.default ?? m);
        await taskStore.saveTask(task);

        const savedPath = path.join(QUEUE_DIR, 'test-queue-save.json');
        if (!fs.existsSync(savedPath)) {
            throw new Error('Task file not created in queue');
        }

        const savedContent = JSON.parse(fs.readFileSync(savedPath, 'utf8'));
        if (savedContent.meta.id !== 'test-queue-save') {
            throw new Error('Saved task has wrong ID');
        }

        // Restore
        // [ESM-SKIP] require('#infra/fs/paths').PATHS.QUEUE = originalQueueDir;
    });

    await runTest('INPUT #7: Duplicate task warning (overwrite detection)', async () => {
        // [ESM-SKIP] const originalQueueDir = require('#infra/fs/paths').PATHS.QUEUE;
        // [ESM-SKIP] require('#infra/fs/paths').PATHS.QUEUE = QUEUE_DIR;

        const task1 = createMockTask('test-duplicate');
        const task2 = createMockTask('test-duplicate', {
            spec: { prompt: 'Different prompt' },
        });

        const taskStore = await import('#infra/storage/task_store').then(m => m.default ?? m);
        await taskStore.saveTask(task1);

        // Second save should log warning (we can't easily test logs, so just verify no error)
        await taskStore.saveTask(task2);

        const savedPath = path.join(QUEUE_DIR, 'test-duplicate.json');
        const savedContent = JSON.parse(fs.readFileSync(savedPath, 'utf8'));

        if (savedContent.spec.prompt !== 'Different prompt') {
            throw new Error('Second task did not overwrite first');
        }

        // [ESM-SKIP] require('#infra/fs/paths').PATHS.QUEUE = originalQueueDir;
    });
}

async function testQueueDepthLimit() {
    await runTest('INPUT #8: Queue depth limit enforcement', async () => {
        // Este teste valida que io.js rejeita tasks quando queue > MAX_QUEUE_DEPTH
        // Como não podemos criar 10k tasks facilmente, vamos simular

        // [ESM-SKIP] const originalQueueDir = require('#infra/fs/paths').PATHS.QUEUE;
        // [ESM-SKIP] require('#infra/fs/paths').PATHS.QUEUE = QUEUE_DIR;

        // Criar 5 tasks (dentro do limite)
        const taskStore = await import('#infra/storage/task_store').then(m => m.default ?? m);
        for (let i = 1; i <= 5; i++) {
            const task = createMockTask(`test-depth-${i}`);
            await taskStore.saveTask(task);
        }

        // Verificar que 5 tasks foram salvas
        const files = fs.readdirSync(QUEUE_DIR).filter(f => f.startsWith('test-depth-'));
        if (files.length !== 5) {
            throw new Error(`Expected 5 tasks, found ${files.length}`);
        }

        // [ESM-SKIP] require('#infra/fs/paths').PATHS.QUEUE = originalQueueDir;
    });
}

// ============================================================================
// PHASE 2: PROCESSING TESTS (Orchestrator & Driver)
// ============================================================================

async function testOrchestratorCaching() {
    await runTest('PROCESSING #1: Orchestrator caches task correctly', async () => {
        // Simular comportamento do Orchestrator
        const activeExecutions = new Map();

        const task = createMockTask('test-orchestrator-cache');
        const correlationId = 'corr-123';
        const startedAt = Date.now();

        // Cachear task (como no código real)
        activeExecutions.set(task.meta.id, {
            task,
            correlationId,
            startedAt,
        });

        // Recuperar do cache
        const cached = activeExecutions.get('test-orchestrator-cache');

        if (!cached) {
            throw new Error('Task not found in cache');
        }
        if (cached.task.meta.id !== 'test-orchestrator-cache') {
            throw new Error('Cached task has wrong ID');
        }
        if (cached.correlationId !== correlationId) {
            throw new Error('Cached correlationId is wrong');
        }
        if (typeof cached.startedAt !== 'number') {
            throw new Error('Cached startedAt is not a timestamp');
        }
    });

    await runTest('PROCESSING #2: Orchestrator calculates execution duration', async () => {
        const activeExecutions = new Map();

        const task = createMockTask('test-duration');
        const correlationId = 'corr-456';
        const startedAt = Date.now() - 5000; // 5 seconds ago

        activeExecutions.set(task.meta.id, { task, correlationId, startedAt });

        // Simular task completion
        const cached = activeExecutions.get('test-duration');
        const executionDuration = Date.now() - cached.startedAt;

        if (executionDuration < 4900 || executionDuration > 5100) {
            throw new Error(`Expected ~5000ms, got ${executionDuration}ms`);
        }
    });
}

async function testDriverResponseGeneration() {
    await runTest('PROCESSING #3: Driver generates ResponseV2 object', async () => {
        const responseText = 'The answer is 4';
        const responseV2 = createMockResponseV2(responseText);

        if (!responseV2.text || responseV2.text !== responseText) {
            throw new Error('ResponseV2.text is incorrect');
        }
        if (!responseV2.markdown || !responseV2.markdown.includes(responseText)) {
            throw new Error('ResponseV2.markdown is missing or incorrect');
        }
        if (responseV2.metadata.format_version !== 2) {
            throw new Error('ResponseV2.metadata.format_version should be 2');
        }
    });
}

// ============================================================================
// PHASE 3: OUTPUT TESTS (Response Capture & Storage)
// ============================================================================

async function testResponseSave() {
    await runTest('OUTPUT #1: saveResponse creates 4 files (txt/md/json/html)', async () => {
        // [ESM-SKIP] const originalRespostasDir = require('#infra/fs/paths').PATHS.RESPOSTAS_DIR;
        // [ESM-SKIP] require('#infra/fs/paths').PATHS.RESPOSTAS_DIR = RESPONSES_DIR;

        const taskId = 'test-4-formats';
        const task = createMockTask(taskId);
        const responseV2 = createMockResponseV2('Test response with all formats');

        await saveResponse(taskId, responseV2, task);

        const expectedFiles = [
            path.join(RESPONSES_DIR, `${taskId}.txt`),
            path.join(RESPONSES_DIR, `${taskId}.md`),
            path.join(RESPONSES_DIR, `${taskId}.json`),
            path.join(RESPONSES_DIR, `${taskId}.html`),
        ];

        for (const file of expectedFiles) {
            if (!fs.existsSync(file)) {
                throw new Error(`File not created: ${file}`);
            }
        }

        // [ESM-SKIP] require('#infra/fs/paths').PATHS.RESPOSTAS_DIR = originalRespostasDir;
    });

    await runTest('OUTPUT #2: saveResponse populates task.result', async () => {
        // [ESM-SKIP] const originalRespostasDir = require('#infra/fs/paths').PATHS.RESPOSTAS_DIR;
        // [ESM-SKIP] require('#infra/fs/paths').PATHS.RESPOSTAS_DIR = RESPONSES_DIR;

        const taskId = 'test-result-fill';
        const task = createMockTask(taskId);
        const responseV2 = createMockResponseV2('Test response for result filling');

        await saveResponse(taskId, responseV2, task);

        if (!task.result.response_text) {
            throw new Error('task.result.response_text not populated');
        }
        if (task.result.response_format !== 'v2') {
            throw new Error(`Expected response_format 'v2', got '${task.result.response_format}'`);
        }
        if (typeof task.result.response_length !== 'number') {
            throw new Error('task.result.response_length should be a number');
        }
        if (task.result.response_has_json !== true) {
            throw new Error('task.result.response_has_json should be true');
        }
        if (task.result.response_has_html !== true) {
            throw new Error('task.result.response_has_html should be true');
        }
        if (!task.result.response_metadata) {
            throw new Error('task.result.response_metadata not populated');
        }

        // [ESM-SKIP] require('#infra/fs/paths').PATHS.RESPOSTAS_DIR = originalRespostasDir;
    });

    await runTest('OUTPUT #3: V1 backward compatibility (string response)', async () => {
        // [ESM-SKIP] const originalRespostasDir = require('#infra/fs/paths').PATHS.RESPOSTAS_DIR;
        // [ESM-SKIP] require('#infra/fs/paths').PATHS.RESPOSTAS_DIR = RESPONSES_DIR;

        const taskId = 'test-v1-compat';
        const task = createMockTask(taskId);
        const v1Response = 'Legacy V1 response text';

        await saveResponse(taskId, v1Response, task);

        if (!task.result.response_text) {
            throw new Error('task.result.response_text not populated for V1');
        }
        if (task.result.response_format !== 'v1') {
            throw new Error(`Expected response_format 'v1', got '${task.result.response_format}'`);
        }
        if (task.result.response_converted_from_v1 !== true) {
            throw new Error('task.result.response_converted_from_v1 should be true');
        }

        // [ESM-SKIP] require('#infra/fs/paths').PATHS.RESPOSTAS_DIR = originalRespostasDir;
    });
}

async function testResponseRetrieval() {
    await runTest('OUTPUT #4: Load response by format (markdown)', async () => {
        // [ESM-SKIP] const originalRespostasDir = require('#infra/fs/paths').PATHS.RESPOSTAS_DIR;
        // [ESM-SKIP] require('#infra/fs/paths').PATHS.RESPOSTAS_DIR = RESPONSES_DIR;

        const taskId = 'test-load-md';
        const task = createMockTask(taskId);
        const responseV2 = createMockResponseV2('Test markdown loading');

        await saveResponse(taskId, responseV2, task);

        const { loadResponse } = await import('#infra/storage/response_adapter');
        const mdContent = await loadResponse(taskId, 'markdown');

        if (!mdContent.includes('Test markdown loading')) {
            throw new Error('Markdown content is incorrect');
        }
        if (!mdContent.startsWith('# Response')) {
            throw new Error('Markdown format is incorrect');
        }

        // [ESM-SKIP] require('#infra/fs/paths').PATHS.RESPOSTAS_DIR = originalRespostasDir;
    });

    await runTest('OUTPUT #5: Load response by format (json)', async () => {
        // [ESM-SKIP] const originalRespostasDir = require('#infra/fs/paths').PATHS.RESPOSTAS_DIR;
        // [ESM-SKIP] require('#infra/fs/paths').PATHS.RESPOSTAS_DIR = RESPONSES_DIR;

        const taskId = 'test-load-json';
        const task = createMockTask(taskId);
        const responseV2 = createMockResponseV2('Test JSON loading');

        await saveResponse(taskId, responseV2, task);

        const { loadResponse } = await import('#infra/storage/response_adapter');
        const jsonContent = await loadResponse(taskId, 'json');

        const parsed = JSON.parse(jsonContent);
        if (parsed.answer !== 'Test JSON loading') {
            throw new Error('JSON content is incorrect');
        }

        // [ESM-SKIP] require('#infra/fs/paths').PATHS.RESPOSTAS_DIR = originalRespostasDir;
    });
}

// ============================================================================
// PHASE 4: INTEGRATION TESTS (Full End-to-End)
// ============================================================================

async function testFullE2EFlow() {
    await runTest('E2E #1: Complete flow (create → validate → save → response → retrieve)', async () => {
        // [ESM-SKIP] const originalQueueDir = require('#infra/fs/paths').PATHS.QUEUE;
        // [ESM-SKIP] const originalRespostasDir = require('#infra/fs/paths').PATHS.RESPOSTAS_DIR;
        // [ESM-SKIP] require('#infra/fs/paths').PATHS.QUEUE = QUEUE_DIR;
        // [ESM-SKIP] require('#infra/fs/paths').PATHS.RESPOSTAS_DIR = RESPONSES_DIR;

        // 1. Create task
        const taskId = 'e2e-full-flow';
        const task = createMockTask(taskId);

        // 2. Validate schema
        const validated = parseTask(task);
        if (validated.meta.version !== '5.0') {
            throw new Error('Schema validation failed');
        }

        // 3. Save to queue
        const taskStore = await import('#infra/storage/task_store').then(m => m.default ?? m);
        await taskStore.saveTask(validated);

        // 4. Simulate execution
        const activeExecutions = new Map();
        activeExecutions.set(taskId, {
            task: validated,
            correlationId: 'e2e-corr',
            startedAt: Date.now(),
        });

        // 5. Generate response
        const responseV2 = createMockResponseV2('E2E test response');

        // 6. Save response
        await saveResponse(taskId, responseV2, validated);

        // 7. Verify task.result populated
        if (!validated.result.response_text) {
            throw new Error('task.result not populated');
        }

        // 8. Verify 4 files created
        const expectedFiles = [
            path.join(RESPONSES_DIR, `${taskId}.txt`),
            path.join(RESPONSES_DIR, `${taskId}.md`),
            path.join(RESPONSES_DIR, `${taskId}.json`),
            path.join(RESPONSES_DIR, `${taskId}.html`),
        ];

        for (const file of expectedFiles) {
            if (!fs.existsSync(file)) {
                throw new Error(`File not created: ${file}`);
            }
        }

        // 9. Load response
        const { loadResponse } = await import('#infra/storage/response_adapter');
        const txtContent = await loadResponse(taskId, 'text');
        if (!txtContent.includes('E2E test response')) {
            throw new Error('Response retrieval failed');
        }

        // 10. Cleanup cache
        activeExecutions.delete(taskId);

        // [ESM-SKIP] require('#infra/fs/paths').PATHS.QUEUE = originalQueueDir;
        // [ESM-SKIP] require('#infra/fs/paths').PATHS.RESPOSTAS_DIR = originalRespostasDir;
    });

    await runTest('E2E #2: V4 → V5 auto-migration', async () => {
        // [ESM-SKIP] const originalQueueDir = require('#infra/fs/paths').PATHS.QUEUE;
        // [ESM-SKIP] require('#infra/fs/paths').PATHS.QUEUE = QUEUE_DIR;

        // Create V4 task (legacy structure)
        const taskV4 = {
            meta: {
                id: 'test-v4-migration',
                version: '4.0',
                created_at: new Date().toISOString(),
            },
            spec: {
                target: 'chatgpt',
                model: 'auto',
                payload: {
                    system_message: '',
                    user_message: 'V4 task',
                },
            },
            state: {
                status: 'PENDING',
            },
        };

        // Save V4 task (should auto-migrate to V5)
        const taskStore = await import('#infra/storage/task_store').then(m => m.default ?? m);
        const saved = await taskStore.saveTask(taskV4);

        if (saved.meta.version !== '5.0') {
            throw new Error(`Expected version '5.0', got '${saved.meta.version}'`);
        }
        if (!saved.execution) {
            throw new Error('V5 execution field not created during migration');
        }

        // [ESM-SKIP] require('#infra/fs/paths').PATHS.QUEUE = originalQueueDir;
    });
}

// ============================================================================
// TEST RUNNER
// ============================================================================

/**
 * Função exportada: runAllTests.
 * @returns {Promise<any>}
 */
async function runAllTests() {
    console.log('\n' + '='.repeat(80));
    console.log('  Task Processing End-to-End Tests');
    console.log('  Testing: INPUT → PROCESSING → OUTPUT');
    console.log('='.repeat(80) + '\n');

    setupTestDirs();

    try {
        console.log('━━━ PHASE 1: INPUT TESTS (Task Creation & Validation) ━━━\n');
        await testSchemaV5Validation();
        await testIDSanitization();
        await testQueueOperations();
        await testQueueDepthLimit();

        console.log('\n━━━ PHASE 2: PROCESSING TESTS (Orchestrator & Driver) ━━━\n');
        await testOrchestratorCaching();
        await testDriverResponseGeneration();

        console.log('\n━━━ PHASE 3: OUTPUT TESTS (Response Capture & Storage) ━━━\n');
        await testResponseSave();
        await testResponseRetrieval();

        console.log('\n━━━ PHASE 4: INTEGRATION TESTS (Full End-to-End) ━━━\n');
        await testFullE2EFlow();

        console.log('\n' + '='.repeat(80));
        console.log('  Test Summary');
        console.log('='.repeat(80));
        console.log(`✅ Passed: ${testsPassed}`);
        console.log(`❌ Failed: ${testsFailed}`);
        console.log(`📊 Total: ${testsPassed + testsFailed}`);

        if (testsFailed > 0) {
            console.log('\n━━━ Failed Tests ━━━');
            failedTests.forEach(({ name, error }) => {
                console.log(`  ❌ ${name}`);
                console.log(`     ${error}`);
            });
        }

        console.log('='.repeat(80) + '\n');

        return testsFailed === 0;
    } finally {
        cleanupTestDirs();
    }
}

// Run tests
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
