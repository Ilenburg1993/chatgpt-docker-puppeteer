// @ts-check

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'vitest';

import {
    createModelGatewayLiveRunEnvironmentAuthority,
    readModelGatewayLiveCommandLifecycleForTests,
    resetModelGatewayLiveCommandLifecycleForTests,
    runModelGatewayLiveCommand,
} from '#copilot/testing/mcp/integrations/model-gateway/live-runs';

/** @type {string[]} */
const temporaryDirectories = [];

beforeEach(() => resetModelGatewayLiveCommandLifecycleForTests());
afterEach(async () => {
    resetModelGatewayLiveCommandLifecycleForTests();
    await Promise.all(
        temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    );
});

/** @param {string} source */
async function createReadinessScript(source) {
    const root = await mkdtemp(join(tmpdir(), 'llmb-command-lifecycle-'));
    temporaryDirectories.push(root);
    const scriptPath = join(root, 'scripts/model-gateway/commands/model-gateway-live-readiness.mjs');
    await mkdir(dirname(scriptPath), { recursive: true });
    await writeFile(scriptPath, source, 'utf8');
    return {
        workspace: /** @type {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} */ (
            /** @type {unknown} */ ({ workspaceRoot: root })
        ),
        authority: createModelGatewayLiveRunEnvironmentAuthority({ PATH: process.env.PATH, HOME: process.env.HOME }),
    };
}

function readinessLifecycle() {
    return readModelGatewayLiveCommandLifecycleForTests()['readiness'];
}

describe('Model Gateway live command lifecycle accounting', () => {
    it('classifies an abnormal readiness subprocess exit and drains the current count', async () => {
        const fixture = await createReadinessScript('process.exit(17);\n');
        const result = await runModelGatewayLiveCommand({
            workspace: fixture.workspace,
            command: 'readiness',
            args: [],
            timeoutMs: 5_000,
            environmentAuthority: fixture.authority,
        });

        assert.equal(result.success, false);
        assert.equal(result.exitCode, 17);
        assert.equal(result.timedOut, false);
        assert.equal(result.aborted, false);
        assert.equal(result.outputLimitExceeded, false);
        assert.match(String(result.error), /exited with code 17/u);
        assert.deepEqual(readinessLifecycle(), {
            created: 1,
            terminated: 1,
            current: 0,
            cancelled: 0,
            timedOut: 0,
            outputLimited: 0,
            abnormalExit: 1,
        });
    });

    it('classifies bounded output pressure and terminates the readiness process tree', async () => {
        const fixture = await createReadinessScript(
            "process.stdout.write('x'.repeat(256 * 1024)); setInterval(() => {}, 1000);\n",
        );
        const result = await runModelGatewayLiveCommand({
            workspace: fixture.workspace,
            command: 'readiness',
            args: [],
            timeoutMs: 5_000,
            maxOutputBytes: 64 * 1024,
            environmentAuthority: fixture.authority,
        });

        assert.equal(result.success, false);
        assert.equal(result.outputLimitExceeded, true);
        assert.ok(result.stdoutBytesObserved > 64 * 1024);
        assert.ok(Buffer.byteLength(result.stdout, 'utf8') <= 64 * 1024);
        assert.match(String(result.error), /exceeded 65536 output bytes/u);
        assert.deepEqual(readinessLifecycle(), {
            created: 1,
            terminated: 1,
            current: 0,
            cancelled: 0,
            timedOut: 0,
            outputLimited: 1,
            abnormalExit: 0,
        });
    });

    it('classifies a readiness timeout only after the supervised child has physically closed', async () => {
        const fixture = await createReadinessScript('setInterval(() => {}, 1000);\n');
        const result = await runModelGatewayLiveCommand({
            workspace: fixture.workspace,
            command: 'readiness',
            args: [],
            timeoutMs: 1_000,
            environmentAuthority: fixture.authority,
        });

        assert.equal(result.success, false);
        assert.equal(result.timedOut, true);
        assert.equal(result.aborted, false);
        assert.equal(result.outputLimitExceeded, false);
        assert.ok(result.durationMs >= 900);
        assert.match(String(result.error), /timed out after 1000ms/u);
        assert.deepEqual(readinessLifecycle(), {
            created: 1,
            terminated: 1,
            current: 0,
            cancelled: 0,
            timedOut: 1,
            outputLimited: 0,
            abnormalExit: 0,
        });
    });
});
