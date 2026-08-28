// @ts-check
/**
 * Read-only self-audit of the MCP tools/list wire payload.
 *
 * Surface comparison is supplied by a registry-owned operation capability, preserving one-way registry → tool
 * composition without letting this catalog leaf import the registry that owns it.
 *
 * @module copilot/mcp/tools/tool-payload-audit
 */

import { buildToolPayloadAudit, buildToolSurfacePayloadComparison } from '#copilot/mcp/public/diagnostics/tool-payload';
import { defineMcpRawTool } from '#copilot/mcp/public/protocol/catalog';
import {
    okResult,
    requireMcpToolPayloadAuditConfig,
    requireMcpToolRoundTripAnalyticsCapability,
    requireMcpToolSurface,
} from '#copilot/mcp/public/protocol/tools';
import { z } from 'zod';

/** @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition} */
export const mcpToolPayloadAuditTool = defineMcpRawTool({
    name: 'mcp_tool_payload_audit',
    title: 'MCP tool payload audit',
    description: 'Measure tools/list wire bytes and rank the largest descriptors without network calls.',
    inputSchema: {
        top: z.number().int().min(1).max(50).optional()['describe']('Largest tool descriptors to return. Default: 20.'),
        compareSurfaces: z
            .boolean()
            .optional()
            ['describe']('Compare every canonical tool-surface mode through the SDK tools/list wire path.'),
        samples: z
            .number()
            .int()
            .min(1)
            .max(9)
            .optional()
            ['describe']('Samples per surface for compareSurfaces. Default: 3.'),
        usageWindowHours: z
            .number()
            .int()
            .min(1)
            .max(336)
            .optional()
            ['describe']('Round-trip tool-usage window for surface coverage. Default: 24h.'),
    },

    handler: async ({ top, compareSurfaces, samples, usageWindowHours }, operationContext) => {
        const config = requireMcpToolPayloadAuditConfig(operationContext);
        const currentSurface = await buildToolPayloadAudit({
            tools: [...requireMcpToolSurface(operationContext).tools],
            config,
            ...(top === undefined ? {} : { top }),
        });
        if (compareSurfaces !== true) return okResult(currentSurface);

        const toolSurface = requireMcpToolSurface(operationContext);
        if (typeof toolSurface.resolveCanonicalSurfaces !== 'function') {
            throw new TypeError('MCP tool-surface comparison requires the registry-owned surface resolver capability.');
        }
        const surfaces = toolSurface.resolveCanonicalSurfaces().map((surface) => ({
            mode: surface.mode,
            tools: [...surface.tools],
        }));
        const usageWindowMs = (usageWindowHours ?? 24) * 60 * 60 * 1000;
        const usageRuntimeSourceBinding = 'controlled-promotion';
        const usageSnapshot = await requireMcpToolRoundTripAnalyticsCapability(operationContext).summarize({
            windowMs: usageWindowMs,
            top: 500,
            includeSynthetic: false,
            sync: false,
            runtimeSourceBinding: usageRuntimeSourceBinding,
        });
        if (usageSnapshot.queryScope?.runtimeSourceBinding !== usageRuntimeSourceBinding) {
            throw new Error(
                'MCP tool-surface usage comparison requires a controlled-promotion filtered analytics window.',
            );
        }
        const usageCompleteness = usageSnapshot.completeness;
        const usageSourceIntegrity = usageSnapshot.sourceIntegrity;
        const usageEvidenceComplete =
            usageSourceIntegrity?.status === 'materialized' &&
            usageCompleteness?.truncated === false &&
            Number(usageCompleteness.coverageRatio) === 1;
        const usageToolStarts = Array.isArray(usageSnapshot.toolStarts)
            ? usageSnapshot.toolStarts
                  .map((row) => ({ tool: String(row?.tool ?? ''), count: Number(row?.count ?? 0) }))
                  .filter((row) => row.tool && Number.isSafeInteger(row.count) && row.count > 0)
            : [];
        return okResult({
            currentSurface,
            comparison: await buildToolSurfacePayloadComparison({
                surfaces,
                config,
                ...(samples === undefined ? {} : { samples }),
                usageToolStarts,
                usageEvidenceComplete,
            }),
            usageAuthority: {
                source: 'round-trip-derived-index',
                population: 'promoted-runtime-tool-starts-in-current-catalog',
                runtimeSourceBinding: usageRuntimeSourceBinding,
                excludeSynthetic: true,
                excludeNonCurrentTools: true,
                coverageUsable: usageEvidenceComplete,
                completeness: usageCompleteness,
                sourceIntegrityStatus: usageSourceIntegrity?.status ?? null,
                windowMs: usageWindowMs,
                sync: false,
                indexedRows: usageSnapshot.indexedRows,
            },
        });
    },
});
