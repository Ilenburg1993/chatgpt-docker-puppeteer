// @ts-check
/**
 * Analyze MCP tools/list payload size without making network calls.
 *
 * This is intentionally read-only. It helps decide which descriptor fields dominate tools/list latency before changing
 * the public tool surface.
 *
 * @module copilot/mcp/scripts/tool-payload-audit
 */

import { pathToFileURL } from 'node:url';
import { getCanonicalMcpTools } from '../registry.js';

const DEFAULT_TOP = 20;

/**
 * @param {{ top?: number }} [options]
 * @returns {Record<string, unknown>}
 */
export function buildToolPayloadAudit(options = {}) {
    const top = readPositiveInteger(options.top ?? process.env['COPILOT_MCP_TOOL_PAYLOAD_TOP'], DEFAULT_TOP, 1, 200);
    const tools = getCanonicalMcpTools();
    const toolRows = tools
        .map((tool) => {
            const totalBytes = jsonBytes(tool);
            return {
                name: tool.name,
                totalBytes,
                descriptionBytes: stringBytes(tool.description ?? ''),
                inputSchemaBytes: jsonBytes(tool.inputSchema ?? null),
                outputSchemaBytes: jsonBytes(tool.outputSchema ?? null),
                annotationsBytes: jsonBytes(tool.annotations ?? null),
                securitySchemesBytes: jsonBytes(tool.securitySchemes ?? null),
                metaBytes: jsonBytes(tool._meta ?? null),
            };
        })
        .sort((left, right) => right.totalBytes - left.totalBytes);

    const totals = toolRows.reduce(
        (acc, row) => {
            acc.totalBytes += row.totalBytes;
            acc.descriptionBytes += row.descriptionBytes;
            acc.inputSchemaBytes += row.inputSchemaBytes;
            acc.outputSchemaBytes += row.outputSchemaBytes;
            acc.annotationsBytes += row.annotationsBytes;
            acc.securitySchemesBytes += row.securitySchemesBytes;
            acc.metaBytes += row.metaBytes;
            return acc;
        },
        {
            totalBytes: 0,
            descriptionBytes: 0,
            inputSchemaBytes: 0,
            outputSchemaBytes: 0,
            annotationsBytes: 0,
            securitySchemesBytes: 0,
            metaBytes: 0,
        },
    );

    const listEnvelope = {
        jsonrpc: '2.0',
        id: 1,
        result: { tools },
    };
    const totalEnvelopeBytes = jsonBytes(listEnvelope);

    return {
        ok: true,
        toolCount: tools.length,
        totalEnvelopeBytes,
        totalToolsBytes: totals.totalBytes,
        fieldTotals: totals,
        averageToolBytes: tools.length > 0 ? Math.round(totals.totalBytes / tools.length) : 0,
        p50ToolBytes: percentile(toolRows.map((row) => row.totalBytes), 0.5),
        p95ToolBytes: percentile(toolRows.map((row) => row.totalBytes), 0.95),
        topTools: toolRows.slice(0, top),
        recommendations: buildRecommendations(totals, totalEnvelopeBytes),
    };
}

/**
 * @param {Record<string, number>} totals
 * @param {number} totalEnvelopeBytes
 * @returns {string[]}
 */
function buildRecommendations(totals, totalEnvelopeBytes) {
    const recommendations = [];
    const fieldEntries = Object.entries(totals)
        .filter(([key]) => key !== 'totalBytes')
        .sort((left, right) => right[1] - left[1]);
    const [largestField, largestBytes] = fieldEntries[0] ?? ['unknown', 0];
    if (largestBytes > totalEnvelopeBytes * 0.25) {
        recommendations.push(`Largest field family is ${largestField}; prioritize it for compact descriptors.`);
    }
    if ((totals['metaBytes'] ?? 0) + (totals['securitySchemesBytes'] ?? 0) > totalEnvelopeBytes * 0.2) {
        recommendations.push(
            'Repeated MCP security metadata is large; keep mirrors for compatibility, but test whether compact mode can be gated by client capability.',
        );
    }
    if ((totals['descriptionBytes'] ?? 0) > totalEnvelopeBytes * 0.15) {
        recommendations.push(
            'Descriptions are a meaningful share; prefer concise operational descriptions and move long guidance into docs/tools.',
        );
    }
    recommendations.push(
        'Do not cache /mcp; optimize tools/list with descriptor compaction, transport benchmarking, and host-side request reuse.',
    );
    return recommendations;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function jsonBytes(value) {
    return Buffer.byteLength(JSON.stringify(value));
}

/**
 * @param {string} value
 * @returns {number}
 */
function stringBytes(value) {
    return Buffer.byteLength(value);
}

/**
 * @param {number[]} values
 * @param {number} quantile
 * @returns {number}
 */
function percentile(values, quantile) {
    if (values.length === 0) return 0;
    const sorted = values.slice().sort((left, right) => left - right);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
    return sorted[index] ?? 0;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} minimum
 * @param {number} maximum
 * @returns {number}
 */
function readPositiveInteger(value, fallback, minimum, maximum) {
    const parsed = Number(value ?? fallback);
    return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? Math.floor(parsed) : fallback;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    process.stdout.write(`${JSON.stringify(buildToolPayloadAudit(), null, 2)}\n`);
}
