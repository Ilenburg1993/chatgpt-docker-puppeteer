// @ts-check
import { describe, it } from 'node:test';
import { strict as assert } from 'assert';
import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const script = join(process.cwd(), '.devcontainer/scripts/post-create.sh');

function runPostCreate(env = {}) {
    // tests run as UID 1000 so identity contract would abort; allow bypass
    const merged = { ...process.env, SKIP_IDENTITY_CHECK: 'true', ...env };
    // remove idempotence marker so each invocation runs fresh
    try {
        rmSync('/tmp/post-create.done');
    } catch {}
    // capture both stdout and stderr for diagnostic checks
    return execSync(`bash "${script}" 2>&1`, { env: merged }).toString();
}

describe('post-create.sh NSS checks', () => {
    it('regenerates NSS passwd when UID entry mismatches', () => {
        const dir = mkdtempSync(join(tmpdir(), 'nss-'));
        const passwdFile = join(dir, 'passwd');
        // create a bogus entry with wrong UID
        writeFileSync(passwdFile, 'nobody:x:9999:9999:nobody:/home/nobody:/bin/bash\n');
        // run script pointing to our dir
        runPostCreate({ DEVCONTAINER_NSS_DIR: dir });
        const content = execSync(`cat "${passwdFile}"`).toString();
        const uid = execSync('id -u').toString().trim();
        assert(content.includes(`:x:${uid}:`), 'passwd should contain current UID');
        rmSync(dir, { recursive: true, force: true });
    });

    it('exits non-zero when libnss_wrapper missing', () => {
        const dir = mkdtempSync(join(tmpdir(), 'nss-'));
        const bin = mkdtempSync(join(tmpdir(), 'bin-'));
        // fake ldconfig that returns no output
        writeFileSync(join(bin, 'ldconfig'), '#!/bin/sh\nexit 1');
        chmodSync(join(bin, 'ldconfig'), 0o755);

        try {
            execSync(`bash -c 'DEVCONTAINER_NSS_DIR=${dir} PATH=${bin}:$PATH bash "${script}"'`, {
                stdio: 'pipe',
            });
            assert.fail('Expected post-create to throw when lib missing');
        } catch (err) {
            assert(err.status !== 0, 'exit code should be non-zero');
        } finally {
            rmSync(dir, { recursive: true, force: true });
            rmSync(bin, { recursive: true, force: true });
        }
    });

    it('warns about empty LD_PRELOAD value', () => {
        const dir = mkdtempSync(join(tmpdir(), 'nss-'));
        const out = runPostCreate({ DEVCONTAINER_NSS_DIR: dir, LD_PRELOAD: '' });
        assert(out.includes('LD_PRELOAD is empty'), 'should warn about empty LD_PRELOAD');
        rmSync(dir, { recursive: true, force: true });
    });
});
