// @ts-check
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { onTestFinished, test } from 'vitest';

import { closeDb, getDb } from '#infra/db/sqlite';
import { getUserPreferences, upsertUserPreferences } from '#infra/db/user_pref_repo';

function makeDbPath() {
    const dir = path.join(process.cwd(), 'tmp', 'test-dbs');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(
        dir,
        `maestro-wave18-prefs-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
    );
}

test('wave18: preferências de UI persistem em sqlite por usuário', async (t) => {
    const dbPath = makeDbPath();
    process.env.MAESTRO_DB_PATH = dbPath;

    const db = getDb();
    db.exec('DELETE FROM user_preferences;');

    const first = upsertUserPreferences('operator1', {
        density: 'compact',
        layout: { missions: { split: 0.7 } },
        filters: { tasks: { status: ['RUNNING'] } },
    });
    assert.equal(first?.density, 'compact');

    const second = upsertUserPreferences('operator1', {
        columns: { tasks: ['id', 'status', 'mission_id'] },
    });

    const loaded = getUserPreferences('operator1');
    assert.ok(loaded);
    assert.deepEqual(loaded.layout, { missions: { split: 0.7 } });
    assert.deepEqual(second.columns, { tasks: ['id', 'status', 'mission_id'] });
    assert.deepEqual(loaded.columns, { tasks: ['id', 'status', 'mission_id'] });

    onTestFinished(() => {
        try {
            closeDb();
        } catch {}
        try {
            fs.rmSync(dbPath, { force: true });
        } catch {}
    });
});
