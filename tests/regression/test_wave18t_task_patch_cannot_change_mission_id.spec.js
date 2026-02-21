import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

test('wave18t: TASK_PATCH bloqueia mudança de mission_id via patch genérico', async () => {
    const taskControl = await fs.readFile(
        path.join(process.cwd(), 'src/server/domain/task_control_service.js'),
        'utf8'
    );

    assert.match(taskControl, /_patchTouchesMissionBinding/);
    assert.match(taskControl, /TASK_MISSION_REASSIGN_USE_COMMAND/);
});

