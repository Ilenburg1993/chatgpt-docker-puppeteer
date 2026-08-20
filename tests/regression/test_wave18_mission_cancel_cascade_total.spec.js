// @ts-check
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { onTestFinished, test } from 'vitest';

import * as schemas from '#core/schemas';
import { createMission, getMissionById, updateMission } from '#infra/db/mission_repo';
import { closeDb, getDb } from '#infra/db/sqlite';
import { insertTask } from '#infra/db/task_repo';
import { cancelMissionCommand } from '#server/domain/mission_control_service';

function makeDbPath() {
    const dir = path.join(process.cwd(), 'tmp', 'test-dbs');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(
        dir,
        `maestro-wave18-cascade-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
    );
}

function makeTask(/** @type {any} */ id, /** @type {any} */ missionId, /** @type {any} */ userMessage) {
    return schemas.core.TaskSchemaV5.parse({
        meta: {
            id,
            version: '5.0',
            created_at: new Date().toISOString(),
            priority: 5,
            source: 'api',
            mission_id: missionId,
            tags: [],
        },
        spec: {
            target: 'chatgpt',
            payload: {
                system_message: '',
                user_message: userMessage,
            },
        },
        policy: {},
        state: { status: 'PENDING' },
        result: {},
    });
}

test('wave18: cancelamento de missão cancela tasks ativas em cascata', async () => {
    const dbPath = makeDbPath();
    process.env['MAESTRO_DB_PATH'] = dbPath;

    const db = getDb();
    db.exec(`
        DELETE FROM task_dependencies;
        DELETE FROM events;
        DELETE FROM task_attempts;
        DELETE FROM artifacts;
        DELETE FROM mission_steps;
        DELETE FROM tasks;
        DELETE FROM missions;
    `);

    const mission = /** @type {any} */ (createMission({ title: 'Wave18 Cascade', description: 'test' }));
    updateMission(mission.id, { status: 'RUNNING' });

    insertTask(makeTask('task-wave18-cascade-1', mission.id, 'pending'), {
        stage: 'READY',
        status: 'PENDING',
        actor: 'test',
    });
    insertTask(makeTask('task-wave18-cascade-2', mission.id, 'running'), {
        stage: 'READY',
        status: 'RUNNING',
        actor: 'test',
    });
    insertTask(makeTask('task-wave18-cascade-3', mission.id, 'done'), {
        stage: 'ARCHIVED',
        status: 'DONE',
        actor: 'test',
    });

    const result = /** @type {any} */ (
        cancelMissionCommand(
            /** @type {any} */ ({
                missionId: mission.id,
                reason: 'Teste de cancelamento em cascata',
                actor: { id: 'tester', username: 'tester', role: 'owner' },
            }),
        )
    );

    const after = getMissionById(mission.id);
    const rows = db.prepare('SELECT id, status FROM tasks WHERE mission_id = ? ORDER BY id').all(mission.id);

    assert.equal(result.after.status, 'CANCELLED');
    assert.equal(after?.['status'], 'CANCELLED');

    const byId = new Map(rows.map((/** @type {any} */ r) => [String(r.id), String(r.status)]));
    assert.equal(byId.get('task-wave18-cascade-1'), 'CANCELLED');
    assert.equal(byId.get('task-wave18-cascade-2'), 'CANCELLED');
    assert.equal(byId.get('task-wave18-cascade-3'), 'DONE');

    onTestFinished(() => {
        try {
            closeDb();
        } catch {}
        try {
            fs.rmSync(dbPath, { force: true });
        } catch {}
    });
});
