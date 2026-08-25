// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
    createMcpToolSurfacePolicy,
    getCanonicalMcpTools,
    readMcpToolSurfacePolicy,
} from '#copilot/mcp/public/registry';

import {
    buildToolPayloadAudit,
    buildToolSurfacePayloadComparison,
    readMcpToolPayloadAuditConfig,
} from '#copilot/mcp/public/diagnostics/tool-payload';
import { MCP_TOOL_EXECUTION_LIMITS } from '#copilot/mcp/public/protocol/tools';

const PAYLOAD_CONFIG = readMcpToolPayloadAuditConfig({});

describe('MCP tools/list payload audit', () => {
    it('captures immutable normalized process policy', () => {
        const config = readMcpToolPayloadAuditConfig({
            COPILOT_MCP_TOOL_PAYLOAD_TOP: '7',
            COPILOT_MCP_TOOL_PAYLOAD_MAX_BYTES: '123456',
        });
        assert.equal(config.top, 7);
        assert.equal(config.maxEnvelopeBytes, 123456);
        assert.equal(Object.isFrozen(config), true);
    });
    it('measures SDK wire descriptors instead of internal Zod state', async () => {
        const audit = await buildToolPayloadAudit({
            tools: getCanonicalMcpTools(),
            config: PAYLOAD_CONFIG,
            top: 5,
            maxEnvelopeBytes: MCP_TOOL_EXECUTION_LIMITS.toolsList.maxEnvelopeBytes,
        });

        assert.equal(audit['ok'], true);
        assert.equal(audit['measurement'], 'sdk-in-memory-tools/list');
        assert.equal(audit['toolCount'], getCanonicalMcpTools().length);
        assert.equal(audit['withinEnvelopeBudget'], true, JSON.stringify(audit, null, 2));
        assert.ok(Number(audit['budgetHeadroomBytes']) > 1024, JSON.stringify(audit, null, 2));
        assert.ok(Number(audit['totalEnvelopeBytes']) > 100_000);
        assert.equal(audit['maxEnvelopeBytes'], 400 * 1024);
        assert.ok(Number(audit['totalEnvelopeBytes']) < MCP_TOOL_EXECUTION_LIMITS.toolsList.maxEnvelopeBytes);
        assert.ok(Number(audit['budgetHeadroomBytes']) > 0);

        const fieldTotals = /** @type {Record<string, number>} */ (audit['fieldTotals']);
        const inputSchemaBytes = fieldTotals['inputSchemaBytes'];
        const metaBytes = fieldTotals['metaBytes'];
        if (inputSchemaBytes === undefined || metaBytes === undefined) {
            throw new Error('Totais de campos obrigatórios ausentes no relatório.');
        }
        assert.ok(inputSchemaBytes > metaBytes);
        assert.ok(inputSchemaBytes < MCP_TOOL_EXECUTION_LIMITS.toolsList.maxEnvelopeBytes);
        assert.equal('securitySchemesBytes' in fieldTotals, false);

        const topTools = /** @type {Record<string, unknown>[]} */ (audit['topTools']);
        assert.equal(topTools.length, 5);
        assert.ok(Number(topTools[0]?.['totalBytes']) >= Number(topTools.at(-1)?.['totalBytes']));
        assert.ok(Number(topTools[0]?.['totalBytes']) < 32 * 1024);
        assert.ok(Number(topTools[0]?.['totalBytes']) < MCP_TOOL_EXECUTION_LIMITS.toolsList.maxEnvelopeBytes / 4);
    });

    it('measures SDK timing phases and compares full versus evidence-shaped latency surfaces', async () => {
        const usageToolStarts = [
            { tool: 'terminal_exec', count: 100 },
            { tool: 'repo_bulk_inspect', count: 50 },
            { tool: 'repo_apply_patch_batch', count: 20 },
            { tool: 'terminal_session_read', count: 10 },
            { tool: 'repo_working_set', count: 5 },
        ];
        const comparison = await buildToolSurfacePayloadComparison({
            config: PAYLOAD_CONFIG,
            samples: 2,
            usageToolStarts,
            surfaces: ['full', 'latency'].map((mode) => ({
                mode,
                tools: getCanonicalMcpTools({ toolSurfacePolicy: createMcpToolSurfacePolicy({ mode }) }),
            })),
        });
        const surfaces = /** @type {Record<string, any>[]} */ (comparison['surfaces']);
        const full = surfaces.find((row) => row['mode'] === 'full');
        const latency = surfaces.find((row) => row['mode'] === 'latency');
        assert.ok(full && latency);
        assert.equal(latency['usage']['weightedCoverage'], 1);
        assert.equal(latency['usage']['missingObservedToolCount'], 0);
        assert.ok(Number(latency['toolCount']) < Number(full['toolCount']));
        assert.ok(Number(latency['totalEnvelopeBytes']) < Number(full['totalEnvelopeBytes']));
        assert.ok(Number(latency['versusFull']['envelopeSavingsPercent']) > 20);
        assert.ok(Number(latency['timingsMs']['listP50']) >= 0);
        assert.equal(comparison['evidence']['defaultChangeRecommended'], false);
        assert.ok(/** @type {string[]} */ (comparison['evidence']['highCoverageReducedModes']).includes('latency'));
    });

    it('orchestrates the surface matrix through the real tool handler with round-trip usage evidence', async () => {
        const currentTools = getCanonicalMcpTools({ toolSurfacePolicy: createMcpToolSurfacePolicy({ mode: 'full' }) });
        const tool = currentTools.find((row) => row.name === 'mcp_tool_payload_audit');
        assert.ok(tool);
        const operationContext = /** @type {import('#copilot/mcp/public/protocol/tools').McpToolOperationContext} */ (
            /** @type {unknown} */ ({
                signal: new AbortController().signal,
                requestId: 'tool-surface-comparison-test',
                cancellationSource: () => null,
                config: { toolPayload: PAYLOAD_CONFIG },
                capabilities: {
                    toolSurface: Object.freeze({
                        tools: Object.freeze([...currentTools]),
                        names: Object.freeze(currentTools.map((row) => row.name)),
                        resolveCanonicalSurfaces: () =>
                            Object.freeze(
                                [
                                    'full',
                                    'latency',
                                    'minimal',
                                    'cloudflare',
                                    'readonly',
                                    'claude',
                                    'safe',
                                    'research',
                                ].map((mode) => {
                                    const tools = getCanonicalMcpTools({
                                        toolSurfacePolicy: createMcpToolSurfacePolicy({ mode }),
                                    });
                                    return Object.freeze({
                                        mode,
                                        tools: Object.freeze([...tools]),
                                        names: Object.freeze(tools.map((row) => row.name)),
                                    });
                                }),
                            ),
                    }),
                    roundTripAnalytics: Object.freeze({
                        summarize: async () => ({
                            indexedRows: 5,
                            toolStarts: [
                                { tool: 'terminal_exec', count: 100 },
                                { tool: 'repo_bulk_inspect', count: 50 },
                                { tool: 'repo_apply_patch_batch', count: 20 },
                            ],
                        }),
                    }),
                },
            })
        );
        const result = await tool.handler(
            { compareSurfaces: true, samples: 1, usageWindowHours: 24 },
            operationContext,
        );
        const structured = /** @type {Record<string, any>} */ (result.structuredContent);
        assert.equal(structured['currentSurface']['toolCount'], 131);
        assert.equal(structured['comparison']['measurement'], 'sdk-in-memory-tools/list-surface-matrix');
        assert.equal(structured['comparison']['usageSample']['totalObservedCalls'], 170);
        const latency = /** @type {Record<string, any>[]} */ (structured['comparison']['surfaces']).find(
            (row) => row['mode'] === 'latency',
        );
        assert.ok(latency);
        assert.equal(latency['usage']['weightedCoverage'], 1);
        assert.equal(structured['usageAuthority']['source'], 'round-trip-derived-index');
        assert.equal(structured['usageAuthority']['sync'], false);
        assert.equal(currentTools.length, 131);
        assert.equal(operationContext.capabilities.toolSurface?.tools.length, 131);
    });

    it('accepts only canonical surface mode names instead of hidden aliases', () => {
        assert.equal(readMcpToolSurfacePolicy({ COPILOT_MCP_TOOL_SURFACE: 'latency' }).mode, 'latency');
        assert.throws(
            () => readMcpToolSurfacePolicy({ COPILOT_MCP_TOOL_SURFACE: 'fast' }),
            /Unsupported MCP tool surface/u,
        );
    });

    it('reports an exceeded custom budget without failing the read-only audit', async () => {
        const audit = await buildToolPayloadAudit({
            tools: getCanonicalMcpTools(),
            config: PAYLOAD_CONFIG,
            top: 1,
            maxEnvelopeBytes: 100_000,
        });

        assert.equal(audit['ok'], true);
        assert.equal(audit['withinEnvelopeBudget'], false);
        assert.ok(Number(audit['budgetHeadroomBytes']) < 0);
    });
});
