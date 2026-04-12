// @ts-check
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('wave20b: import de src/main.js com DAEMON_MODE=true não dispara boot sem autostart explícito', () => {
    const result = spawnSync(
        process.execPath,
        ['--input-type=module', '-e', "import './src/main.js'; console.log('OK')"],
        {
            cwd: process.cwd(),
            env: {
                ...process.env,
                DAEMON_MODE: 'true',
                MAESTRO_ENTRY_AUTOSTART: 'false',
            },
            encoding: 'utf8',
            timeout: 3000,
        },
    );

    assert.equal(result.status, 0, `import deve sair 0. stderr=${result.stderr || ''}`);
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    assert.match(output, /\bOK\b/, 'stdout deve conter OK');
    assert.doesNotMatch(output, /Iniciando boot sequence|\[BOOT\]|MAESTRO SINGULARITY EDITION/i);
});
