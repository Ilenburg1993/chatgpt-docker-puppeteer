// @ts-check

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, it } from 'vitest';

import { getResultSizeHint } from '#copilot/mcp/public/protocol/tools';
import { resetModelGatewayLiveReadinessCacheForTests } from '#copilot/testing/mcp/integrations/model-gateway/live-runs';
import { llmBLiveTools } from '../../../../src/copilot/mcp/tools/llm-b-live.js';

/** @type {string[]} */
const temporaryDirectories = [];

afterEach(async () => {
    resetModelGatewayLiveReadinessCacheForTests();
    await Promise.all(
        temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    );
});

async function createFixture() {
    const root = await mkdtemp(join(tmpdir(), 'llmb-readiness-wire-'));
    temporaryDirectories.push(root);
    const scriptPath = join(root, 'scripts/model-gateway/commands/model-gateway-live-readiness.mjs');
    await mkdir(dirname(scriptPath), { recursive: true });
    await writeFile(
        scriptPath,
        `
            const contextArg = process.argv.find((arg) => arg.startsWith('--redaction-proof-context-id='));
            const proofArg = process.argv.find((arg) => arg.startsWith('--redaction-proof-base64='));
            const contextId = contextArg?.slice('--redaction-proof-context-id='.length) ?? '';
            const proof = {
                schema: 'model-gateway-readiness-redaction-proof', version: 1, contextId,
                generatedAt: '2026-08-26T00:00:00.000Z', ok: true,
                catalog: { surface: 'json:catalog', mode: 'exhaustive', fingerprint: 'wire-catalog', ok: true, leakCount: 0, scannedStringCount: 10 },
                sqlite: { surface: 'sqlite:payload_json', mode: 'bounded', fingerprint: 'wire-sqlite', ok: true, leakCount: 0, scannedStringCount: 20, tableCount: 2, rowCount: 20, payloadBytes: 200, maxRowsPerTable: 25 },
            };
            process.stdout.write(JSON.stringify({
                schema: 'model-gateway-live-readiness', ok: true, snapshotId: 'wire-snapshot', generatedAt: '2026-08-26T00:00:00.000Z',
                checks: [{ id: 'catalog_integrity', ok: true, detail: 'ok' }, { id: 'runtime_selector_plan_ready', ok: true, detail: 'ok' }],
                sqlite: { parityOk: true, runtimeHealthReadLimit: 500, runtimeProbeOnlyRecords: 2, runtimeProbeProofRecords: 3 },
                redaction: { ok: true, proofReused: Boolean(proofArg), proof,
                    catalog: { mode: 'exhaustive', ok: true, leakCount: 0, scannedStringCount: 10 },
                    sqlite: { mode: 'bounded', ok: true, leakCount: 0, scannedStringCount: 20, rowCount: 20, maxRowsPerTable: 25 } },
                selection: {
                    effectiveStrict: { ok: true, selected: 4, profiles: 4, providers: { openrouter: 4 } },
                    runtimeSelectorPlan: { ok: true, ready: true, selected: 4, profiles: 4, blocked: 0 },
                    terminalLiveRuntimeSelectorPlan: { ok: true, ready: true, selected: 3, blocked: 0, profiles: ['repo_agent','code','tool_agent'] },
                },
                largeDiagnosticTree: 'x'.repeat(80_000),
            }));
        `,
        'utf8',
    );
    const runsScriptPath = join(root, 'scripts/model-gateway/commands/model-gateway-live-runs.mjs');
    await writeFile(
        runsScriptPath,
        `
            const limitIndex = process.argv.indexOf('--limit');
            const limit = limitIndex >= 0 ? Number(process.argv[limitIndex + 1]) : 20;
            process.stdout.write(JSON.stringify({
                schema: 'model-gateway-live-runs',
                count: 1,
                limit,
                runs: [{ runId: 'fixture-run', status: 'completed' }],
            }));
        `,
        'utf8',
    );
    let sqliteFingerprintReads = 0;
    const environmentAuthority = Object.freeze({
        readinessEnvironment: () => Object.freeze({}),
        readOnlyEnvironment: () => Object.freeze({}),
    });
    return {
        sqliteFingerprintReads: () => sqliteFingerprintReads,
        operationContext: /** @type {any} */ ({
            workspace: {
                workspaceRoot: root,
                io: {
                    statPath: async () => ({ stats: { size: 10, mtimeMs: 20 } }),
                    mkdirPathLocked: async () => ({}),
                    listDirectoryNamesFresh: async () => ({ entries: [] }),
                },
            },
            config: {},
            capabilities: {
                modelGatewayLiveRuns: environmentAuthority,
                modelGatewaySqliteFingerprint: Object.freeze({
                    read: () => {
                        sqliteFingerprintReads += 1;
                        return 'wire-sqlite-state';
                    },
                }),
            },
        }),
    };
}

