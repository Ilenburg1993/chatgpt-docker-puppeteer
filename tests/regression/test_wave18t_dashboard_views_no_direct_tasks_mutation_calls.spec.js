// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

async function read(/** @type {any} */ relPath) {
    return fs.readFile(path.join(process.cwd(), relPath), 'utf8');
}

test('wave18t: views ativas não usam mutação direta /api/tasks', async () => {
    const tasksView = await read('src/dashboard-ui/src/views/TasksView.vue');
    const taskDetail = await read('src/dashboard-ui/src/views/TaskDetail.vue');
    const missionDetail = await read('src/dashboard-ui/src/views/MissionDetail.vue');

    assert.doesNotMatch(tasksView, /http\.(post|patch|put)\(\s*['"`]\/api\/tasks/);
    assert.doesNotMatch(taskDetail, /http\.(post|patch|put)\(\s*['"`]\/api\/tasks/);
    assert.doesNotMatch(missionDetail, /http\.(post|patch|put)\(\s*['"`]\/api\/tasks/);
});
