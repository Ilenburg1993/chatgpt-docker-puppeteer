// @ts-check
/** MCP latency SLO dashboard wire adapter. */

import { buildMcpLatencyDashboard } from '#copilot/mcp/public/diagnostics/latency/dashboard';
import { defineMcpRawTool } from '#copilot/mcp/public/protocol/catalog';
import { okResult, requireMcpToolLatencyDashboardConfig } from '#copilot/mcp/public/protocol/tools';
import { z } from 'zod';

/** @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition} */
export const mcpLatencyDashboardTool = defineMcpRawTool({
    name: 'mcp_latency_dashboard',
    title: 'MCP latency dashboard',
    description:
        'Return a compact read-only latency/SLO dashboard from in-process MCP tool metrics, including slow tools, slow phases and recommended next actions.',
    inputSchema: {
        minSampleCalls: z
            .number()
            .int()
            .min(1)
            .max(10_000)
            .optional()
            ['describe']('Minimum total calls before strict SLO status is meaningful.'),
        silentExternalGapP50WarnMs: z
            .number()
            .int()
            .min(100)
            .max(120000)
            .optional()
            ['describe']('Interaction SLO warning threshold for p50 origin-silent gap. Defaults to 3000ms.'),
        silentExternalGapP95WarnMs: z
            .number()
            .int()
            .min(100)
            .max(120000)
            .optional()
            ['describe']('Interaction SLO warning threshold for p95 origin-silent gap. Defaults to 8000ms.'),
        includeTools: z
            .boolean()
            .optional()
            ['describe'](
                'Include detailed per-tool/per-phase ranking rows. Default: false; summary still names each top pressure source.',
            ),
        maxRows: z
            .number()
            .int()
            .min(1)
            .max(50)
            .optional()
            ['describe']('Maximum slow tool/phase rows to return. Defaults to 12.'),
        persistSnapshot: z
            .boolean()
            .optional()
            ['describe']('Append a compact snapshot to the local latency history JSONL file. Defaults to false.'),
        compareHistory: z
            .boolean()
            .optional()
            ['describe'](
                'Compare this snapshot with the latest persisted latency snapshot. Defaults to true when persistSnapshot=true.',
            ),
        historyLimit: z
            .number()
            .int()
            .min(1)
            .max(500)
            .optional()
            ['describe']('Number of recent persisted snapshots to return when history is requested.'),
        maxHistorySnapshots: z
            .number()
            .int()
            .min(1)
            .max(10000)
            .optional()
            ['describe']('Maximum snapshots retained when persistSnapshot=true.'),
    },
    handler: async (input = {}, operationContext) =>
        okResult(
            await buildMcpLatencyDashboard(
                {
                    policy: requireMcpToolLatencyDashboardConfig(operationContext),
                    ...(operationContext?.capabilities.httpSessionRuntime
                        ? { sessionRuntimeState: operationContext.capabilities.httpSessionRuntime.readState() }
                        : {}),
                    ...(operationContext?.capabilities.roundTripAnalytics?.readSnapshot
                        ? { readRoundTripSnapshot: operationContext.capabilities.roundTripAnalytics.readSnapshot }
                        : {}),
                },
                /** @type {Record<string, unknown>} */ (input),
            ),
        ),
});
