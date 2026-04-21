// @ts-check
import { strict as assert } from 'assert';
import { execSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { describe, it } from 'node:test';

import { tmpdir } from 'os';
import { join } from 'path';

// helper to run post-start with controlled env
function runPostStart(env = {}) {
    const script = join(process.cwd(), '.devcontainer/scripts/post-start.sh');
    // ensure health file removed
    try {
        rmSync('/tmp/devcontainer-health.status');
    } catch {}
    return execSync(`bash "${script}"`, { env: { ...process.env, ...env } }).toString();
}

describe('post-start.sh repairs and status', () => {
    it('creates health.status=ok when environment is healthy', () => {
        const out = runPostStart({ DEVCONTAINER_NSS_DIR: mkdtempSync(join(tmpdir(), 'nss-')) });
        const status = execSync('cat /tmp/devcontainer-health.status').toString().trim();
        assert.equal(status, 'ok');
    });

    it('honors DEVCONTAINER_MAKE_TIMEOUT env', () => {
        const dir = mkdtempSync(join(tmpdir(), 'nss-'));
        const out = runPostStart({ DEVCONTAINER_NSS_DIR: dir, DEVCONTAINER_MAKE_TIMEOUT: '1' });
        // script should still run and create health file regardless of result
        const status = execSync('cat /tmp/devcontainer-health.status').toString().trim();
        assert(['ok', 'degraded'].includes(status), 'health file should exist even if degraded');
    });

    it('skips sshd check when disabled', () => {
        const dir = mkdtempSync(join(tmpdir(), 'nss-'));
        const out = runPostStart({ DEVCONTAINER_NSS_DIR: dir, DEVCONTAINER_ENABLE_SSHD_CHECK: 'false' });
        assert(out.includes('SSHD check skipped'));
    });

    it('does not attempt repair when running as root (UID 0)', () => {
        const dir = mkdtempSync(join(tmpdir(), 'nss-'));
        // simulate uid 0 by overriding `id` in PATH with a directory
        const fakeDir = mkdtempSync(join(tmpdir(), 'fakeid-'));
        const fakeId = join(fakeDir, 'id');
        writeFileSync(fakeId, '#!/bin/sh\necho 0\n', { mode: 0o755 });
        const env = { DEVCONTAINER_NSS_DIR: dir, PATH: fakeDir + ':' + process.env.PATH };
        // remove files so repair would normally run
        try {
            rmSync(join(dir, 'passwd'));
        } catch {}
        runPostStart(env);
        // since uid was 0, the repair should have been skipped; file may still be missing
        const exists = existsSync(join(dir, 'passwd'));
        assert(!exists, 'passwd should not be created when UID=0');
    });

    it('logs LD_PRELOAD and warns when empty', () => {
        const dir = mkdtempSync(join(tmpdir(), 'nss-'));
        const out = runPostStart({ DEVCONTAINER_NSS_DIR: dir, LD_PRELOAD: '' });
        assert(out.includes('LD_PRELOAD is empty'));
        const status = execSync('cat /tmp/devcontainer-health.status').toString().trim();
        assert(['ok', 'degraded'].includes(status));
    });

    it('repairs missing NSS files automatically', () => {
        const dir = mkdtempSync(join(tmpdir(), 'nss-'));
        // remove any files to force repair
        try {
            rmSync(join(dir, 'passwd'));
        } catch {}
        try {
            rmSync(join(dir, 'group'));
        } catch {}
        runPostStart({ DEVCONTAINER_NSS_DIR: dir });
        const passwd = execSync(`cat ${join(dir, 'passwd')}`).toString();
        assert(passwd.includes(':x:'));
    });
});
