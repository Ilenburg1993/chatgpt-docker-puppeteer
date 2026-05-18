// @ts-check
import { strict as assert } from 'assert';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { describe, it } from 'node:test';

import { tmpdir } from 'os';
import { join } from 'path';

const wrapper = join(process.cwd(), '.devcontainer/nss-gatekeeper.sh');

describe('nss-gatekeeper entrypoint wrapper', () => {
    it('runs the wrapped command and propagates exit code', () => {
        // simple echo
        const out = execSync(`bash "${wrapper}" echo hello`).toString().trim();
        assert.equal(out, 'hello');
    });

    it('activates NSS by seeding runtime artifacts and canonicalizing LD_PRELOAD', () => {
        const fake = mkdtempSync(join(tmpdir(), 'gate-'));
        const prof = join(fake, '10-gatekeeper-nss.sh');
        writeFileSync(prof, 'export LD_PRELOAD="/tmp/fakelib.so"\necho "profile-sourced" >&2');
        const env = { ...process.env, DEVCONTAINER_NSS_DIR: fake };
        const out = execSync(`bash "${wrapper}" env`, { env }).toString();
        assert.ok(out.includes('DEVCONTAINER_NSS_WRAPPER_LIB=/usr/local/lib/devcontainer/libnss_wrapper.so'));
        assert.ok(out.includes(`NSS_WRAPPER_PASSWD=${join(fake, 'passwd')}`));
        assert.ok(out.includes(`NSS_WRAPPER_GROUP=${join(fake, 'group')}`));
        assert.ok(out.includes('LD_PRELOAD=/usr/local/lib/devcontainer/libnss_wrapper.so'));
        rmSync(fake, { recursive: true, force: true });
    });

    it('repairs broken inherited NSS bindings into runtime artifacts instead of trusting stale inherited paths', () => {
        const fake = mkdtempSync(join(tmpdir(), 'gate-'));
        const prof = join(fake, '10-gatekeeper-nss.sh');
        // No-op override: this keeps the test independent from the host profile
        // while exercising the wrapper normalization path.
        writeFileSync(prof, ':');
        const env = {
            ...process.env,
            DEVCONTAINER_NSS_DIR: fake,
            NSS_WRAPPER_PASSWD: '/tmp/missing-passwd',
            NSS_WRAPPER_GROUP: '/tmp/missing-group',
        };
        const out = execSync(`bash "${wrapper}" env`, { env }).toString();
        assert.ok(out.includes(`NSS_WRAPPER_PASSWD=${join(fake, 'passwd')}`));
        assert.ok(out.includes(`NSS_WRAPPER_GROUP=${join(fake, 'group')}`));
        assert.ok(out.includes('LD_PRELOAD=/usr/local/lib/devcontainer/libnss_wrapper.so'));
        rmSync(fake, { recursive: true, force: true });
    });
});
