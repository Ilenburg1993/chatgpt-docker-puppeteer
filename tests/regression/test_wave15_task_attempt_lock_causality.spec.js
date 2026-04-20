// @ts-check
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { onTestFinished, test } from 'vitest';

import { closeDb, getDb } from '#infra/db/sqlite';
import { claimNextEligibleTask, insertTask, releaseTaskLock, updateTask } from '#infra/db/task_repo';

function makeDbPath() {
    const dir = path.join(process.cwd(), 'tmp', 'test-dbs');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(
        dir,
        `maestro-wave15-lock-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
    );
}

test('wave15: releaseTaskLock exige causalidade com expectedAttemptId quando informado', async (t) => {
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

    onTestFinished(() => {
        try {
            closeDb();
        } catch (_) {}
        try {
            fs.rmSync(dbPath, { force: true });
        } catch (_) {}
    });

    const taskId = 'task-wave15-lock';
    insertTask(
        {
            meta: {
                id: taskId,
                version: '5.0',
                created_at: new Date().toISOString(),
                priority: 5,
                source: 'gui',
            },
            spec: {
                target: 'chatgpt',
                payload: { user_message: 'lock test' },
                execution: { strategy: 'SINGLE_SHOT' },
            },
            state: { status: 'PENDING' },
            policy: { dependencies: [] },
            result: {},
        },
        { stage: 'READY', status: 'PENDING', actor: 'system' },
    );

    const now = Date.now();
    const claimed = claimNextEligibleTask({
        workerId: 'worker-wave15',
        nowMs: now,
        lockTtlMs: 60000,
    });
    assert.ok(/** @type {any} */ (claimed)?.task, 'task deve ser claimada para testar lock release');

    updateTask(taskId, {
        latest_attempt_id: 'attempt-current',
        last_correlation_id: 'attempt-current',
    });

    const skipped = releaseTaskLock({
        taskId,
        workerId: 'worker-wave15',
        expectedAttemptId: 'attempt-stale',
    });
    assert.equal(skipped, 0, 'unlock com attempt stale deve ser ignorado');

    const stillLocked = /** @type {any} */ (db.prepare('SELECT locked_by FROM tasks WHERE id = ?').get(taskId));
    assert.equal(stillLocked?.locked_by, 'worker-wave15', 'lock deve permanecer ativo após unlock stale');

    const released = releaseTaskLock({
        taskId,
        workerId: 'worker-wave15',
        expectedAttemptId: 'attempt-current',
    });
    assert.equal(released, 1, 'unlock com attempt corrente deve liberar lock');

    const unlockedRow = /** @type {any} */ (
        db.prepare('SELECT locked_by, lock_expires_at_ms FROM tasks WHERE id = ?').get(taskId)
    );
    assert.equal(unlockedRow?.locked_by, null);
    assert.equal(unlockedRow?.lock_expires_at_ms, null);
});

test('wave15: queue_worker/projector usam helper causal e evitam unlock cego', async () => {
    const queueWorkerPath = path.join(process.cwd(), 'src/agent/queue_worker.js');
    const projectorPath = path.join(process.cwd(), 'src/agent/task_state_projector.js');

    const queueWorker = fs.readFileSync(queueWorkerPath, 'utf8');
    const projector = fs.readFileSync(projectorPath, 'utf8');

    assert.match(queueWorker, /releaseTaskLockForAttempt\s*\(/, 'QueueWorker deve usar unlock causal');
    assert.match(projector, /releaseTaskLockForAttempt\s*\(/, 'TaskStateProjector deve usar unlock causal');

    assert.doesNotMatch(
        queueWorker,
        /releaseTaskLock\s*\(\s*\{\s*taskId\s*\}\s*\)/,
        'QueueWorker não deve fazer unlock cego por taskId',
    );
    assert.doesNotMatch(
        projector,
        /releaseTaskLock\s*\(\s*\{\s*taskId\s*\}\s*\)/,
        'TaskStateProjector não deve fazer unlock cego por taskId',
    );
});
