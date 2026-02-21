import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

test('wave18: mission/task control services aplicam guard pause-to-edit', async () => {
    const missionControl = await fs.readFile(
        path.join(process.cwd(), 'src/server/domain/mission_control_service.js'),
        'utf8'
    );
    const taskControl = await fs.readFile(
        path.join(process.cwd(), 'src/server/domain/task_control_service.js'),
        'utf8'
    );

    assert.match(missionControl, /MISSION_EDIT_REQUIRES_PAUSED|MISSION_POLICY_REQUIRES_PAUSED|EDITABLE_MISSION/);
    assert.match(taskControl, /_assertPauseToEditTask|TASK_EDIT_REQUIRES_PAUSED/);
});
