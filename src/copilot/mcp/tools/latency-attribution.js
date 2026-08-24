// @ts-check
/**
 * MCP wire definitions for latency pulse and cross-layer latency attribution.
 *
 * Domain evidence collection/classification belongs to diagnostics/latency/attribution; this module owns only MCP schema,
 * annotations and result framing.
 *
 * @module copilot/mcp/tools/latency-attribution
 */

import { runMcpLatencyAttributionDiagnostic } from '#copilot/mcp/public/diagnostics/latency/attribution';
import { readMcpMetricsSnapshot } from '#copilot/mcp/public/observability';
import { okResult, openWorldReadOnlyAnnotations, readOnlyAnnotations } from '#copilot/mcp/public/protocol/tools';
import { z } from 'zod';

/** @param {string} description */
function pulseExperimentLabelSchema(description) {
    return z
        .string()
        .min(1)
        .max(64)
        ['regex'](/^[A-Za-z0-9._:-]+$/u)
        .optional()
        .describe(description);
}

export const mcpLatencyPulseTool = {
    name: 'mcp_latency_pulse',
    title: 'MCP latency pulse',
    description:
        'Return a tiny no-I/O timing pulse for controlled repeated measurement of ChatGPT/model/orchestrator round-trip gaps at the MCP origin boundary.',
    inputSchema: {
        seriesId: z
            .string()
            .min(1)
            .max(64)
            ['regex'](/^[A-Za-z0-9._-]+$/u)
            .optional()
            .describe('Optional short series identifier for a controlled pulse run.'),
        step: z.number().int().min(0).max(1000).optional()['describe']('Optional pulse step number.'),
        networkLabel: pulseExperimentLabelSchema(
            'Optional sanitized client network label, for example wifi-home or hotspot-cellular.',
        ),
        modelLabel: pulseExperimentLabelSchema('Optional sanitized model label for A/B comparison.'),
        conversationLabel: pulseExperimentLabelSchema(
            'Optional sanitized conversation condition, for example fresh-chat or long-chat.',
        ),
        clientLabel: pulseExperimentLabelSchema('Optional sanitized client label, for example desktop-app or browser.'),
        vpnLabel: pulseExperimentLabelSchema('Optional sanitized VPN condition, for example off or provider-a.'),
    },
    annotations: readOnlyAnnotations(),
    handler: async (input = {}) => {
        const { seriesId, step, networkLabel, modelLabel, conversationLabel, clientLabel, vpnLabel } =
            /** @type {{ seriesId?: string; step?: number; networkLabel?: string; modelLabel?: string; conversationLabel?: string; clientLabel?: string; vpnLabel?: string }} */ (
                input
            );
        const metrics = readMcpMetricsSnapshot();
        const boundary = metrics.interaction.originBoundary;
        return okResult({
            observedAt: new Date().toISOString(),
            ...(seriesId ? { seriesId } : {}),
            ...(typeof step === 'number' ? { step } : {}),
            ...(networkLabel ? { networkLabel } : {}),
            ...(modelLabel ? { modelLabel } : {}),
            ...(conversationLabel ? { conversationLabel } : {}),
            ...(clientLabel ? { clientLabel } : {}),
            ...(vpnLabel ? { vpnLabel } : {}),
            incomingExternalGapMs: boundary.externalGaps.lastMs,
            incomingPreHandlerMs: boundary.preHandler.lastMs,
            previousPostHandlerMs: boundary.postHandler.lastMs,
            handlerGapProxyMs: metrics.interaction.gaps.lastMs,
            activeRequests: boundary.activeRequests,
        });
    },
};

export const mcpLatencyAttributionTool = {
    name: 'mcp_latency_attribution',
    title: 'MCP latency attribution',
    description:
        'Attribute perceived ChatGPT/MCP slowness across local MCP handlers, result/context pressure, Cloudflare tunnel health, fixed OpenAI reachability probes, and official aggregate status evidence without claiming visibility into the ChatGPT client/model control plane.',
    inputSchema: {
        reportedSlow: z
            .boolean()
            .optional()
            ['describe'](
                'Set true when the user is currently experiencing slowness even if local MCP metrics look healthy.',
            ),
        clientSchemaProjectionStale: z
            .boolean()
            .optional()
            ['describe'](
                'Set true only when the caller has observed a client-advertised MCP schema that is stale relative to the restarted server implementation.',
            ),
        timeoutMs: z
            .number()
            .int()
            .min(500)
            .max(5000)
            .optional()
            ['describe']('Per external probe timeout. Defaults to 2500ms.'),
        includeDetails: z
            .boolean()
            .optional()
            ['describe']('Include per-endpoint and per-source evidence. Defaults false to minimize context pressure.'),
    },
    annotations: openWorldReadOnlyAnnotations(),
    handler: async (input = {}) =>
        okResult(
            await runMcpLatencyAttributionDiagnostic(
                /** @type {{ reportedSlow?: boolean; clientSchemaProjectionStale?: boolean; timeoutMs?: number; includeDetails?: boolean }} */ (
                    input
                ),
            ),
        ),
};
