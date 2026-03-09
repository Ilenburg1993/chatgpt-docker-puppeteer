// @ts-check
import { strict as assert } from 'assert';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { describe, it } from 'node:test';
import { tmpdir } from 'os';
import { join } from 'path';

// Helper that returns the evaluated LD_PRELOAD after sourcing the gatekeeper snippet
function runGatekeeper(/** @type {any} */ env = {}) {
    // embed the profile logic we maintain in the repo and write it to a temporary
    // shell script to avoid any quoting/escaping issues when passing to bash.
    const scriptContent = `
NSS_BASE_DIR="$(mktemp -d)"
PASSWD_FILE="$NSS_BASE_DIR/passwd"
GROUP_FILE="$NSS_BASE_DIR/group"
NSS_SO_PATH="/tmp/fakelib.so"
# create fake library
[ -f "$NSS_SO_PATH" ] || touch "$NSS_SO_PATH"
LD_PRELOAD="${env.LD_PRELOAD || ''}"

# regenerate passwd if missing or outdated
CURRENT_UID="$(id -u)"
CURRENT_GID="$(id -g)"
CURRENT_USER="$(id -un || echo unknown)"
[ "$CURRENT_USER" = unknown ] && CURRENT_USER=node
if ! grep -q "^\${CURRENT_USER}:x:\${CURRENT_UID}:" "$PASSWD_FILE" 2>/dev/null; then
    cat > "$PASSWD_FILE.tmp" <<'PASSWD_HERE'
\${CURRENT_USER}:x:\${CURRENT_UID}:\${CURRENT_GID}:\${CURRENT_USER} user:\${HOME}/bin/bash
PASSWD_HERE
    mv "$PASSWD_FILE.tmp" "$PASSWD_FILE"
    # rebuild groups always
    {
        id -G | xargs -n1 getent group 2>/dev/null | cut -d: -f1,2,3 | sed 's/$/:/' | grep -v '^::$' || true
    } > "$GROUP_FILE.tmp" && mv "$GROUP_FILE.tmp" "$GROUP_FILE"
fi

# activation logic from profile
if [ -f "$PASSWD_FILE" ] && { [ -f "$NSS_SO_PATH" ] || ldconfig -p 2>/dev/null | grep -q libnss_wrapper.so; }; then
    export NSS_WRAPPER_PASSWD="$PASSWD_FILE"
    export NSS_WRAPPER_GROUP="$GROUP_FILE"
    NSS_LIB="$NSS_SO_PATH"
    case ":\${LD_PRELOAD}:" in
        *":\${NSS_LIB}:"*) ;;
        *) export LD_PRELOAD="\${NSS_LIB}\${LD_PRELOAD:+:\${LD_PRELOAD}}";;
    esac
fi

echo "$LD_PRELOAD"`;

    const tmpFile = mkdtempSync(join(tmpdir(), 'gatekeeper-')) + '.sh';
    writeFileSync(tmpFile, scriptContent);

    // ensure HOME is available and merge with provided env
    const fullEnv = { ...process.env, HOME: process.env.HOME || '', ...env };

    try {
        // execute the temp script directly
        return execSync(`bash "${tmpFile}"`, { env: fullEnv }).toString().trim();
    } finally {
        try {
            rmSync(tmpFile);
        } catch {} // ignore cleanup errors
    }
}

describe('NSS gatekeeper snippet', () => {
    it('prepends absolute path when LD_PRELOAD empty', () => {
        const out = runGatekeeper({});
        assert.equal(out, '/tmp/fakelib.so');
    });

    it('does not duplicate when already present', () => {
        const initial = '/tmp/fakelib.so:/some/other';
        const out = runGatekeeper({ LD_PRELOAD: initial });
        assert.equal(out, initial);
    });

    it('regenerates passwd when UID not present', () => {
        const tmpdirBase = mkdtempSync(join(tmpdir(), 'nss-test-'));
        try {
            const pwfile = join(tmpdirBase, 'passwd');
            writeFileSync(pwfile, 'bogus');
            // prepare JS values for later assertion
            const currentUser = execSync('id -un || echo unknown').toString().trim() || 'node';
            const currentUid = execSync('id -u').toString().trim();
            // simulate by setting NSS_BASE_DIR to tmpdirBase in env
            const script = `
NSS_BASE_DIR="${tmpdirBase}"
PASSWD_FILE="$NSS_BASE_DIR/passwd"
CURRENT_UID="$(id -u)"
CURRENT_GID="$(id -g)"
CURRENT_USER="$(id -un || echo unknown)"
[ "$CURRENT_USER" = unknown ] && CURRENT_USER=node
if ! grep -q "^\${CURRENT_USER}:x:\${CURRENT_UID}:" "$PASSWD_FILE" 2>/dev/null; then
    cat > "$PASSWD_FILE.tmp" <<'PASSWD_HERE'
\${CURRENT_USER}:x:\${CURRENT_UID}:\${CURRENT_GID}:\${CURRENT_USER} user:\${HOME}/bin/bash
PASSWD_HERE
    mv "$PASSWD_FILE.tmp" "$PASSWD_FILE"
fi
cat "$PASSWD_FILE"`;
            const result = execSync(`bash -c '${script}'`, {
                env: { ...process.env, HOME: process.env.HOME },
            }).toString();
            assert(result.includes(`${currentUser}:x:${currentUid}`));
        } finally {
            rmSync(tmpdirBase, { recursive: true, force: true });
        }
    });

    it('warns when LD_PRELOAD size exceeds limit', () => {
        const long = 'a'.repeat(5000);
        let out = '';
        try {
            out = execSync(`LD_PRELOAD=${long} bash .devcontainer/nss-gatekeeper.sh true 2>&1`, {
                env: process.env,
            }).toString();
        } catch (e) {
            const err = /** @type {any} */ (e);
            out = err.stdout ? err.stdout.toString() : '';
        }
        assert(out.includes('exceeds kernel limit'));
    });
});
