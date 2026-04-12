// @ts-check
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

test('wave18t: TASK_REASSIGN_MISSION exige estado PAUSED ou READY não iniciada', async () => {
    const taskControl = await fs.readFile(
        path.join(process.cwd(), 'src/server/domain/task_control_service.js'),
        'utf8',
    );
    const controlCommand = await fs.readFile(
        path.join(process.cwd(), 'src/server/domain/control_command_service.js'),
        'utf8',
    );

    assert.match(taskControl, /TASK_REASSIGN_REQUIRES_PAUSED_OR_READY_NOT_STARTED/);
    assert.match(taskControl, /function reassignTaskMissionCommand/);
    assert.match(controlCommand, /TASK_REASSIGN_MISSION/);
});