function readinessTool() {
    const tool = llmBLiveTools.find((entry) => entry.name === 'llmb_live_readiness');
    assert.ok(tool);
    return tool;
}

describe('LLM-B readiness MCP wire contract', () => {
    it('defaults to a task-first compact result below 16 KiB with a non-wire size hint', async () => {
        const fixture = await createFixture();
        const result = await readinessTool().handler({}, fixture.operationContext);
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['ok'], true);
        assert.equal(result.structuredContent?.['detailsAvailable'], true);
        assert.equal('largeDiagnosticTree' in (result.structuredContent ?? {}), false);
        assert.match(String(result.content?.[0]?.text ?? ''), /^LLM-B readiness READY/u);
        assert.match(String(result.content?.[0]?.text ?? ''), /details=includeDetails:true/u);
        const bytes = Buffer.byteLength(JSON.stringify(result), 'utf8');
        assert.ok(bytes < 16 * 1024, `expected compact readiness <16 KiB, got ${bytes} bytes`);
        const hint = getResultSizeHint(result);
        assert.equal(hint?.source, 'llmb-live-readiness');
        assert.equal(hint?.strategy, 'conservative-estimate');
    });

    it('preserves the complete structured readiness tree only when includeDetails=true', async () => {
        const fixture = await createFixture();
        const result = await readinessTool().handler({ includeDetails: true }, fixture.operationContext);
        assert.equal(result.isError, undefined);
        assert.equal(typeof result.structuredContent?.['largeDiagnosticTree'], 'string');
        assert.ok(String(result.structuredContent?.['largeDiagnosticTree']).length >= 80_000);
        assert.ok(
            String(result.content?.[0]?.text ?? '').length < 512,
            'text remains task-first even for detailed output',
        );
    });

    it('view=runs dispatches directly to persisted runs without readiness fingerprinting', async () => {
        const fixture = await createFixture();
        const result = await readinessTool().handler({ view: 'runs', limit: 7 }, fixture.operationContext);
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['schema'], 'model-gateway-live-runs');
        assert.equal(result.structuredContent?.['limit'], 7);
        assert.deepEqual(result.structuredContent?.['runs'], [{ runId: 'fixture-run', status: 'completed' }]);
        assert.ok(Array.isArray(result.structuredContent?.['detachedRuns']));
        assert.equal(fixture.sqliteFingerprintReads(), 0, 'runs view must not enter readiness fingerprint/cache path');
    });

    it('rejects fields belonging to the other LLM-B read projection', async () => {
        const fixture = await createFixture();
        const runsConflict = await readinessTool().handler(
            { view: 'runs', includeDetails: true },
            fixture.operationContext,
        );
        assert.equal(runsConflict.isError, true);
        assert.equal(runsConflict.structuredContent?.['code'], 'ERR_LLMB_LIVE_READ_VIEW_FIELDS');

        const readinessConflict = await readinessTool().handler({ limit: 3 }, fixture.operationContext);
        assert.equal(readinessConflict.isError, true);
        assert.equal(readinessConflict.structuredContent?.['code'], 'ERR_LLMB_LIVE_READ_VIEW_FIELDS');
    });
});
