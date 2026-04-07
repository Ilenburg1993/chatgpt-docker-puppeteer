// @ts-check
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

async function read(/** @type {any} */ relPath) {
    return fs.readFile(path.join(process.cwd(), relPath), 'utf8');
}

test('wave19: rotas ativas vNext sem mutação direta /api/tasks e /api/missions', async () => {
    const targets = [
        'src/dashboard-ui/src/views/TasksView.vue',
        'src/dashboard-ui/src/views/TaskDetail.vue',
        'src/dashboard-ui/src/views/MissionDetail.vue',
        'src/dashboard-ui/src/views/Missions.vue',
        'src/dashboard-ui/src/stores/tasks_vnext.js',
        'src/dashboard-ui/src/stores/missions_vnext.js',
    ];

    for (const relPath of targets) {
        const content = await read(relPath);
        // Bloquear mutações diretas CRUD em /api/tasks e /api/missions (root),
        // mas permitir sub-rotas legítimas como /api/missions/:id/feedback, /suggest-tasks, /proposals/*
        assert.doesNotMatch(content, /http\.(post|patch|put|delete)\(\s*['"`]\/api\/tasks['"`]/);
        assert.doesNotMatch(content, /http\.(patch|put|delete)\(\s*['"`]\/api\/missions['"`]/);
    }
});

test('wave19: router ativo não aponta para views legadas e não usa useRealtime', async () => {
    const routerContent = await read('src/dashboard-ui/src/router/index.js');
    const tasksView = await read('src/dashboard-ui/src/views/TasksView.vue');
    const taskDetail = await read('src/dashboard-ui/src/views/TaskDetail.vue');
    const missionDetail = await read('src/dashboard-ui/src/views/MissionDetail.vue');
    const missionsView = await read('src/dashboard-ui/src/views/Missions.vue');

    assert.doesNotMatch(
        routerContent,
        /Dashboard\.vue|TaskQueue\.vue|PerformanceMetrics\.vue|WorkflowEditor\.vue|Templates\.vue/,
    );
    assert.doesNotMatch(tasksView, /useRealtime/);
    assert.doesNotMatch(taskDetail, /useRealtime/);
    assert.doesNotMatch(missionDetail, /useRealtime/);
    assert.doesNotMatch(missionsView, /useRealtime/);
});
