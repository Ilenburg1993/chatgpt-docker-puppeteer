// @ts-check

import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, it } from 'vitest';

import { getCanonicalMcpTools } from '#copilot/mcp/public/registry';
import { runToolHandlerWithCancellationForTests } from '#copilot/testing/mcp/registry';

/** @type {string[]} */
const temporaryDirectories = [];

afterEach(async () => {
    await Promise.all(
        temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    );
});

/** @param {string} filePath @param {number} timeoutMs */
async function waitForFile(filePath, timeoutMs) {
    const deadline = performance.now() + timeoutMs;
    while (true) {
        try {
            await access(filePath);
            return;
        } catch {
            if (performance.now() >= deadline) throw new Error(`Timed out waiting for ${filePath}.`);
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
    }
}

/** @param {string} filePath */
async function pathExists(filePath) {
    try {
        await access(filePath);
        return true;
    } catch {
        return false;
    }
}

describe('LLM-B readiness registry cancellation boundary', () => {
    it('drains the canonical llmb_live_readiness handler after a nested Worker has started', async () => {
        const root = await mkdtemp(join(tmpdir(), 'llmb-registry-cancel-'));
        temporaryDirectories.push(root);
        const readinessPath = join(root, 'scripts/model-gateway/commands/model-gateway-live-readiness.mjs');
        const nestedStarted = join(root, 'nested-redaction-started');
        const nestedLate = join(root, 'nested-redaction-late');
        await mkdir(dirname(readinessPath), { recursive: true });
        await writeFile(
            readinessPath,
            `
                import { Worker } from 'node:worker_threads';
                const nestedSource = \`import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(
                    nestedStarted,
                )}, 'started'); setTimeout(() => writeFileSync(${JSON.stringify(
                    nestedLate,
                )}, 'late'), 1000); setInterval(() => {}, 1000);\`;
                new Worker(new URL(\`data:text/javascript,\${encodeURIComponent(nestedSource)}\`));
                setInterval(() => {}, 1000);
            `,
            'utf8',
        );

        const tool = getCanonicalMcpTools().find((item) => item.name === 'llmb_live_readiness');
        assert.ok(tool, 'canonical llmb_live_readiness tool must exist');
        const controller = new AbortController();
        const environmentAuthority = Object.freeze({
            readinessEnvironment: () => Object.freeze({}),
        });
        const workspace = /** @type {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} */ (
            /** @type {unknown} */ ({
                workspaceRoot: root,
                io: {
                    statPath: async () => ({ stats: { size: 1, mtimeMs: 1 } }),
                },
            })
        );
        const operationContext = /** @type {import('#copilot/mcp/public/protocol/tools').McpToolOperationContext} */ (
            /** @type {unknown} */ ({
                signal: controller.signal,
                callerSignal: controller.signal,
                requestId: 'llmb-readiness-registry-cancel',
                workspace,
                config: {},
                capabilities: {
                    modelGatewayLiveRuns: environmentAuthority,
                    modelGatewaySqliteFingerprint: Object.freeze({ read: () => 'registry-cancel-fixture' }),
                },
                cancellationSource: () => (controller.signal.aborted ? 'caller' : null),
            })
        );

        const invocation = runToolHandlerWithCancellationForTests(tool, {}, operationContext);
        await waitForFile(nestedStarted, 5_000);
        const abortStartedAt = performance.now();
        controller.abort(new Error('registry nested cancellation'));

        await assert.rejects(invocation, (error) => {
            const failure = /** @type {any} */ (error);
            assert.equal(failure.code, 'MCP_TOOL_CANCELLED');
            assert.notEqual(failure.code, 'MCP_TOOL_CANCELLATION_DRAIN_TIMEOUT');
            assert.equal(failure.workMayContinue, false);
            return true;
        });
        const drainMs = performance.now() - abortStartedAt;
        assert.ok(drainMs < 2_000, `expected registry cancellation drain < 2s, got ${drainMs.toFixed(1)}ms`);

        await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_200));
        assert.equal(
            await pathExists(nestedLate),
            false,
            'nested Worker must not outlive the cancelled readiness call',
        );
    });

    it('hard-drains the canonical readiness process while better-sqlite3 is inside synchronous native work', async () => {
        const root = await mkdtemp(join(tmpdir(), 'llmb-registry-native-sqlite-cancel-'));
        temporaryDirectories.push(root);
        const readinessPath = join(root, 'scripts/model-gateway/commands/model-gateway-live-readiness.mjs');
        const sqliteStarted = join(root, 'native-sqlite-started');
        await mkdir(dirname(readinessPath), { recursive: true });
        const betterSqliteUrl = pathToFileURL(resolve('node_modules/better-sqlite3/lib/index.js')).href;
        await writeFile(
            readinessPath,
            `
                import Database from ${JSON.stringify(betterSqliteUrl)};
                import { writeFileSync } from 'node:fs';
                const db = new Database(':memory:');
                writeFileSync(${JSON.stringify(sqliteStarted)}, 'started');
                db.prepare(\`WITH RECURSIVE cnt(x) AS (VALUES(0) UNION ALL SELECT x + 1 FROM cnt WHERE x < 100000000) SELECT sum(x) AS total FROM cnt\`).get();
                process.stdout.write(JSON.stringify({ ok: true, checks: [] }));
            `,
            'utf8',
        );

        const tool = getCanonicalMcpTools().find((item) => item.name === 'llmb_live_readiness');
        assert.ok(tool, 'canonical llmb_live_readiness tool must exist');
        const controller = new AbortController();
        const environmentAuthority = Object.freeze({
            readinessEnvironment: () => Object.freeze({}),
        });
        const workspace = /** @type {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} */ (
            /** @type {unknown} */ ({
                workspaceRoot: root,
                io: {
                    statPath: async () => ({ stats: { size: 1, mtimeMs: 1 } }),
                },
            })
        );
        const operationContext = /** @type {import('#copilot/mcp/public/protocol/tools').McpToolOperationContext} */ (
            /** @type {unknown} */ ({
                signal: controller.signal,
                callerSignal: controller.signal,
                requestId: 'llmb-readiness-native-sqlite-cancel',
                workspace,
                config: {},
                capabilities: {
                    modelGatewayLiveRuns: environmentAuthority,
                    modelGatewaySqliteFingerprint: Object.freeze({
                        read: () => 'registry-native-sqlite-cancel-fixture',
                    }),
                },
                cancellationSource: () => (controller.signal.aborted ? 'caller' : null),
            })
        );

        const invocation = runToolHandlerWithCancellationForTests(tool, {}, operationContext);
        await waitForFile(sqliteStarted, 5_000);
        const abortStartedAt = performance.now();
        controller.abort(new Error('registry native sqlite cancellation'));

        await assert.rejects(invocation, (error) => {
            const failure = /** @type {any} */ (error);
            assert.equal(failure.code, 'MCP_TOOL_CANCELLED');
            assert.notEqual(failure.code, 'MCP_TOOL_CANCELLATION_DRAIN_TIMEOUT');
            assert.equal(failure.workMayContinue, false);
            return true;
        });
        const drainMs = performance.now() - abortStartedAt;
        assert.ok(drainMs < 2_000, `expected native SQLite process drain < 2s, got ${drainMs.toFixed(1)}ms`);
    });
});
