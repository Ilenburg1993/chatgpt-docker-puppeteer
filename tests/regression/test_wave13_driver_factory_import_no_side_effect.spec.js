// @ts-check
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('wave13: factory import is process-handle safe (no startup timer side effects)', () => {
    const result = spawnSync(
        process.execPath,
        ['--input-type=module', '-e', "import './src/driver/factory.js'; console.log('ok');"],
        {
            cwd: process.cwd(),
            encoding: 'utf8',
            timeout: 3000,
        },
    );

    assert.equal(result.status, 0, `factory import should exit 0. stderr=${result.stderr || ''}`);
    assert.match(result.stdout || '', /ok/, 'factory import should complete and print ok');
});
