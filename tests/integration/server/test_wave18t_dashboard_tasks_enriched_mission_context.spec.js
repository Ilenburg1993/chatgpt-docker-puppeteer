import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

test('wave18t: dashboard tasks expõe mission_ref/mission_context/siblings no contrato', async () => {
    const dashboardTasks = await fs.readFile(
        path.join(process.cwd(), 'src/server/api/controllers/dashboard_tasks.js'),
        'utf8'
    );
    const taskViews = await fs.readFile(
        path.join(process.cwd(), 'src/server/api/utils/task_views.js'),
        'utf8'
    );
    const dashboardMissions = await fs.readFile(
        path.join(process.cwd(), 'src/server/api/controllers/dashboard_missions.js'),
        'utf8'
    );

    assert.match(taskViews, /mission_ref/);
    assert.match(taskViews, /command_caps/);
    assert.match(dashboardTasks, /include\.has\('mission_context'\)/);
    assert.match(dashboardTasks, /include\.has\('siblings'\)/);
    assert.match(dashboardMissions, /mission_title/);
});

