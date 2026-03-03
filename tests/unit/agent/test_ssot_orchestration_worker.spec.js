// @ts-check
// @ts-nocheck
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { getDb, closeDb } from '#infra/db/sqlite';
import { insertTask, updateTask } from '#infra/db/task_repo';
import { upsertAttempt } from '#infra/db/task_attempt_repo';
import { insertArtifact } from '#infra/db/artifact_repo';
import { putText } from '#infra/storage/artifact_store';
import { TaskOrchestrationWorker } from '#agent/task_orchestration_worker';

function makeDbPath() {
    const dir = path.join(process.cwd(), 'tmp', 'test-dbs');
    fs.mkdirSync(dir, { recursive: true });
    const name = `maestro-test-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`;
    return path.join(dir, name);
}

function makeArtifactsDir() {
    const dir = path.join(
        process.cwd(),
        'tmp',
        'test-artifacts',
        `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
    );
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function hashId(input) {
    return crypto.createHash('sha256').update(String(input), 'utf8').digest('hex').slice(0, 20);
}

async function makeResponseTextArtifact({ taskId, attemptId, text }) {
    const now = Date.now();
    const stored = await putText({
        kind: 'response_text',
        text,
        relPath: `responses/${taskId}/${attemptId}-${now}.txt`,
        ext: 'txt',
        mime: 'text/plain',
    });

    const artId = insertArtifact({
        kind: 'response_text',
        mime: stored.mime,
        size_bytes: stored.sizeBytes,
        sha256: stored.sha256,
        storage_uri: stored.storageUri,
        created_by: 'system',
        created_at_ms: now,
    });

    return artId;
}

describe('SSOT Orchestration Worker (ITERATIVE/MULTI_STEP)', { concurrency: 1 }, () => {
    const dbPath = makeDbPath();
    const artifactsDir = makeArtifactsDir();

    before(() => {
        process.env.MAESTRO_DB_PATH = dbPath;
        process.env.MAESTRO_ARTIFACTS_DIR = artifactsDir;
        getDb(); // migrations
    });

    after(() => {
        try {
            closeDb();
        } catch (_) {}
        try {
            fs.rmSync(dbPath, { force: true });
        } catch (_) {}
        try {
            fs.rmSync(artifactsDir, { recursive: true, force: true });
        } catch (_) {}
    });

    beforeEach(() => {
        const db = getDb();
        db.exec(`
            DELETE FROM task_dependencies;
            DELETE FROM events;
            DELETE FROM task_attempts;
            DELETE FROM artifacts;
            DELETE FROM tasks;
            DELETE FROM missions;
        `);
    });

    it('ITERATIVE: agenda retry com feedback via artifact_text input (idempotente por attempt)', async () => {
        const db = getDb();
        const taskId = 'task-iter-1';
        const attemptId = 'corr-iter-1';
        const now = Date.now();

        insertTask(
            {
                meta: {
                    id: taskId,
                    version: '5.0',
                    created_at: new Date(now).toISOString(),
                    priority: 5,
                    source: 'gui',
                },
                spec: {
                    target: 'chatgpt',
                    payload: { system_message: '', user_message: 'base prompt', context: { inputs: [] } },
                    execution: {
                        strategy: 'ITERATIVE',
                        iterative_config: { max_iterations: 3, validation_criteria: { min_quality_score: 100 } },
                    },
                    validation: {
                        validators: [{ type: 'regex', config: { pattern: '^PASS$' } }],
                        on_validation_failure: 'retry',
                    },
                },
                policy: { dependencies: [], execute_after: null },
                state: { status: 'DONE' },
                result: {},
            },
            { stage: 'ARCHIVED', status: 'DONE', actor: 'system' }
        );

        const responseTextArtifactId = await makeResponseTextArtifact({ taskId, attemptId, text: 'FAIL' });
        upsertAttempt({
            id: attemptId,
            task_id: taskId,
            status: 'DONE',
            created_at_ms: now,
            ended_at_ms: now,
            response_text_artifact_id: responseTextArtifactId,
        });

        updateTask(taskId, { latest_attempt_id: attemptId });

        const worker = new TaskOrchestrationWorker({ intervalMs: 999999, batchSize: 50, workerId: 'orch_test' });
        await worker.tick();

        const row = db.prepare('SELECT stage, status, execute_after_ms, task_json FROM tasks WHERE id = ?').get(taskId);
        assert.strictEqual(row.stage, 'READY');
        assert.strictEqual(row.status, 'PENDING');
        assert.ok(
            typeof row.execute_after_ms === 'number' && row.execute_after_ms > Date.now(),
            'execute_after_ms deve estar no futuro'
        );

        const task = JSON.parse(row.task_json);
        const inputs = task?.spec?.payload?.context?.inputs || [];
        const fb = inputs.find(i => i && i.type === 'artifact_text' && i.label === 'orchestration_feedback');
        assert.ok(fb && fb.artifact_id, 'deve injetar input artifact_text orchestration_feedback');

        const art = db.prepare('SELECT * FROM artifacts WHERE id = ?').get(fb.artifact_id);
        assert.ok(art && art.storage_uri, 'feedback artifact deve existir no DB');
        const content = fs.readFileSync(art.storage_uri, 'utf8');
        assert.ok(content.includes('Orchestration Feedback'), 'feedback artifact deve conter header');

        const applied = db
            .prepare('SELECT COUNT(1) AS c FROM events WHERE dedup_key = ?')
            .get(`task:${taskId}:orchestrated:${attemptId}`)?.c;
        assert.strictEqual(applied, 1, 'deve marcar orquestração aplicada por attempt');
    });

    it('ITERATIVE: manual_review bloqueia com feedback artifact', async () => {
        const db = getDb();
        const taskId = 'task-iter-manual-1';
        const attemptId = 'corr-iter-manual-1';
        const now = Date.now();

        insertTask(
            {
                meta: {
                    id: taskId,
                    version: '5.0',
                    created_at: new Date(now).toISOString(),
                    priority: 5,
                    source: 'gui',
                },
                spec: {
                    target: 'chatgpt',
                    payload: { system_message: '', user_message: 'base prompt', context: { inputs: [] } },
                    execution: {
                        strategy: 'ITERATIVE',
                        iterative_config: { max_iterations: 3, validation_criteria: { min_quality_score: 100 } },
                    },
                    validation: {
                        validators: [{ type: 'regex', config: { pattern: '^PASS$' } }],
                        on_validation_failure: 'manual_review',
                    },
                },
                policy: { dependencies: [], execute_after: null },
                state: { status: 'DONE' },
                result: {},
            },
            { stage: 'ARCHIVED', status: 'DONE', actor: 'system' }
        );

        const responseTextArtifactId = await makeResponseTextArtifact({ taskId, attemptId, text: 'FAIL' });
        upsertAttempt({
            id: attemptId,
            task_id: taskId,
            status: 'DONE',
            created_at_ms: now,
            ended_at_ms: now,
            response_text_artifact_id: responseTextArtifactId,
        });
        updateTask(taskId, { latest_attempt_id: attemptId });

        const worker = new TaskOrchestrationWorker({ intervalMs: 999999, batchSize: 50, workerId: 'orch_test' });
        await worker.tick();

        const row = db
            .prepare('SELECT status, blocked_reason, blocked_details_json FROM tasks WHERE id = ?')
            .get(taskId);
        assert.strictEqual(row.status, 'BLOCKED');
        assert.strictEqual(row.blocked_reason, 'VALIDATION_MANUAL_REVIEW');

        const details = JSON.parse(row.blocked_details_json);
        assert.ok(details.feedback_artifact_id, 'blocked_details_json deve ter feedback_artifact_id');

        const art = db.prepare('SELECT * FROM artifacts WHERE id = ?').get(details.feedback_artifact_id);
        assert.ok(art && art.storage_uri, 'feedback artifact deve existir');
    });

    it('MULTI_STEP: cria task filha (dependency) e não duplica ao re-tick', async () => {
        const db = getDb();
        const taskId = 'task-wf-1';
        const attemptId = 'corr-wf-1';
        const now = Date.now();

        insertTask(
            {
                meta: {
                    id: taskId,
                    version: '5.0',
                    created_at: new Date(now).toISOString(),
                    priority: 5,
                    source: 'gui',
                },
                spec: {
                    target: 'chatgpt',
                    payload: { system_message: '', user_message: 'step0', context: { inputs: [] } },
                    execution: {
                        strategy: 'MULTI_STEP',
                        workflow_config: {
                            steps: [
                                { id: 's0', action: 'execute_prompt', name: 'Step 0' },
                                {
                                    id: 's1',
                                    action: 'execute_prompt',
                                    name: 'Step 1',
                                    config: { prompt: 'step1 prompt' },
                                },
                            ],
                        },
                    },
                },
                policy: { dependencies: [], execute_after: null },
                state: { status: 'DONE' },
                result: {},
            },
            { stage: 'ARCHIVED', status: 'DONE', actor: 'system' }
        );

        const responseTextArtifactId = await makeResponseTextArtifact({ taskId, attemptId, text: 'OUTPUT STEP0' });
        upsertAttempt({
            id: attemptId,
            task_id: taskId,
            status: 'DONE',
            created_at_ms: now,
            ended_at_ms: now,
            response_text_artifact_id: responseTextArtifactId,
        });
        updateTask(taskId, { latest_attempt_id: attemptId });

        const worker = new TaskOrchestrationWorker({ intervalMs: 999999, batchSize: 50, workerId: 'orch_test' });
        await worker.tick();
        await worker.tick(); // second tick should be a no-op (applied)

        const childId = `task-${hashId(`${taskId}|${attemptId}|s1`)}`;
        const child = db.prepare('SELECT id, stage, status, task_json FROM tasks WHERE id = ?').get(childId);
        assert.ok(child, 'task filha deve existir');
        assert.strictEqual(child.stage, 'READY');
        assert.strictEqual(child.status, 'PENDING');

        const dep =
            db
                .prepare('SELECT COUNT(1) AS c FROM task_dependencies WHERE task_id = ? AND depends_on_task_id = ?')
                .get(childId, taskId)?.c || 0;
        assert.strictEqual(dep, 1, 'dependency parent->child deve existir');

        const tasksCount = db.prepare('SELECT COUNT(1) AS c FROM tasks').get()?.c || 0;
        assert.strictEqual(tasksCount, 2, 'não deve duplicar task filha ao re-tick');

        const childTask = JSON.parse(child.task_json);
        assert.strictEqual(childTask.meta.parent_id, taskId);
        assert.ok(
            Array.isArray(childTask.policy.dependencies) && childTask.policy.dependencies.includes(taskId),
            'child task deve depender do parent'
        );
    });
});
