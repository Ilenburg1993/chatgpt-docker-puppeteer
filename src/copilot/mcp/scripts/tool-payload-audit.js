// @ts-check
/**
 * Analyze the MCP tools/list wire payload without making network calls.
 *
 * This is intentionally read-only. It connects the real SDK server and client through an in-memory transport so Zod
 * schemas are measured only after the same JSON Schema conversion used on the wire.
 *
 * @module copilot/mcp/scripts/tool-payload-audit
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MCP_TOOL_EXECUTION_LIMITS } from '../control-plane/tool-capabilities.js';

const DEFAULT_TOP = 20;
const DEFAULT_MAX_ENVELOPE_BYTES = MCP_TOOL_EXECUTION_LIMITS.toolsList.maxEnvelopeBytes;

/**
 * @param {{
 *     tools: import('../registry.js').McpToolDefinition[];
 *     top?: number;
 *     maxEnvelopeBytes?: number;
 * }} options
 * @returns {Promise<Record<string, unknown>>}
 */
export async function buildToolPayloadAudit(options) {
    if (!Array.isArray(options?.tools)) {
        throw new TypeError('[mcp/tool-payload-audit] options.tools deve conter a superfície canônica de ferramentas.');
    }
    const top = readPositiveInteger(options.top ?? process.env['COPILOT_MCP_TOOL_PAYLOAD_TOP'], DEFAULT_TOP, 1, 200);
    const maxEnvelopeBytes = readPositiveInteger(
        options.maxEnvelopeBytes ?? process.env['COPILOT_MCP_TOOL_PAYLOAD_MAX_BYTES'],
        DEFAULT_MAX_ENVELOPE_BYTES,
        1024,
        16 * 1024 * 1024,
    );
    const tools = await listWireMcpTools(options.tools);
    const toolRows = tools
        .map((tool) => {
            const totalBytes = jsonBytes(tool);
            const inputSchemaBytes = jsonBytes(tool.inputSchema ?? null);
            const inputSchemaWithoutDescriptionsBytes = jsonBytes(stripJsonDescriptions(tool.inputSchema ?? null));
            const inputSchemaWith48CharDescriptionsBytes = jsonBytes(
                compactJsonDescriptions(tool.inputSchema ?? null, 48),
            );
            const inputSchemaWith64CharDescriptionsBytes = jsonBytes(
                compactJsonDescriptions(tool.inputSchema ?? null, 64),
            );
            return {
                name: tool.name,
                totalBytes,
                nameBytes: stringBytes(tool.name),
                titleBytes: stringBytes(tool.title ?? ''),
                descriptionBytes: stringBytes(tool.description ?? ''),
                inputSchemaBytes,
                inputSchemaDescriptionBytes: Math.max(0, inputSchemaBytes - inputSchemaWithoutDescriptionsBytes),
                inputSchemaWithoutDescriptionsBytes,
                inputSchema48CharSavingsBytes: Math.max(0, inputSchemaBytes - inputSchemaWith48CharDescriptionsBytes),
                inputSchema64CharSavingsBytes: Math.max(0, inputSchemaBytes - inputSchemaWith64CharDescriptionsBytes),
                outputSchemaBytes: jsonBytes(tool.outputSchema ?? null),
                annotationsBytes: jsonBytes(tool.annotations ?? null),
                executionBytes: jsonBytes(tool.execution ?? null),
                metaBytes: jsonBytes(tool._meta ?? null),
            };
        })
        .sort((left, right) => right.totalBytes - left.totalBytes);

    const totals = toolRows.reduce(
        (acc, row) => {
            acc.totalBytes += row.totalBytes;
            acc.nameBytes += row.nameBytes;
            acc.titleBytes += row.titleBytes;
            acc.descriptionBytes += row.descriptionBytes;
            acc.inputSchemaBytes += row.inputSchemaBytes;
            acc.inputSchemaDescriptionBytes += row.inputSchemaDescriptionBytes;
            acc.inputSchemaWithoutDescriptionsBytes += row.inputSchemaWithoutDescriptionsBytes;
            acc.inputSchema48CharSavingsBytes += row.inputSchema48CharSavingsBytes;
            acc.inputSchema64CharSavingsBytes += row.inputSchema64CharSavingsBytes;
            acc.outputSchemaBytes += row.outputSchemaBytes;
            acc.annotationsBytes += row.annotationsBytes;
            acc.executionBytes += row.executionBytes;
            acc.metaBytes += row.metaBytes;
            return acc;
        },
        {
            totalBytes: 0,
            nameBytes: 0,
            titleBytes: 0,
            descriptionBytes: 0,
            inputSchemaBytes: 0,
            inputSchemaDescriptionBytes: 0,
            inputSchemaWithoutDescriptionsBytes: 0,
            inputSchema48CharSavingsBytes: 0,
            inputSchema64CharSavingsBytes: 0,
            outputSchemaBytes: 0,
            annotationsBytes: 0,
            executionBytes: 0,
            metaBytes: 0,
        },
    );

    const listEnvelope = {
        jsonrpc: '2.0',
        id: 1,
        result: { tools },
    };
    const totalEnvelopeBytes = jsonBytes(listEnvelope);
    const budgetHeadroomBytes = maxEnvelopeBytes - totalEnvelopeBytes;

    return {
        ok: true,
        measurement: 'sdk-in-memory-tools/list',
        toolCount: tools.length,
        totalEnvelopeBytes,
        maxEnvelopeBytes,
        withinEnvelopeBudget: budgetHeadroomBytes >= 0,
        budgetHeadroomBytes,
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
 * Ask the real MCP SDK for tools/list through an in-memory transport. This avoids serializing internal Zod state and
 * stays aligned with the SDK's schema conversion, omitted fields, and execution metadata.
 *
 * @param {import('../registry.js').McpToolDefinition[]} tools
 * @returns {Promise<Awaited<ReturnType<Client['listTools']>>['tools']>}
 */
async function listWireMcpTools(tools) {
    const server = new McpServer({ name: 'copilot-mcp-tool-payload-audit', version: '1.0.0' });
    for (const tool of tools) {
        server.registerTool(
            tool.name,
            /** @type {Parameters<McpServer['registerTool']>[1]} */ ({
                title: tool.title,
                description: tool.description,
                inputSchema: tool.inputSchema,
                annotations: tool.annotations,
                ...(tool.outputSchema !== undefined ? { outputSchema: tool.outputSchema } : {}),
                ...(tool.securitySchemes !== undefined ? { securitySchemes: tool.securitySchemes } : {}),
                ...(tool._meta !== undefined ? { _meta: tool._meta } : {}),
            }),
            async (args) => tool.handler(args),
        );
    }
    const client = new Client({ name: 'copilot-mcp-tool-payload-audit-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
        await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
        return (await client.listTools()).tools;
    } finally {
        await Promise.allSettled([client.close(), server.close()]);
    }
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
    if ((totals['metaBytes'] ?? 0) > totalEnvelopeBytes * 0.15) {
        recommendations.push(
            'Repeated MCP metadata is large; keep compatibility mirrors, but test compact metadata only behind an explicit client capability.',
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
 * Remove only JSON Schema `description` keys for a counterfactual byte measurement. Validation keywords, enums,
 * required arrays, bounds and schema shape are preserved exactly.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
function stripJsonDescriptions(value) {
    if (Array.isArray(value)) return value.map(stripJsonDescriptions);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
        Object.entries(/** @type {Record<string, unknown>} */ (value))
            .filter(([key]) => key !== 'description')
            .map(([key, child]) => [key, stripJsonDescriptions(child)]),
    );
}

/** @param {unknown} value @param {number} maxChars @returns {unknown} */
function compactJsonDescriptions(value, maxChars) {
    if (Array.isArray(value)) return value.map((child) => compactJsonDescriptions(child, maxChars));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
        Object.entries(/** @type {Record<string, unknown>} */ (value)).map(([key, child]) => {
            if (key === 'description' && typeof child === 'string') return [key, compactDescription(child, maxChars)];
            return [key, compactJsonDescriptions(child, maxChars)];
        }),
    );
}

/** @param {string} value @param {number} maxChars */
function compactDescription(value, maxChars) {
    const normalized = value.replace(/\s+/gu, ' ').trim();
    if (normalized.length <= maxChars) return normalized;
    const candidate = normalized.slice(0, maxChars + 1);
    const lastBoundary = Math.max(candidate.lastIndexOf(' '), candidate.lastIndexOf(';'), candidate.lastIndexOf(','));
    const cutoff = lastBoundary >= Math.floor(maxChars * 0.65) ? lastBoundary : maxChars;
    return `${normalized.slice(0, cutoff).trimEnd()}…`;
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
