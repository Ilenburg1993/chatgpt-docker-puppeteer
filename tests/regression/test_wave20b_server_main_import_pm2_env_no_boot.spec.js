// @ts-check
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('wave20b: import de src/server/main.js com env PM2 simulada não dispara bootstrap', () => {
    const result = spawnSync(
        process.execPath,
        ['--input-type=module', '-e', "import './src/server/main.js'; console.log('OK')"],
        {
            cwd: process.cwd(),
            env: {
                ...process.env,
                NODE_APP_INSTANCE: '0',
                PM2_JSON_PROCESSING: 'true',
                PM2_HOME: '/tmp/pm2',
                pm_exec_path: '/tmp/not-server-main.js',
                MAESTRO_ENTRY_AUTOSTART: 'false',
            },
            encoding: 'utf8',
            timeout: 3000,
        }
    );

    assert.equal(result.status, 0, `import deve sair 0. stderr=${result.stderr || ''}`);
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    assert.match(output, /\bOK\b/, 'stdout deve conter OK');
    assert.doesNotMatch(output, /\[BOOT\]|Canonical Bootstrap|MISSION CONTROL PRIME ONLINE/i);
});
