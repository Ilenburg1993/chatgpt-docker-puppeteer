// @ts-check
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

test('wave19: stores vNext mantêm índice cruzado task↔mission e sincronização', async () => {
    const tasksStore = await fs.readFile(
        path.join(process.cwd(), 'src/dashboard-ui/src/stores/tasks_vnext.js'),
        'utf8',
    );
    const missionsStore = await fs.readFile(
        path.join(process.cwd(), 'src/dashboard-ui/src/stores/missions_vnext.js'),
        'utf8',
    );

    assert.match(tasksStore, /taskIdsByMissionId/);
    assert.match(tasksStore, /rebuildMissionIndex/);
    assert.match(tasksStore, /getTasksByMissionId/);
    assert.match(tasksStore, /applyRealtimeUpdatesBatch/);

    assert.match(missionsStore, /_syncMissionAndTasksContext/);
    assert.match(missionsStore, /MISSION_CREATE/);
    assert.match(missionsStore, /MISSION_PATCH/);
    assert.match(missionsStore, /MISSION_CANCEL/);
});
