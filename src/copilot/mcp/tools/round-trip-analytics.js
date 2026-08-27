// @ts-check
/**
 * Incremental round-trip recovery analytics tool.
 *
 * @module copilot/mcp/tools/round-trip-analytics
 */

import { defineMcpRawTool } from '#copilot/mcp/public/protocol/catalog';
import { okResult, requireMcpToolRoundTripAnalyticsCapability } from '#copilot/mcp/public/protocol/tools';
import { z } from 'zod';

/** @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition} */
export const mcpRoundTripAnalyticsTool = defineMcpRawTool({
    name: 'mcp_round_trip_analytics',
    title: 'MCP round-trip analytics',
    description:
        'Incrementally sync the append-only MCP audit into a rebuildable SQLite index and return completeness-aware temporal pressure, optional lineage-bound transitions/recovery, execution accounting, payload accounting and workflow-pressure analytics in the same call.',
    inputSchema: {
        windowHours: z
            .number()
            .int()
            .min(1)
            .max(24 * 14)
            .optional()
            ['describe']('Analysis window in hours. Default: 24; maximum: 336 (14 days).'),
        top: z
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            ['describe']('Maximum transition/tool ranking rows. Default: 20.'),
        includeSynthetic: z
            .boolean()
            .optional()
            ['describe']('Include events emitted by src/copilot/.ai/jobs test/validator fixtures. Default: false.'),
        sync: z
            .boolean()
            .optional()
            ['describe']('Refresh the derived SQLite index from new audit bytes before summarizing. Default: true.'),
    },

    handler: async (input = {}, operationContext) => {
        const options = /** @type {Record<string, unknown>} */ (input);
        const windowHours = boundedInteger(options['windowHours'], 24, 1, 24 * 14);
        const top = boundedInteger(options['top'], 20, 1, 100);
        const includeSynthetic = options['includeSynthetic'] === true;
        const sync = options['sync'] !== false;
        const report = await requireMcpToolRoundTripAnalyticsCapability(operationContext).summarize({
            windowMs: windowHours * 60 * 60 * 1000,
            top,
            includeSynthetic,
            sync,
        });
        const ingestion = report.ingestion;
        return okResult({
            success: ingestion?.ok !== false,
            derivedIndex: {
                authority: 'rebuildable-derived-index-over-append-only-mcp-audit',
                syncRequested: sync,
                ...(ingestion ? { ingestion } : {}),
            },
            analytics: {
                schemaVersion: report.schemaVersion,
                normalizerVersion: report.normalizerVersion,
                authority: report.authority,
                windowMs: report.windowMs,
                includeSynthetic: report.includeSynthetic,
                indexedRows: report.indexedRows,
                completeness: report.completeness,
                callPairing: report.callPairing,
                topTransitions: report.topTransitions,
                sequenceEvidence: report.sequenceEvidence,
                failures: report.failures,
                resultOutcomes: report.resultOutcomes,
                recoveryRecipes: report.recoveryRecipes,
                exactSelfRepair: report.exactSelfRepair,
                optionPolicies: report.optionPolicies,
                retryTax: report.retryTax,
                recovery: report.recovery,
                workflowPressure: report.workflowPressure,
                executionAccounting: report.executionAccounting,
                payloadAccounting: report.payloadAccounting,
                runtimeCohorts: report.runtimeCohorts,
                optimizationEvidence: report.optimizationEvidence,
                discontinuities: report.discontinuities,
                toolStarts: report.toolStarts,
            },
        });
    },
});

/** @param {unknown} value @param {number} fallback @param {number} min @param {number} max */
function boundedInteger(value, fallback, min, max) {
    const parsed = Number(value ?? fallback);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(parsed)));
}
