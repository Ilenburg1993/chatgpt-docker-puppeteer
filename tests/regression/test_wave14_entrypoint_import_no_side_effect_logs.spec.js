// @ts-check
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

function runPureImport(/** @type {any} */ modulePath) {
    const env = { ...process.env };
    delete env.NO_COLOR;
    delete env.FORCE_COLOR;

    return spawnSync(process.execPath, ['--input-type=module', '-e', `import '${modulePath}'; console.log('OK');`], {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 5000,
        env,
    });
}

test('wave14: main entrypoint import is log-clean (no bootstrap side effects)', () => {
    const result = runPureImport('./src/main.js');
    assert.equal(result.status, 0, `main import should exit 0. stderr=${result.stderr || ''}`);
    assert.equal((result.stdout || '').trim(), 'OK', 'main import should only print OK');
    assert.equal((result.stderr || '').trim(), '', 'main import should not emit side-effect logs/warnings');
});

test('wave14: server entrypoint import is log-clean (no bootstrap side effects)', () => {
    const result = runPureImport('./src/server/main.js');
    assert.equal(result.status, 0, `server import should exit 0. stderr=${result.stderr || ''}`);
    assert.equal((result.stdout || '').trim(), 'OK', 'server import should only print OK');
    assert.equal((result.stderr || '').trim(), '', 'server import should not emit side-effect logs/warnings');
});

test('wave14: driver factory import is log-clean (no startup noise)', () => {
    const result = runPureImport('./src/driver/factory.js');
    assert.equal(result.status, 0, `factory import should exit 0. stderr=${result.stderr || ''}`);
    assert.equal((result.stdout || '').trim(), 'OK', 'factory import should only print OK');
    assert.equal((result.stderr || '').trim(), '', 'factory import should not emit side-effect logs/warnings');
});
