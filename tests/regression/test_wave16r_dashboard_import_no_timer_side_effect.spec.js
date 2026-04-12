// @ts-check
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('wave16r: dashboard controller import does not start token cleanup timer', () => {
    const result = spawnSync(
        process.execPath,
        [
            '--input-type=module',
            '-e',
            `
import './src/server/api/controllers/dashboard.js';
import { isPeriodicCleanupRunning } from './src/infra/db/token_blocklist.js';
console.log(isPeriodicCleanupRunning() ? 'RUNNING' : 'STOPPED');
process.exit(0);
`.trim(),
        ],
        {
            cwd: process.cwd(),
            encoding: 'utf8',
            timeout: 10000,
            env: { ...process.env, DASHBOARD_AUTH_REQUIRED: 'false', DASHBOARD_SOCKET_AUTH_REQUIRED: 'false' },
        },
    );

    assert.equal(result.status, 0, `dashboard controller import must exit 0. stderr=${result.stderr || ''}`);
    assert.equal((result.stdout || '').trim(), 'STOPPED');
});
