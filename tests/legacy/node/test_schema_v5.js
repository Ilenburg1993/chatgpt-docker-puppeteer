// @ts-nocheck -- LEGACY QUARANTINE: migração pendente (Fase E.0)
import { autoMigrateTask, migrateTaskV4toV5 } from '#core/schemas/migrator_v4_to_v5';
import { TaskSchema } from '#core/schemas/task_schema';
import { TaskSchemaV5 } from '#core/schemas/task_schema_v5';
import { fillExecutionContext } from '#shared/utils/execution_context_filler';

console.log('\n🧪 ===== TEST SUITE: Task Schema V5 =====\n');

let testsRun = 0;
let testsPassed = 0;
let testsFailed = 0;

function assert(condition, testName) {
    testsRun++;
    if (condition) {
        console.log(`✅ PASS: ${testName}`);
        testsPassed++;
        return true;
    } else {
        console.error(`❌ FAIL: ${testName}`);
        testsFailed++;
        return false;
    }
}

// ==========================================
// TEST 1: Schema V5 Basic Validation
// ==========================================
console.log('📋 TEST 1: Schema V5 Basic Validation\n');

try {
    const minimalTaskV5 = {
        meta: {
            id: 'test-v5-001',
            project_id: 'default',
            version: '5.0',
            created_at: new Date().toISOString(),
            priority: 50,
            source: 'api',
            tags: [],
        },
        spec: {
            target: 'chatgpt',
            model: 'gpt-4-turbo',
            payload: {
                system_message: '',
                user_message: 'Test message',
            },
        },
        policy: {
            max_attempts: 3,
            timeout_ms: 60000,
        },
        execution: {}, // NOVO V5
        mission: {}, // NOVO V5
        state: {
            status: 'PENDING',
            attempts: 0,
            metrics: {},
            history: { events: [], summary: {} },
        },
        result: {
            storage: {},
            generation: {},
            validation: null,
            preview: {},
            finish_reason: 'unknown',
        },
    };

    const validated = TaskSchemaV5.parse(minimalTaskV5);
    assert(validated.meta.id === 'test-v5-001', 'Minimal V5 task validates');
    assert(validated.execution !== undefined, 'V5 has execution field');
    assert(validated.mission !== undefined, 'V5 has mission field');
    assert(validated.result.storage !== undefined, 'V5 result has storage field');
    assert(validated.result.generation !== undefined, 'V5 result has generation field');
} catch (error) {
    assert(false, `Minimal V5 task validation - ERROR: ${error.message}`);
}

// ==========================================
// TEST 2: Migration V4 → V5
// ==========================================
console.log('\n📋 TEST 2: Migration V4 → V5\n');

const taskV4 = {
    meta: {
        id: 'test-v4-001',
        project_id: 'default',
        version: '4.0',
        created_at: new Date().toISOString(),
        priority: 50,
        source: 'api',
        tags: ['test'],
    },
    spec: {
        target: 'chatgpt',
        model: 'gpt-4',
        payload: {
            system_message: 'You are a helpful assistant',
            user_message: 'Hello!',
        },
        parameters: {
            temperature: 0.7,
            max_tokens: 1000,
        },
        validation: {
            min_length: 10,
            required_format: 'text',
        },
        config: {
            reset_context: false,
            require_history: true,
            output_format: 'markdown',
        },
    },
    policy: {
        max_attempts: 3,
        timeout_ms: 60000,
        dependencies: [],
        priority_weight: 1.0,
    },
    state: {
        status: 'PENDING',
        progress_estimate: 0,
        worker_id: null,
        attempts: 0,
        started_at: null,
        completed_at: null,
        last_error: null,
        metrics: {
            duration_ms: 0,
            token_estimate: 0,
            event_loop_lag_ms: 0,
        },
        history: [
            {
                ts: new Date().toISOString(),
                event: 'TASK_CREATED',
                msg: 'Task created via API',
            },
        ],
    },
    result: {
        file_path: null,
        session_url: null,
        finish_reason: 'unknown',
        raw_output_preview: '',
    },
};

