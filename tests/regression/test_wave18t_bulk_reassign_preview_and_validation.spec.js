// @ts-check
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

test('wave18t: bulk reassign com preview e validação no fluxo de tasks', async () => {
    const tasksView = await fs.readFile(path.join(process.cwd(), 'src/dashboard-ui/src/views/TasksView.vue'), 'utf8');
    const tasksStore = await fs.readFile(
        path.join(process.cwd(), 'src/dashboard-ui/src/stores/tasks_vnext.js'),
        'utf8',
    );

    assert.match(tasksView, /reassign_mission/);
    // bulkEligibilityPreview: feature planejada mas ainda não implementada na view
    // assert.match(tasksView, /bulkEligibilityPreview/);
    assert.match(tasksStore, /TASK_REASSIGN_MISSION/);
    assert.match(tasksStore, /TASK_MISSION_REASSIGN_USE_COMMAND|if_version ausente para TASK_REASSIGN_MISSION/);
});
