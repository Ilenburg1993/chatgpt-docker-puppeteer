// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

async function read(/** @type {any} */ relPath) {
    return fs.readFile(path.join(process.cwd(), relPath), 'utf8');
}

test('wave19: UI usa confirmação em 2 etapas e motivo obrigatório para comandos críticos', async () => {
    const guard = await read('src/dashboard-ui/src/lib/command_guard.js');
    const tasksView = await read('src/dashboard-ui/src/views/TasksView.vue');
    const taskDetail = await read('src/dashboard-ui/src/views/TaskDetail.vue');
    const missionDetail = await read('src/dashboard-ui/src/views/MissionDetail.vue');
    const missionsView = await read('src/dashboard-ui/src/views/Missions.vue');

    assert.match(guard, /confirmTwoStepAction/);
    assert.match(guard, /requireReason/);
    assert.match(guard, /\[Confirmação 1\/2\]/);
    assert.match(guard, /\[Confirmação 2\/2\]/);

    assert.match(tasksView, /confirmTwoStepAction/);
    assert.match(taskDetail, /confirmTwoStepAction/);
    assert.match(missionDetail, /confirmTwoStepAction/);
    assert.match(missionsView, /confirmTwoStepAction/);
});