try {
    const taskV5 = migrateTaskV4toV5(taskV4);

    assert(taskV5.meta.version === '5.0', 'V4 → V5: version updated');
    assert(taskV5.execution !== undefined, 'V4 → V5: execution field added');
    assert(taskV5.execution.driver !== undefined, 'V4 → V5: execution.driver exists');
    assert(taskV5.execution.environment !== undefined, 'V4 → V5: execution.environment exists');
    assert(taskV5.execution.retry !== undefined, 'V4 → V5: execution.retry exists');
    assert(taskV5.mission !== undefined, 'V4 → V5: mission field added');
    assert(taskV5.state.metrics.phases !== undefined, 'V4 → V5: state.metrics.phases added');
    assert(taskV5.state.metrics.perception !== undefined, 'V4 → V5: state.metrics.perception added');
    assert(taskV5.state.history.events !== undefined, 'V4 → V5: state.history.events exists');
    assert(taskV5.state.history.summary !== undefined, 'V4 → V5: state.history.summary added');
    assert(taskV5.result.storage !== undefined, 'V4 → V5: result.storage added');
    assert(taskV5.result.generation !== undefined, 'V4 → V5: result.generation added');
    assert(taskV5.result.validation === null, 'V4 → V5: result.validation is null (phase posterior)');
    assert(taskV5.result.preview !== undefined, 'V4 → V5: result.preview added');

    // Valida campos V4 preservados
    assert(taskV5.meta.id === 'test-v4-001', 'V4 → V5: meta.id preserved');
    assert(taskV5.spec.target === 'chatgpt', 'V4 → V5: spec.target preserved');
    assert(taskV5.spec.payload.user_message === 'Hello!', 'V4 → V5: spec.payload preserved');
    assert(taskV5.state.history.events.length === 1, 'V4 → V5: state.history.events preserved');

    // Valida V5 com schema
    const validatedV5 = TaskSchemaV5.parse(taskV5);
    assert(validatedV5 !== null, 'V4 → V5: migrated task validates against V5 schema');
} catch (error) {
    assert(false, `V4 → V5 migration - ERROR: ${error.message}`);
}

// ==========================================
// TEST 3: Backward Compatibility (V5 → V4 downgrade)
// ==========================================
console.log('\n📋 TEST 3: Backward Compatibility (Downgrade V5 → V4)\n');

try {
    const { downgradeV5toV4 } = await import('#core/schemas/migrator_v4_to_v5');

    const taskV5 = migrateTaskV4toV5(taskV4);
    const downgradedV4 = downgradeV5toV4(taskV5);

    assert(downgradedV4.meta.version === '4.0', 'V5 → V4: version downgraded');
    assert(downgradedV4.execution === undefined, 'V5 → V4: execution removed');
    assert(downgradedV4.mission === undefined, 'V5 → V4: mission removed');
    assert(downgradedV4.state.metrics.phases === undefined, 'V5 → V4: state.metrics.phases removed');
    assert(downgradedV4.result.storage === undefined, 'V5 → V4: result.storage removed');
    assert(downgradedV4.result.generation === undefined, 'V5 → V4: result.generation removed');

    // Valida V4 com schema V4
    const validatedV4 = TaskSchema.parse(downgradedV4);
    assert(validatedV4 !== null, 'V5 → V4: downgraded task validates against V4 schema');
} catch (error) {
    assert(false, `V5 → V4 downgrade - ERROR: ${error.message}`);
}

// ==========================================
// TEST 4: Auto Migration (detecta versão)
// ==========================================
console.log('\n📋 TEST 4: Auto Migration (Version Detection)\n');

try {
    // Task sem versão (assume V4)
    const taskNoVersion = { ...taskV4 };
    delete taskNoVersion.meta.version;

    const migrated = autoMigrateTask(taskNoVersion);
    assert(migrated.meta.version === '5.0', 'Auto-migration: task sem versão → V5');

    // Task V4 explícita
    const migrated2 = autoMigrateTask(taskV4);
    assert(migrated2.meta.version === '5.0', 'Auto-migration: task V4 → V5');

    // Task V5 já migrada (não altera)
    const taskV5Existing = migrateTaskV4toV5(taskV4);
    const migrated3 = autoMigrateTask(taskV5Existing);
    assert(migrated3.meta.version === '5.0', 'Auto-migration: task V5 → V5 (sem mudança)');
    assert(migrated3.meta.id === taskV5Existing.meta.id, 'Auto-migration: task V5 preservada');
} catch (error) {
    assert(false, `Auto migration - ERROR: ${error.message}`);
}

// ==========================================
// TEST 5: Execution Context Filler
// ==========================================
console.log('\n📋 TEST 5: Execution Context Filler\n');

