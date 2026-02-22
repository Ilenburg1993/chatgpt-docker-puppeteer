import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { buildWorkflowNextStepTask } from '#agent/workflow_next_step_builder';
import { closeDb, getDb } from '#infra/db/sqlite';
import { insertTask } from '#infra/db/task_repo';
import { KernelNERVBridge } from '#kernel/nerv_bridge/kernel_nerv_bridge';

function makeDbPath() {
    const dir = path.join(process.cwd(), 'tmp', 'test-dbs');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(
        dir,
        `maestro-wave15-bridge-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`
    );
}

test('wave15: KernelNERVBridge NEXT_STEP cria task filha via SSOT sem duplicação', async t => {
    const dbPath = makeDbPath();
    process.env.MAESTRO_DB_PATH = dbPath;
    const db = getDb();
    db.exec(`
        DELETE FROM task_dependencies;
        DELETE FROM events;
        DELETE FROM task_attempts;
        DELETE FROM artifacts;
        DELETE FROM tasks;
        DELETE FROM missions;
    `);

    t.after(() => {
        try {
            closeDb();
        } catch (_) {}
        try {
            fs.rmSync(dbPath, { force: true });
        } catch (_) {}
    });

    const bridge = new KernelNERVBridge({
        nerv: { onReceive: () => () => {} },
        taskRuntime: { getTask: () => null },
        observationStore: { ingestEvent: () => {} },
        telemetry: {
            emit: () => {},
            info: () => {},
            warning: () => {},
            critical: () => {},
        },
        orchestrator: null,
    });

    bridge.started = true;
    bridge.emitEvent = async () => {};

    const parentTask = {
        meta: {
            id: 'task-parent-wave15',
            version: '5.0',
            source: 'gui',
            mission_id: 'mission-wave15',
            workflow_id: 'wf-wave15',
            created_at: new Date().toISOString(),
        },
        spec: {
            target: 'chatgpt',
            payload: { system_message: 'sys', user_message: 'step0' },
            execution: {
                strategy: 'MULTI_STEP',
                workflow_config: {
                    steps: [
                        { id: 's0', name: 'Step 0', action: 'execute_prompt' },
                        { id: 's1', name: 'Step 1', action: 'execute_prompt', config: { prompt: 'Execute step 1' } },
                    ],
                },
            },
        },
        policy: { dependencies: [] },
        state: {
            status: 'DONE',
            history: {},
            workflow_state: {
                current_step_index: 1,
                completed_steps: ['s0'],
                accumulated_context: {
                    s0: {
                        task_id: 'task-parent-wave15',
                    },
                },
            },
        },
        result: {},
    };

    db.prepare(
        `
        INSERT INTO missions (id, title, description, status, autonomy_mode, policy_json, context_json, created_at_ms, updated_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run('mission-wave15', 'mission-wave15', 'test', 'RUNNING', 'USER_ONLY', '{}', '{}', Date.now(), Date.now());

    insertTask(parentTask, { stage: 'ARCHIVED', status: 'DONE', actor: 'system', ifNotExists: true });

    const nextStep = { id: 's1', action: 'execute_prompt', config: { prompt: 'Execute step 1' }, step_index: 1 };
    const correlationId = 'corr-wave15-next-step';

    const expected = buildWorkflowNextStepTask({
        parentTask,
        parentTaskId: parentTask.meta.id,
        attemptId: correlationId,
        nextStep,
        nextStepIndex: 1,
        workflowConfig: parentTask.spec.execution.workflow_config,
        completedStepIds: ['s0'],
        accumulatedContext: parentTask.state.workflow_state.accumulated_context,
    });

    await bridge._handleNextStepAction(parentTask, nextStep, null, correlationId);
    await bridge._handleNextStepAction(parentTask, nextStep, null, correlationId);

    const row = db
        .prepare('SELECT id, parent_id, mission_id, workflow_id, stage, status FROM tasks WHERE id = ?')
        .get(expected.childId);
    assert.ok(row, 'task filha deve existir');
    assert.equal(row.parent_id, parentTask.meta.id);
    assert.equal(row.mission_id, parentTask.meta.mission_id);
    assert.equal(row.workflow_id, parentTask.meta.workflow_id);
    assert.equal(row.stage, 'READY');
    assert.equal(row.status, 'PENDING');

    const countTasks = db.prepare('SELECT COUNT(1) AS c FROM tasks WHERE id = ?').get(expected.childId)?.c || 0;
    assert.equal(countTasks, 1, 'reprocessamento não deve duplicar task filha');

    const eventCount =
        db
            .prepare(
                "SELECT COUNT(1) AS c FROM events WHERE entity_id = ? AND event_type = 'TASK_ORCHESTRATION_NEXT_STEP_CREATED'"
            )
            .get(parentTask.meta.id)?.c || 0;
    assert.equal(eventCount, 1, 'evento de next-step deve ser idempotente por dedupKey');
});
