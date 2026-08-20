// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { readDeclaredNpmVersionFromPackageText, summarizeInstallScriptPolicy } from '#copilot/mcp/control-plane';
import { runDependencyNativeSmoke } from '#copilot/mcp/scripts';

describe('MCP dependency maintenance', () => {
    it('reads the exact npm version from packageManager without confusing it with a dependency', () => {
        assert.equal(readDeclaredNpmVersionFromPackageText('{"packageManager":"npm@12.0.2"}'), '12.0.2');
        assert.equal(readDeclaredNpmVersionFromPackageText('{"packageManager":"pnpm@11.1.0"}'), null);
        assert.equal(readDeclaredNpmVersionFromPackageText('{}'), null);
        assert.equal(readDeclaredNpmVersionFromPackageText('{"packageManager":"npm@latest"}'), null);
    });


    it('classifies install-script policy without trusting newly introduced package names', () => {
        const policy = summarizeInstallScriptPolicy({
            allowScripts: [
                { name: 'node-pty', changes: [{ key: 'node-pty@1.1.0', change: 'pending' }] },
                { name: 'unexpected-native-package', changes: [{ key: 'unexpected-native-package@1.0.0', change: 'pending' }] },
                { name: 'esbuild', changes: [{ key: 'esbuild@0.28.2', change: 'allowed' }] },
            ],
        });
        assert.deepEqual(policy.pending, ['node-pty', 'unexpected-native-package']);
        assert.deepEqual(policy.trustedPending, ['node-pty']);
        assert.deepEqual(policy.untrustedPending, ['unexpected-native-package']);
    });

    it('proves currently declared native/runtime-sensitive dependencies are loadable', async () => {
        const result = await runDependencyNativeSmoke();
        assert.equal(result.success, true, JSON.stringify(result, null, 2));
        assert.ok(result.checkedCount >= 3);
        const names = new Set(result.checks.map((check) => String(check['name'])));
        assert.equal(names.has('better-sqlite3'), true);
        assert.equal(names.has('node-pty'), true);
        assert.equal(names.has('@lancedb/lancedb'), true);
    });
});