try {
    const taskV5 = migrateTaskV4toV5(taskV4);

    // Mock driver
    const mockDriver = {
        name: 'ChatGPTDriver',
        version: '2.0',
        connectionMode: 'launcher',
    };

    // Mock browserPool
    const mockBrowserPool = {
        getHealth: () => 'stable',
    };

    const filled = fillExecutionContext(taskV5, {
        driver: mockDriver,
        browserPool: mockBrowserPool,
        tacticalAttempts: 2,
        strategicAttempts: 1,
        errorsRecovered: ['SELECTOR_NOT_FOUND'],
        totalBackoffMs: 3000,
    });

    assert(filled.execution.driver.type === 'ChatGPTDriver', 'Execution filler: driver type set');
    assert(filled.execution.driver.version === '2.0', 'Execution filler: driver version set');
    assert(filled.execution.driver.connection_mode === 'launcher', 'Execution filler: connection mode set');
    assert(filled.execution.driver.browser_pool_health === 'stable', 'Execution filler: browser pool health set');
    assert(filled.execution.environment.platform !== undefined, 'Execution filler: platform set');
    assert(filled.execution.environment.node_version !== undefined, 'Execution filler: node version set');
    assert(filled.execution.retry.tactical_attempts === 2, 'Execution filler: tactical attempts set');
    assert(filled.execution.retry.strategic_attempts === 1, 'Execution filler: strategic attempts set');
    assert(filled.execution.retry.errors_recovered.length === 1, 'Execution filler: errors recorded');
    assert(filled.execution.retry.total_backoff_ms === 3000, 'Execution filler: backoff ms set');
} catch (error) {
    assert(false, `Execution context filler - ERROR: ${error.message}`);
}

// ==========================================
// TEST 6: Result V2 Structure
// ==========================================
console.log('\n📋 TEST 6: Result V2 Structure\n');

try {
    const taskV5 = migrateTaskV4toV5(taskV4);

    // Preenche result V2 (simulando Response Capture)
    taskV5.result.storage = {
        text_file: '/workspaces/respostas/test-v4-001.txt',
        markdown_file: '/workspaces/respostas/test-v4-001.md',
        json_file: '/workspaces/respostas/test-v4-001.json',
        html_file: '/workspaces/respostas/test-v4-001.html',
    };

    taskV5.result.generation = {
        model: 'gpt-4-turbo',
        started_at: new Date().toISOString(),
        completed_at: new Date(Date.now() + 5000).toISOString(),
        duration_ms: 5000,
        tokens_estimate: 150,
        continuations: 0,
        thought_blocks_pruned: 0,
        retry_attempts: 0,
    };

    taskV5.result.preview = {
        text: 'Hello! How can I assist you today?',
        sections_count: 1,
        code_blocks_count: 0,
        links_count: 0,
        images_count: 0,
    };

    const validated = TaskSchemaV5.parse(taskV5);
    assert(validated.result.storage.text_file !== null, 'Result V2: storage.text_file set');
    assert(validated.result.generation.model === 'gpt-4-turbo', 'Result V2: generation.model set');
    assert(validated.result.generation.duration_ms === 5000, 'Result V2: generation.duration_ms set');
    assert(validated.result.preview.text !== '', 'Result V2: preview.text set');
    assert(validated.result.validation === null, 'Result V2: validation null (fase posterior)');
} catch (error) {
    assert(false, `Result V2 structure - ERROR: ${error.message}`);
}

// ==========================================
// TEST 7: Mission Context Structure
// ==========================================
console.log('\n📋 TEST 7: Mission Context Structure\n');

try {
    const taskV5 = migrateTaskV4toV5(taskV4);

    // Preenche mission context (simulando Mission System)
    taskV5.mission = {
        mission_id: 'mission-001',
        step_id: 'step-002',
        step_index: 1,
        step_dependencies: ['step-001'],
        mission_context: {
            previous_output: 'Analysis complete',
            accumulated_data: { count: 42 },
        },
        is_checkpoint: true,
    };

    const validated = TaskSchemaV5.parse(taskV5);
    assert(validated.mission.mission_id === 'mission-001', 'Mission: mission_id set');
    assert(validated.mission.step_id === 'step-002', 'Mission: step_id set');
    assert(validated.mission.step_index === 1, 'Mission: step_index set');
    assert(validated.mission.step_dependencies.length === 1, 'Mission: dependencies set');
    assert(validated.mission.is_checkpoint === true, 'Mission: is_checkpoint set');
    assert(validated.mission.mission_context.accumulated_data.count === 42, 'Mission: context preserved');
} catch (error) {
    assert(false, `Mission context structure - ERROR: ${error.message}`);
}

// ==========================================
// SUMMARY
// ==========================================
console.log('\n' + '='.repeat(60));
console.log('📊 TEST RESULTS SUMMARY');
console.log('='.repeat(60));
console.log(`Tests Run:    ${testsRun}`);
console.log(`Tests Passed: ${testsPassed} ✅`);
console.log(`Tests Failed: ${testsFailed} ❌`);
console.log('='.repeat(60));

if (testsFailed === 0) {
    console.log('\n🎉 ALL TESTS PASSED! Schema V5 is production ready.\n');
    process.exit(0);
} else {
    console.error(`\n❌ ${testsFailed} TESTS FAILED. Review errors above.\n`);
    process.exit(1);
}
