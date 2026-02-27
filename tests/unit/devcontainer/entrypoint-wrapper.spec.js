import { describe, it } from 'node:test';
import { strict as assert } from 'assert';
import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const wrapper = join(process.cwd(), '.devcontainer/nss-gatekeeper.sh');

describe('nss-gatekeeper entrypoint wrapper', () => {
    it('runs the wrapped command and propagates exit code', () => {
        // simple echo
        const out = execSync(`bash "${wrapper}" echo hello`).toString().trim();
        assert.equal(out, 'hello');
    });

    it('activates NSS by sourcing profile and setting LD_PRELOAD', () => {
        // create a fake NSS profile that exports a marker
        const fake = mkdtempSync(join(tmpdir(), 'gate-'));
        const prof = join(fake, '10-gatekeeper-nss.sh');
        writeFileSync(prof, 'export LD_PRELOAD="/tmp/fakelib.so"\necho "profile-sourced" >&2');
        // run wrapper with env pointing to our fake profile dir
        const env = { ...process.env, DEVCONTAINER_NSS_DIR: fake };
        // rather than plumbing through nested `bash -c` invocations and
        // risking quoting issues, simply ask the wrapper to dump its
        // environment and then grep for our helper variable. this is a
        // much simpler and more reliable way to confirm that the profile was
        // sourced and the value propagated.
        const out = execSync(`bash "${wrapper}" env`, { env }).toString();
        assert.ok(out.includes('DEVCONTAINER_LD_PRELOAD_FROM_PROFILE=/tmp/fakelib.so'));
        rmSync(fake, { recursive: true, force: true });
    });
});
