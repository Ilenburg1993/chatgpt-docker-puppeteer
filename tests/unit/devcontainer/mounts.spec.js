// @ts-check
import { strict as assert } from 'assert';
import { execSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { describe, it } from 'node:test';
import { tmpdir } from 'os';
import { join } from 'path';

// helper that sources post-create.sh and then invokes a named function with args
import { spawnSync } from 'child_process';

function runPostCreateHelper(/** @type {any} */ func, /** @type {any[]} */ args = [], env = {}) {
    // create a small wrapper script to avoid quoting headaches
    // we sometimes need to modify PATH for the helper function only while
    // keeping the original PATH available during the initial sourcing phase.
    // the caller can supply a TEST_PATH value via env; if present we'll
    // export it *after* sourcing so init logic (which may call `date` etc.)
    // still works even when the test wants to hide `mount` from the helper.
    const script = `
#!/usr/bin/env bash
set -euo pipefail
# keep the path visible for the bootstrap phase
ORIG_PATH="$PATH"
source "${process.cwd()}/.devcontainer/scripts/post-create.sh"
# override PATH only for the function invocation if requested
if [[ -n "\${TEST_PATH:-}" ]]; then
    export PATH="$TEST_PATH"
fi
${func} ${args.map((a) => `'${a}'`).join(' ')}
`;
    const tmp = mkdtempSync(join(tmpdir(), 'helper-')) + '.sh';
    writeFileSync(tmp, script);
    try {
        // call bash via absolute path so tests can safely mutate PATH without
        // accidentally removing the shell itself (the missing-mount case filters
        // out "/bin" because it contains the real mount binary).
        const res = spawnSync('/bin/bash', [tmp], { env: { ...process.env, ...env }, encoding: 'utf8' });
        // if the spawn failed (res.status === null) we still return the object so
        // callers can inspect stdout/stderr and error code. helpers generally
        // ignore nonzero status but the debugging output can help.
        return { stdout: res.stdout || '', stderr: res.stderr || '', status: res.status };
    } finally {
        try {
            rmSync(tmp);
        } catch {
            /* ignore */
        }
    }
}

// create a fake binary in a temp directory and prepend to PATH
function withFakeBinary(/** @type {any} */ name, /** @type {any} */ content, /** @type {any} */ fn) {
    const binDir = mkdtempSync(join(tmpdir(), 'fakebin-'));
    const pathFile = join(binDir, name);
    writeFileSync(pathFile, content, { mode: 0o755 });
    const oldPath = process.env.PATH;
    process.env.PATH = `${binDir}:${oldPath}`;
    try {
        return fn();
    } finally {
        process.env.PATH = oldPath;
        try {
            rmSync(binDir, { recursive: true, force: true });
        } catch {}
    }
}

// shorthand for creating a fake stat that returns a constant UID
function fakeStat(/** @type {any} */ uid) {
    return `#!/usr/bin/env bash
        # ignore args, always print uid
        echo ${uid}
    `;
}

// shorthand for creating a fake mount output
function fakeMount(/** @type {any} */ output) {
    return `#!/usr/bin/env bash
        cat <<'MOUNTOUT'
${output}
MOUNTOUT
    `;
}

// tests

describe('devcontainer mount helpers', () => {
    it('warns when workspace owner differs', () => {
        const project = '/some/dir';
        const fake = fakeStat(9999);
        const result = withFakeBinary('stat', fake, () =>
            runPostCreateHelper('check_chown_contract', [project, '1000']),
        );
        assert(result.stderr.includes('chown recursivo é proibido'));
    });

    it('is silent when ownership matches', () => {
        const project = '/other';
        const fake = fakeStat(1000);
        const result = withFakeBinary('stat', fake, () =>
            runPostCreateHelper('check_chown_contract', [project, '1000']),
        );
        assert.equal(result.stderr.trim(), '');
    });

    it('audit_mounts handles missing mount command', () => {
        // filter PATH for the helper only; leave the test process untouched so
        // bootstrap helpers like "date" continue to be available.
        const parts = (process.env.PATH ?? '').split(':');
        const filtered = parts.filter((d) => {
            try {
                return !existsSync(join(d, 'mount'));
            } catch {
                return true; // if path lookup fails, keep the entry
            }
        });
        const res = runPostCreateHelper('audit_mounts', ['/any', 'user'], { TEST_PATH: filtered.join(':') });
        assert(res.stdout.includes('mount command not available'));
    });

    it('audit_mounts prints provided mount lines', () => {
        const fake = fakeMount('/dev/sda1 on /workspaces/foo ext4 rw,relatime');
        const res = withFakeBinary('mount', fake, () =>
            runPostCreateHelper('audit_mounts', ['/workspaces/foo', 'user']),
        );
        assert(res.stdout.includes('/dev/sda1'));
        assert(res.stdout.includes('/workspaces/foo'));
    });
});

// additional sanity tests against the Dockerfile to ensure mount policies are documented

describe('Dockerfile mount documentation', () => {
    it('contains socket bind-mount comment and cross-ref', () => {
        const docker = execSync('cat .devcontainer/Dockerfile', { encoding: 'utf8' });
        assert(docker.includes('O socket real é sempre fornecido pelo runtime'));
        assert(docker.includes('políticas de mount são auditadas de forma centralizada'));
    });
});

describe('devcontainer NSS bootstrap contract', () => {
    it('uses a complete stable baseline before runtime hooks materialize /tmp artifacts', () => {
        const config = execSync('cat .devcontainer/devcontainer.json', { encoding: 'utf8' });
        assert(config.includes('"LD_PRELOAD": "${containerEnv:LD_PRELOAD}"'));
        assert(config.includes('"NSS_WRAPPER_PASSWD": "/etc/passwd"'));
        assert(config.includes('"NSS_WRAPPER_GROUP": "/etc/group"'));
        assert(!config.includes('"NSS_WRAPPER_PASSWD": "/tmp/devcontainer-nss/passwd"'));
        assert(!config.includes('"NSS_WRAPPER_GROUP": "/tmp/devcontainer-nss/group"'));
    });

    it('omits an empty features block to avoid generated BASE_IMAGE wrapper warnings', () => {
        const config = execSync('cat .devcontainer/devcontainer.json', { encoding: 'utf8' });
        assert(!/^\s*"features"\s*:/m.test(config));
        assert(config.includes('Dockerfile intermediário desnecessário'));
    });
});
