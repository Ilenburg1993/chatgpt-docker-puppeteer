// @ts-check
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { updateMissionProgressState } from '#agent/mission_execution_service';
import { getMissionById } from '#infra/db/mission_repo';
import { closeDb, getDb } from '#infra/db/sqlite';

function makeDbPath() {
    const dir = path.join(process.cwd(), 'tmp', 'test-dbs');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(
        dir,
        `maestro-wave17-stale-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
    );
}

test('wave17: atualização stale (current_task_id divergente) é rejeitada sem mutar missão', async (t) => {
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

    const missionId = 'mission-wave17-stale';
    const now = Date.now();
    db.prepare(
        `
        INSERT INTO missions
          (id, title, description, status, autonomy_mode, policy_json, context_json, created_at_ms, updated_at_ms, started_at_ms, completed_at_ms)
        VALUES
          (@id, @title, @description, @status, @autonomy_mode, @policy_json, @context_json, @created_at_ms, @updated_at_ms, @started_at_ms, NULL)
    `,
    ).run({
        id: missionId,
        title: 'mission stale test',
        description: 'stale',
        status: 'RUNNING',
        autonomy_mode: 'USER_ONLY',
        policy_json: JSON.stringify({}),
        context_json: JSON.stringify({
            progress: {
                current_step_index: 1,
                current_task_id: 'task-live',
                created_count: 1,
                completed: [],
                failed: [],
            },
        }),
        created_at_ms: now,
        updated_at_ms: now,
        started_at_ms: now,
    });

    const result = updateMissionProgressState(
        /** @type {any} */ ({
            missionId,
            progress: {
                current_task_id: null,
                current_step_index: 2,
            },
            expectedProgress: {
                currentTaskId: 'task-stale',
                currentStepIndex: 1,
            },
            actorType: 'system',
            dedupKey: `mission:${missionId}:stale-test`,
        }),
    );

    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 423);
    assert.equal(result.code, 'MISSION_LOCKED');

    const missionAfter = /** @type {any} */ (getMissionById(missionId));
    assert.equal(missionAfter.context?.progress?.current_task_id, 'task-live');
    assert.equal(Number(missionAfter.context?.progress?.current_step_index || 0), 1);

    onTestFinished(() => {
        try {
            closeDb();
        } catch (_) {}
        try {
            fs.rmSync(dbPath, { force: true });
        } catch (_) {}
    });
});
