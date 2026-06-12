import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import express from 'express';
import request from 'supertest';

import createObservabilityRouter from '../../../src/copilot/server/routes/sdk/observability.js';

/**
 * @param {Partial<any>} [overrides]
 * @returns {any}
 */
function makeDeps(overrides = {}) {
    const convergenceTraceStore = {
        getSnapshot: () => ({
            totalTraces: 1,
            operations: {
                'workspace.promote': {
                    operation: 'workspace.promote',
                    traces: 1,
                    running: 0,
                    succeeded: 1,
                    failed: 0,
                    mixed: 0,
                    bytes: 120,
                    phases: {},
                },
            },
            traces: [],
            selectedTrace: null,
            updatedAt: 1,
        }),
    };
    return {
        sdkObservability: {
            defaultMetrics: {
                getSummary: () => ({
                    tools: {},
                    tokens: { inputTokens: 0, outputTokens: 0 },
                    sessions: {},
                    gauges: {},
                }),
            },
            defaultErrorTracker: {
                getStats: () => ({ buffered: 0, total: 0 }),
                getErrors: () => [],
                clearErrors: () => {},
            },
            getMcpStatus: () => ({ available: true, circuitOpen: false }),
            nervEventBusAdapter: { isMounted: true },
            isOtelEnabled: () => false,
            defaultOtelFile: '/tmp/otel.log',
            getRecentLogs: () => [],
            getLastQuotaSnapshots: () => ({ snapshots: {}, ts: 0 }),
            defaultAuditLog: { getLast: () => [], flush: async () => {} },
            getAuditTail: () => [],
            getCatalog: () => ({}),
            getDeadLetters: () => [],
            log: () => {},
            otelExporterOtlpEndpoint: null,
            convergenceTraceStore,
        },
        sdkRuntimeProjection: {
            buildRuntimeRouteMetaPayload: () => ({ runtimeId: 'default', runtimeFound: true }),
            readAgentStatusSnapshotForRuntime: () => ({ status: 'ready' }),
            readAgentStatusValueForRuntime: () => 'ready',
        },
        allTools: [
            { name: 'read_file_content' },
            { name: 'list_directory' },
            { name: 'search_in_files' },
            { name: 'create_file' },
            { name: 'write_file_content' },
            { name: 'patch_file' },
        ],
        sdkSessionRpc: {
            workspaceReadFile: async () => ({ content: 'ok' }),
        },
        ...overrides,
    };
}

/**
 * @param {any} deps
 * @returns {import('express').Express}
 */
function makeApp(deps) {
    const app = express();
    app.use(express.json());
    app.use('/', createObservabilityRouter(deps));
    return app;
}

