import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { resolveServerMode, shutdown } from '#main';
import { shutdown as shutdownDriverFactory } from '#driver/factory';

const execFileAsync = promisify(execFile);

after(async () => {
    await shutdownDriverFactory();
});

test('wave2: server mode matrix resolves integrated/split/disabled', () => {
    const original = process.env.SERVER_MODE;
    try {
        process.env.SERVER_MODE = 'integrated';
        assert.equal(resolveServerMode(), 'integrated');

        process.env.SERVER_MODE = 'split';
        assert.equal(resolveServerMode(), 'split');

        process.env.SERVER_MODE = 'disabled';
        assert.equal(resolveServerMode(), 'disabled');
    } finally {
        if (original === undefined) {
            delete process.env.SERVER_MODE;
        } else {
            process.env.SERVER_MODE = original;
        }
    }
});

test('wave2: shutdown does not call process.exit by default', async () => {
    const originalExit = process.exit;
    let exitCalls = 0;

    process.exit = () => {
        exitCalls++;
        throw new Error('process.exit should not be called when exitOnComplete=false');
    };

    try {
        const result = await shutdown({}, { exitOnComplete: false });
        assert.equal(result.ok, true);
        assert.equal(exitCalls, 0);
    } finally {
        process.exit = originalExit;
    }
});

test('wave2: env bootstrap honors .env.local precedence and remains idempotent', async (t) => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'wave2-env-bootstrap-'));
    t.after(async () => {
        await rm(tmpDir, { recursive: true, force: true });
    });

    await writeFile(path.join(tmpDir, '.env'), 'WAVE2_ENV_BOOTSTRAP_TEST=from_env\n', 'utf8');
    await writeFile(path.join(tmpDir, '.env.local'), 'WAVE2_ENV_BOOTSTRAP_TEST=from_local\n', 'utf8');

    const moduleUrl = pathToFileURL(path.join(process.cwd(), 'src/core/env_bootstrap.js')).href;
    const code = `
        const mod = ${JSON.stringify(moduleUrl)};
        await import(mod);
        await import(mod);
        console.log(process.env.WAVE2_ENV_BOOTSTRAP_TEST || '');
    `;

    const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', code], {
        cwd: tmpDir,
        env: { ...process.env },
    });

    const lines = stdout
        .trim()
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);
    const lastLine = lines[lines.length - 1] || '';

    assert.equal(lastLine, 'from_local');
});
