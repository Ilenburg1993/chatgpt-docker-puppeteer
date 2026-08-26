// @ts-check

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, it } from 'vitest';

import {
    MODEL_GATEWAY_LIVE_READINESS_CACHE_TTL_MS,
    executeModelGatewayLiveReadiness,
} from '#copilot/mcp/public/integrations/model-gateway/live-runs';
import {
    readModelGatewayLiveCommandLifecycleForTests,
    resetModelGatewayLiveCommandLifecycleForTests,
    resetModelGatewayLiveReadinessCacheForTests,
} from '#copilot/testing/mcp/integrations/model-gateway/live-runs';

/** @type {string[]} */
const temporaryDirectories = [];

afterEach(async () => {
    resetModelGatewayLiveReadinessCacheForTests();
    resetModelGatewayLiveCommandLifecycleForTests();
    await Promise.all(
        temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    );
});

async function createReadinessFixture() {
    const root = await mkdtemp(join(tmpdir(), 'llmb-readiness-cache-'));
    temporaryDirectories.push(root);
    const scriptPath = join(root, 'scripts/model-gateway/commands/model-gateway-live-readiness.mjs');
    const countPath = join(root, 'readiness-process-count.txt');
    await mkdir(dirname(scriptPath), { recursive: true });
    await writeFile(
        scriptPath,
        `
            import { appendFileSync } from 'node:fs';
            const contextArg = process.argv.find((arg) => arg.startsWith('--redaction-proof-context-id='));
            const proofArg = process.argv.find((arg) => arg.startsWith('--redaction-proof-base64='));
            const contextId = contextArg?.slice('--redaction-proof-context-id='.length) ?? '';
            if (!contextId) throw new Error('fixture requires redaction proof context id');
            appendFileSync(${JSON.stringify(countPath)}, proofArg ? 'run:proof\\n' : 'run:none\\n');
            const proof = {
                schema: 'model-gateway-readiness-redaction-proof',
                version: 1,
                contextId,
                generatedAt: '2026-08-26T00:00:00.000Z',
                ok: true,
                catalog: { surface: 'json:catalog', mode: 'exhaustive', fingerprint: 'fixture-catalog', ok: true, leakCount: 0, scannedStringCount: 1 },
                sqlite: { surface: 'sqlite:payload_json', mode: 'bounded', fingerprint: 'fixture-sqlite', ok: true, leakCount: 0, scannedStringCount: 1, tableCount: 1, rowCount: 1, payloadBytes: 2, maxRowsPerTable: 25 },
            };
            process.stdout.write(JSON.stringify({ ok: true, checks: [], fixture: 'cache', redaction: { ok: true, proofReused: Boolean(proofArg), proof } }));
        `,
        'utf8',
    );
    const workspace = /** @type {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} */ (
        /** @type {unknown} */ ({
            workspaceRoot: root,
            io: {
                statPath: async () => ({ stats: { size: 123, mtimeMs: 456 } }),
            },
        })
    );
    const environmentAuthority =
        /** @type {import('#copilot/mcp/public/integrations/model-gateway/live-runs').ModelGatewayLiveRunEnvironmentAuthority} */ (
            /** @type {unknown} */ ({ readinessEnvironment: () => Object.freeze({}) })
        );
    return { root, countPath, workspace, environmentAuthority };
}

async function readRunLog(countPath) {
    try {
        return (await readFile(countPath, 'utf8')).trim().split('\n').filter(Boolean);
    } catch {
        return [];
    }
}

async function readRunCount(countPath) {
    return (await readRunLog(countPath)).length;
}

