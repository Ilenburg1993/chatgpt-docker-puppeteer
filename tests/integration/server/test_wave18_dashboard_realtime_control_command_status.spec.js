// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

test('wave18: realtime de comando usa canal control:command_status (server + UI)', async () => {
    const controlService = await fs.readFile(
        path.join(process.cwd(), 'src/server/domain/control_command_service.js'),
        'utf8'
    );
    const socket = await fs.readFile(path.join(process.cwd(), 'src/server/engine/socket.js'), 'utf8');
    const ssotRealtime = await fs.readFile(
        path.join(process.cwd(), 'src/dashboard-ui/src/composables/useSsotRealtime.js'),
        'utf8'
    );

    assert.match(controlService, /control:command_status/);
    assert.match(socket, /notify\(event, data\)/);
    assert.match(ssotRealtime, /subscribe\('control:command_status'/);
});