describe('sdk observability health sdkFsRouting', () => {
    it('expõe sdkFsRouting em modo local-fs-primary quando superfícies estão prontas', async () => {
        const res = await request(makeApp(makeDeps())).get('/observability/health').expect(200);

        assert.equal(res.body.ok, true);
        assert.equal(res.body.sdkFsRouting.mode, 'local-fs-primary');
    });

    it('expõe sdkFsRouting em modo degraded sem workspace SDK e sem file-tools canônicas', async () => {
        const res = await request(
            makeApp(
                makeDeps({
                    allTools: [{ name: 'bash' }],
                    sdkSessionRpc: {},
                }),
            ),
        )
            .get('/observability/health')
            .expect(200);

        assert.equal(res.body.ok, true);
        assert.equal(res.body.sdkFsRouting.mode, 'degraded');
    });

    it('degrada health quando há traces recentes de convergência com falha ou conflito', async () => {
        const deps = makeDeps();
        deps.sdkObservability.convergenceTraceStore = {
            getSnapshot: () => ({
                totalTraces: 2,
                operations: {},
                traces: [
                    { traceId: 't1', operation: 'workspace.promote', status: 'mixed' },
                    { traceId: 't2', operation: 'workspace.mirror', status: 'succeeded' },
                ],
                selectedTrace: null,
                updatedAt: 1,
            }),
        };

        const res = await request(makeApp(deps)).get('/observability/health').expect(200);

        assert.equal(res.body.status, 'degraded');
        assert.equal(res.body.components.convergence.status, 'degraded');
        assert.match(res.body.components.convergence.details, /1 recent/);
    });

    it('expõe projeção analítica de convergência SDK↔FS por operação e fase', async () => {
        const res = await request(
            makeApp(
                makeDeps({
                    sdkObservability: {
                        ...makeDeps().sdkObservability,
                        defaultMetrics: {
                            getSummary: () => ({
                                tools: {},
                                tokens: { inputTokens: 0, outputTokens: 0 },
                                sessions: {},
                                counters: {
                                    'sdk.operation.workspace.promote.total': 2,
                                    'sdk.operation.workspace.promote.succeeded': 1,
                                    'sdk.operation.workspace.promote.failed': 1,
                                    'sdk.operation.workspace.promote.phase.read_local.succeeded': 2,
                                    'sdk.operation.workspace.promote.phase.write_sdk.succeeded': 1,
                                    'sdk.operation.workspace.promote.bytes_total': 120,
                                },
                                gauges: {
                                    'sdk.operation.workspace.promote.last_bytes': { value: 80, ts: 1 },
                                },
                            }),
                        },
                    },
                }),
            ),
        )
            .get('/observability/convergence')
            .expect(200);

        assert.equal(res.body.ok, true);
        assert.equal(res.body.convergence.operations['workspace.promote'].total, 2);
        assert.equal(res.body.convergence.operations['workspace.promote'].statuses.succeeded, 1);
        assert.equal(res.body.convergence.operations['workspace.promote'].phases.read_local.succeeded, 2);
        assert.equal(res.body.convergence.operations['workspace.promote'].bytesTotal, 120);
        assert.equal(res.body.convergence.operations['workspace.promote'].lastBytes, 80);
        assert.equal(res.body.convergence.traceStore.totalTraces, 1);
        assert.equal(res.body.convergence.traceStore.operations['workspace.promote'].succeeded, 1);
    });

    it('redige segredos nas superfícies públicas de observabilidade', async () => {
        const githubToken = 'ghs_abcdefghijklmnopqrstuvwxyz1234567890';
        const byokToken = 'sk-testsecret1234567890';
        const deps = makeDeps({
            sdkObservability: {
                ...makeDeps().sdkObservability,
                defaultMetrics: {
                    getSummary: () => ({
                        tools: {},
                        tokens: { inputTokens: 42 },
                        sessions: {},
                        counters: { [`sdk.operation.workspace.promote.${githubToken}`]: 1 },
                        gauges: { [`sdk.operation.workspace.promote.${byokToken}`]: { value: 1, ts: 1 } },
                    }),
                },
                defaultErrorTracker: {
                    getStats: () => ({
                        buffered: 1,
                        total: 1,
                        last: {
                            message: `gitHubToken=${githubToken}`,
                            metadata: { Authorization: `Bearer ${byokToken}` },
                        },
                    }),
                    getErrors: () => [
                        { message: `gitHubToken=${githubToken}`, metadata: { Authorization: `Bearer ${byokToken}` } },
                    ],
                    clearErrors: () => {},
                },
                getRecentLogs: () => [
                    { level: 'INFO', msg: `Authorization: Bearer ${byokToken}`, taskId: githubToken },
                ],
                defaultAuditLog: {
                    getLast: () => [
                        {
                            type: 'audit',
                            data: { gitHubToken: githubToken, headers: { Authorization: `Bearer ${byokToken}` } },
                        },
                    ],
                    flush: async () => {},
                },
                getAuditTail: () => [{ toolName: `tool_${byokToken}`, toolArgs: { gitHubToken: githubToken } }],
                getCatalog: () => ({ secret: `gitHubToken=${githubToken}` }),
                getDeadLetters: () => [{ payload: { Authorization: `Bearer ${byokToken}` } }],
                getLastQuotaSnapshots: () => ({ snapshots: { secret: { token: githubToken } }, ts: 1 }),
                convergenceTraceStore: {
                    getSnapshot: () => ({
                        totalTraces: 1,
                        operations: {},
                        traces: [{ traceId: githubToken, reason: `Authorization: Bearer ${byokToken}` }],
                        selectedTrace: null,
                        updatedAt: 1,
                    }),
                },
                getMcpStatus: () => ({ available: true, circuitOpen: false }),
                nervEventBusAdapter: { isMounted: true },
                isOtelEnabled: () => true,
                otelExporterOtlpEndpoint: `https://otel.example/${githubToken}`,
                defaultOtelFile: `/tmp/${byokToken}.jsonl`,
                log: () => {},
            },
        });
        const app = makeApp(deps);
        const paths = [
            '/observability/metrics',
            '/observability/convergence',
            '/observability/quota',
            '/observability/errors',
            '/observability/errors/stats',
            '/observability/logs',
            '/observability/audit',
            '/observability/audit-tail',
            '/observability/otel-status',
            '/observability/events/catalog',
            '/observability/events/dead-letter',
        ];

        for (const path of paths) {
            const res = await request(app).get(path).expect(200);
            const serialized = JSON.stringify(res.body);
            assert.equal(serialized.includes(githubToken), false, `${path} vazou GitHub token`);
            assert.equal(serialized.includes(byokToken), false, `${path} vazou BYOK token`);
            assert.match(serialized, /\[redacted\]/u, `${path} não aplicou redaction`);
        }
    });
});
