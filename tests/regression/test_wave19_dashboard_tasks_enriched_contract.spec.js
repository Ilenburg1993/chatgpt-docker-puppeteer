// @ts-check
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

test('wave19: dashboard tasks/missions mantém contrato enriquecido de contexto', async () => {
    const dashboardTasks = await fs.readFile(
        path.join(process.cwd(), 'src/server/api/controllers/dashboard_tasks.js'),
        'utf8',
    );
    const dashboardMissions = await fs.readFile(
        path.join(process.cwd(), 'src/server/api/controllers/dashboard_missions.js'),
        'utf8',
    );
    const taskViews = await fs.readFile(path.join(process.cwd(), 'src/server/api/utils/task_views.js'), 'utf8');

    assert.match(dashboardTasks, /LEFT JOIN missions/);
    assert.match(dashboardTasks, /include\.has\('mission_context'\)/);
    assert.match(dashboardTasks, /include\.has\('siblings'\)/);

    assert.match(dashboardMissions, /mission_title/);
    assert.match(dashboardMissions, /taskRowToListItem/);

    assert.match(taskViews, /mission_ref/);
    assert.match(taskViews, /command_caps/);
    assert.match(taskViews, /buildTaskCommandCaps/);
});