describe('LLM-B readiness cache snapshot stability', () => {
    it('reuses a result only when the operational fingerprint is stable', async () => {
        const fixture = await createReadinessFixture();
        const sqliteFingerprint = Object.freeze({ read: () => 'stable-sqlite-state' });

        const first = await executeModelGatewayLiveReadiness(fixture.workspace, false, {
            environmentAuthority: fixture.environmentAuthority,
            sqliteFingerprint,
        });
        const second = await executeModelGatewayLiveReadiness(fixture.workspace, false, {
            environmentAuthority: fixture.environmentAuthority,
            sqliteFingerprint,
        });

        assert.equal(first.success, true);
        assert.equal(first.unstableSnapshot, false);
        assert.equal(first.execution, 'fresh-process');
        assert.equal(second.success, true);
        assert.equal(second.unstableSnapshot, false);
        assert.equal(second.execution, 'memory-cache');
        assert.equal(await readRunCount(fixture.countPath), 1);
    });

    it('expires the operational cache at the explicit freshness budget without wall-clock sleeping', async () => {
        const fixture = await createReadinessFixture();
        const sqliteFingerprint = Object.freeze({ read: () => 'stable-ttl-state' });
        let nowMs = 10_000;
        const now = () => nowMs;

        const fresh = await executeModelGatewayLiveReadiness(fixture.workspace, false, {
            environmentAuthority: fixture.environmentAuthority,
            sqliteFingerprint,
            now,
        });
        nowMs += MODEL_GATEWAY_LIVE_READINESS_CACHE_TTL_MS;
        const boundaryHit = await executeModelGatewayLiveReadiness(fixture.workspace, false, {
            environmentAuthority: fixture.environmentAuthority,
            sqliteFingerprint,
            now,
        });
        nowMs += 1;
        const expired = await executeModelGatewayLiveReadiness(fixture.workspace, false, {
            environmentAuthority: fixture.environmentAuthority,
            sqliteFingerprint,
            now,
        });

        assert.equal(fresh.execution, 'fresh-process');
        assert.equal(boundaryHit.execution, 'memory-cache');
        assert.equal(boundaryHit.cacheAgeMs, MODEL_GATEWAY_LIVE_READINESS_CACHE_TTL_MS);
        assert.equal(expired.execution, 'fresh-process');
        assert.deepEqual(await readRunLog(fixture.countPath), ['run:none', 'run:proof']);
    });

    it('keeps concurrent callers independent when one readiness is cancelled', async () => {
        const fixture = await createReadinessFixture();
        const scriptPath = join(fixture.root, 'scripts/model-gateway/commands/model-gateway-live-readiness.mjs');
        await writeFile(
            scriptPath,
            `
                import { appendFileSync } from 'node:fs';
                const contextArg = process.argv.find((arg) => arg.startsWith('--redaction-proof-context-id='));
                const contextId = contextArg?.slice('--redaction-proof-context-id='.length) ?? '';
                appendFileSync(${JSON.stringify(fixture.countPath)}, 'started\\n');
                await new Promise((resolve) => setTimeout(resolve, 300));
                const proof = {
                    schema: 'model-gateway-readiness-redaction-proof', version: 1, contextId,
                    generatedAt: '2026-08-26T00:00:00.000Z', ok: true,
                    catalog: { surface: 'json:catalog', mode: 'exhaustive', fingerprint: 'fixture-catalog', ok: true, leakCount: 0, scannedStringCount: 1 },
                    sqlite: { surface: 'sqlite:payload_json', mode: 'bounded', fingerprint: 'fixture-sqlite', ok: true, leakCount: 0, scannedStringCount: 1, tableCount: 1, rowCount: 1, payloadBytes: 2, maxRowsPerTable: 25 },
                };
                process.stdout.write(JSON.stringify({ ok: true, checks: [], redaction: { ok: true, proofReused: false, proof } }));
            `,
            'utf8',
        );
        resetModelGatewayLiveCommandLifecycleForTests();
        const sqliteFingerprint = Object.freeze({ read: () => 'concurrent-stable-state' });
        const controller = new AbortController();
        const cancelled = executeModelGatewayLiveReadiness(fixture.workspace, false, {
            environmentAuthority: fixture.environmentAuthority,
            sqliteFingerprint,
            signal: controller.signal,
        });
        const surviving = executeModelGatewayLiveReadiness(fixture.workspace, false, {
            environmentAuthority: fixture.environmentAuthority,
            sqliteFingerprint,
        });
        const deadline = Date.now() + 3_000;
        while ((await readRunCount(fixture.countPath)) < 2) {
            if (Date.now() >= deadline) throw new Error('Timed out waiting for concurrent readiness children.');
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        controller.abort(new Error('cancel-one-concurrent-readiness'));

        await assert.rejects(cancelled, /cancel-one-concurrent-readiness/u);
        const completed = await surviving;
        assert.equal(completed.success, true);
        assert.equal(completed.execution, 'fresh-process');
        const lifecycle = readModelGatewayLiveCommandLifecycleForTests()['readiness'];
        assert.deepEqual(lifecycle, {
            created: 2,
            terminated: 2,
            current: 0,
            cancelled: 1,
            timedOut: 0,
            outputLimited: 0,
            abnormalExit: 0,
        });
    });

    it('never caches a readiness result under a fingerprint observed only after the build', async () => {
        const fixture = await createReadinessFixture();
        let reads = 0;
        const sqliteFingerprint = Object.freeze({
            read: () => {
                reads += 1;
                return reads === 1 ? 'state-before-build' : 'state-after-build';
            },
        });

        const unstable = await executeModelGatewayLiveReadiness(fixture.workspace, false, {
            environmentAuthority: fixture.environmentAuthority,
            sqliteFingerprint,
        });
        assert.equal(unstable.success, false);
        assert.equal(unstable.unstableSnapshot, true);
        assert.equal(unstable.parsed, null);
        assert.match(String(unstable.error), /state changed during build/u);
        assert.equal(await readRunCount(fixture.countPath), 1);

        const stableRetry = await executeModelGatewayLiveReadiness(fixture.workspace, false, {
            environmentAuthority: fixture.environmentAuthority,
            sqliteFingerprint,
        });
        const cached = await executeModelGatewayLiveReadiness(fixture.workspace, false, {
            environmentAuthority: fixture.environmentAuthority,
            sqliteFingerprint,
        });

        assert.equal(stableRetry.success, true);
        assert.equal(stableRetry.unstableSnapshot, false);
        assert.equal(stableRetry.execution, 'fresh-process');
        assert.equal(cached.success, true);
        assert.equal(cached.execution, 'memory-cache');
        assert.equal(await readRunCount(fixture.countPath), 2);
    });

    it('fails closed when the subprocess returns a redaction proof bound to another context', async () => {
        const fixture = await createReadinessFixture();
        const scriptPath = join(fixture.root, 'scripts/model-gateway/commands/model-gateway-live-readiness.mjs');
        await writeFile(
            scriptPath,
            `
                const contextArg = process.argv.find((arg) => arg.startsWith('--redaction-proof-context-id='));
                const contextId = contextArg?.slice('--redaction-proof-context-id='.length) ?? '';
                const proof = {
                    schema: 'model-gateway-readiness-redaction-proof',
                    version: 1,
                    contextId: contextId + '-wrong',
                    generatedAt: '2026-08-26T00:00:00.000Z',
                    ok: true,
                    catalog: { surface: 'json:catalog', mode: 'exhaustive', fingerprint: 'fixture-catalog', ok: true, leakCount: 0, scannedStringCount: 1 },
                    sqlite: { surface: 'sqlite:payload_json', mode: 'bounded', fingerprint: 'fixture-sqlite', ok: true, leakCount: 0, scannedStringCount: 1, tableCount: 1, rowCount: 1, payloadBytes: 2, maxRowsPerTable: 25 },
                };
                process.stdout.write(JSON.stringify({ ok: true, checks: [], redaction: { ok: true, proofReused: false, proof } }));
            `,
            'utf8',
        );
        const result = await executeModelGatewayLiveReadiness(fixture.workspace, false, {
            environmentAuthority: fixture.environmentAuthority,
            sqliteFingerprint: Object.freeze({ read: () => 'stable-wrong-context' }),
        });
        assert.equal(result.success, false);
        assert.equal(result.parsed, null);
        assert.match(String(result.error), /no valid context-bound redaction proof/u);
    });

    it('reuses security proof across fresh operational states only within the same environment authority', async () => {
        const fixture = await createReadinessFixture();
        let reads = 0;
        const sqliteFingerprint = Object.freeze({
            read: () => {
                reads += 1;
                if (reads <= 2) return 'operational-state-1';
                if (reads <= 4) return 'operational-state-2';
                return 'operational-state-3';
            },
        });

        const first = await executeModelGatewayLiveReadiness(fixture.workspace, false, {
            environmentAuthority: fixture.environmentAuthority,
            sqliteFingerprint,
        });
        const second = await executeModelGatewayLiveReadiness(fixture.workspace, false, {
            environmentAuthority: fixture.environmentAuthority,
            sqliteFingerprint,
        });
        const differentAuthority =
            /** @type {import('#copilot/mcp/public/integrations/model-gateway/live-runs').ModelGatewayLiveRunEnvironmentAuthority} */ (
                /** @type {unknown} */ ({ readinessEnvironment: () => Object.freeze({}) })
            );
        const third = await executeModelGatewayLiveReadiness(fixture.workspace, false, {
            environmentAuthority: differentAuthority,
            sqliteFingerprint,
        });

        assert.equal(first.success, true);
        assert.equal(first.execution, 'fresh-process');
        assert.equal(second.success, true);
        assert.equal(second.execution, 'fresh-process');
        assert.equal(third.success, true);
        assert.equal(third.execution, 'fresh-process');
        assert.deepEqual(await readRunLog(fixture.countPath), ['run:none', 'run:proof', 'run:none']);
    });
});
