// @ts-check
/**
 * MCP tool for persistent fixed-endpoint OpenAI/ChatGPT latency observation.
 *
 * @module copilot/mcp/tools/openai-endpoint-latency
 */

import { z } from 'zod';
import {
    appendOpenAiEndpointLatencySnapshot,
    compareOpenAiEndpointLatencyToBaseline,
    measureOpenAiEndpointLatency,
    okResult,
    openWorldBoundedWriteAnnotations,
    readOpenAiEndpointLatencyHistory,
    readOpenAiEndpointLatencyMonitorState,
    summarizeOpenAiEndpointLatencyHistory,
} from '#copilot/mcp/control-plane';

/** @type {import('../registry.js').McpToolDefinition} */
export const mcpOpenAiEndpointLatencyTool = {
    name: 'mcp_openai_endpoint_latency',
    title: 'OpenAI endpoint latency observer',
    description:
        'Measure fixed OpenAI/ChatGPT endpoints from the DevContainer using fresh HTTPS connections, decompose DNS/TCP/TLS/TTFB/total latency, compare against bounded local history, and optionally persist a sanitized snapshot. It never measures ChatGPT UI TTFT or accepts arbitrary URLs.',
    inputSchema: {
        sampleCount: z.number().int().min(1).max(10).optional().describe('Samples per fixed endpoint. Default: 3.'),
        timeoutMs: z.number().int().min(500).max(10_000).optional().describe('Per-request timeout. Default: 3000ms.'),
        persistSnapshot: z.boolean().optional().describe('Persist the compact sanitized snapshot. Default: true.'),
        historyLimit: z.number().int().min(1).max(2_000).optional().describe('Historical snapshots read for baseline. Default: 200.'),
        maxHistorySnapshots: z.number().int().min(1).max(10_000).optional().describe('Maximum persisted snapshots retained. Default: 1000.'),
        includeSamples: z.boolean().optional().describe('Include individual sanitized samples. Default: false.'),
    },
    annotations: openWorldBoundedWriteAnnotations(),
    handler: async ({ sampleCount, timeoutMs, persistSnapshot, historyLimit, maxHistorySnapshots, includeSamples } = {}) => {
        const history = await readOpenAiEndpointLatencyHistory({ limit: historyLimit });
        const baseline = summarizeOpenAiEndpointLatencyHistory(history.entries);
        const measurement = await measureOpenAiEndpointLatency({ sampleCount, timeoutMs });
        const comparison = compareOpenAiEndpointLatencyToBaseline(measurement.snapshot, baseline);
        const shouldPersist = persistSnapshot !== false;
        const persistence = shouldPersist
            ? await appendOpenAiEndpointLatencySnapshot(measurement.snapshot, { maxSnapshots: maxHistorySnapshots })
            : { persisted: false, reason: 'disabled-by-caller', path: history.path };
        const failedTargets = measurement.snapshot.targets
            .filter((target) => target.successRate < 1)
            .map((target) => target.id);
        const regressedTargets = comparison.filter((row) => row.regression).map((row) => row.id);
        return okResult({
            success: failedTargets.length === 0,
            status: failedTargets.length > 0 ? 'degraded' : regressedTargets.length > 0 ? 'latency-regression' : 'ok',
            authority: measurement.snapshot.authority,
            observedAt: measurement.snapshot.observedAt,
            targets: measurement.snapshot.targets,
            baseline24h: baseline,
            comparison,
            failedTargets,
            regressedTargets,
            persistence,
            monitor: readOpenAiEndpointLatencyMonitorState(),
            ttftSemantics: {
                endpointTtfb: 'Measured here: request start at DevContainer -> first HTTP response headers from the fixed endpoint.',
                openAiApiStreamingTtft: 'Not measured by this tool; requires an explicit authenticated streaming model request and can incur provider usage/cost.',
                chatgptUiTtft: 'Not observable from this MCP origin; requires a client-side timestamp from user submit -> first rendered/streamed assistant token.',
            },
            ...(includeSamples === true ? { samples: measurement.samples } : {}),
        });
    },
};
