// @ts-check
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { MissionRunner } from '#agent/mission_runner';
import { getMissionById, updateMission } from '#infra/db/mission_repo';
import { closeDb, getDb } from '#infra/db/sqlite';

function makeDbPath() {
    const dir = path.join(process.cwd(), 'tmp', 'test-dbs');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(
        dir,
        `maestro-wave17-idempotency-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
    );
}

test('wave17: MissionRunner cria task de step com id determinístico e sem duplicar em reprocessamento', async (t) => {
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

    const missionId = 'mission-wave17-idempotency';
    const now = Date.now();
    const context = {
        workflow: {
            id: 'wf-wave17-idempotency',
            steps: [{ id: 'step-alpha', description: 'Primeiro step' }],
        },
        progress: {
            current_step_index: 0,
            current_task_id: null,
            completed: [],
            failed: [],
            created_count: 0,
            step_attempt_seq: {},
        },
        mission_context: {},
    };

    db.prepare(
        `
        INSERT INTO missions
          (id, title, description, status, autonomy_mode, policy_json, context_json, created_at_ms, updated_at_ms, started_at_ms, completed_at_ms)
        VALUES
          (@id, @title, @description, @status, @autonomy_mode, @policy_json, @context_json, @created_at_ms, @updated_at_ms, @started_at_ms, NULL)
    `,
    ).run({
        id: missionId,
        title: 'Wave17 mission',
        description: 'Idempotency check',
        status: 'RUNNING',
        autonomy_mode: 'USER_ONLY',
        policy_json: JSON.stringify({ max_tasks_total: 10 }),
        context_json: JSON.stringify(context),
        created_at_ms: now,
        updated_at_ms: now,
        started_at_ms: now,
    });

    const runner = new MissionRunner({ intervalMs: 1000 });
    await runner._processMission(missionId);

    let tasks = db.prepare('SELECT id FROM tasks WHERE mission_id = ? ORDER BY id ASC').all(missionId);
    assert.equal(tasks.length, 1);
    const firstTaskId = String(/** @type {any} */ (tasks[0]).id);

    // Simula restart/reprocessamento: missão volta a current_task_id=null no mesmo step.
    const mission = /** @type {any} */ (getMissionById(missionId));
    const resetProgress = {
        ...(mission.context?.progress || {}),
        current_step_index: 0,
        current_task_id: null,
        created_count: 0,
        step_attempt_seq: {},
    };
    updateMission(missionId, {
        context: {
            ...(mission.context || {}),
            progress: resetProgress,
        },
    });

    await runner._processMission(missionId);
    tasks = db.prepare('SELECT id FROM tasks WHERE mission_id = ? ORDER BY id ASC').all(missionId);
    assert.equal(tasks.length, 1);
    assert.equal(String(/** @type {any} */ (tasks[0]).id), firstTaskId);

    t.after(() => {
        try {
            closeDb();
        } catch (_) {}
        try {
            fs.rmSync(dbPath, { force: true });
        } catch (_) {}
    });
});
