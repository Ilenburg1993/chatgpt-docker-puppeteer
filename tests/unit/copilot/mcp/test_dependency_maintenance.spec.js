// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { runDependencyNativeSmoke } from '#copilot/mcp/public/maintenance/dependencies/native-smoke';
import { buildMcpChildEnvironment } from '#copilot/mcp/public/process/environment';
import {
    readDeclaredNpmVersionFromPackageText,
    runFixedDependencyMaintenanceCommandForTests,
    summarizeInstallScriptPolicy,
} from '#copilot/testing/mcp/maintenance';

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
                {
                    name: 'unexpected-native-package',
                    changes: [{ key: 'unexpected-native-package@1.0.0', change: 'pending' }],
                },
                { name: 'esbuild', changes: [{ key: 'esbuild@0.28.2', change: 'allowed' }] },
            ],
        });
        assert.deepEqual(policy.pending, ['node-pty', 'unexpected-native-package']);
        assert.deepEqual(policy.trustedPending, ['node-pty']);
        assert.deepEqual(policy.untrustedPending, ['unexpected-native-package']);
    });

    it('cancels a fixed maintenance subprocess only after the child close is observed', async () => {
        const controller = new AbortController();
        const startedAt = Date.now();
        const command = runFixedDependencyMaintenanceCommandForTests(
            process.execPath,
            ['-e', 'setInterval(() => {}, 1000)'],
            {
                cwd: process.cwd(),
                timeoutMs: 30_000,
                signal: controller.signal,
            },
        );
        setTimeout(() => controller.abort(), 75).unref();
        const result = await command;
        assert.equal(result.success, false);
        assert.equal(result.cancelled, true);
        assert.equal(result.timedOut, false);
        assert.ok(result.durationMs < 5_000, JSON.stringify(result, null, 2));
        assert.ok(Date.now() - startedAt < 5_000, JSON.stringify(result, null, 2));
    });

    it('proves currently declared native/runtime-sensitive dependencies are loadable', async () => {
        const result = await runDependencyNativeSmoke({
            workspaceRoot: process.cwd(),
            childEnvironment: buildMcpChildEnvironment({ parentEnv: process.env }).env,
        });
        assert.equal(result.success, true, JSON.stringify(result, null, 2));
        assert.ok(result.checkedCount >= 3);
        const names = new Set(result.checks.map((check) => String(check['name'])));
        assert.equal(names.has('better-sqlite3'), true);
        assert.equal(names.has('node-pty'), true);
        assert.equal(names.has('@lancedb/lancedb'), true);
    });
});
