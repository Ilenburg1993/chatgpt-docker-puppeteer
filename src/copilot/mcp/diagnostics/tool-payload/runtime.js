// @ts-check
/**
 * Analyze the MCP tools/list wire payload without making network calls.
 *
 * This is intentionally read-only. It connects the real SDK server and client through an in-memory transport so Zod
 * schemas are measured only after the same JSON Schema conversion used on the wire.
 *
 * @module copilot/mcp/diagnostics/tool-payload/runtime
 */
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { performance } from 'node:perf_hooks';

/**
 * @param {{
 *     tools: import('#copilot/mcp/public/protocol/catalog').McpToolDefinition[];
 *     config: import('./config.js').McpToolPayloadAuditConfig;
 *     top?: number;
 *     maxEnvelopeBytes?: number;
 * }} options
 * @returns {Promise<Record<string, unknown>>}
 */
export async function buildToolPayloadAudit(options) {
    if (!Array.isArray(options?.tools)) {
        throw new TypeError('[mcp/tool-payload-audit] options.tools deve conter a superfície canônica de ferramentas.');
    }
    if (!options.config) {
        throw new TypeError('[mcp/tool-payload-audit] options.config deve conter a geração processual do diagnóstico.');
    }
    const top = readPositiveInteger(options.top ?? options.config.top, options.config.top, 1, 200);
    const maxEnvelopeBytes = readPositiveInteger(
        options.maxEnvelopeBytes ?? options.config.maxEnvelopeBytes,
        options.config.maxEnvelopeBytes,
        1024,
        16 * 1024 * 1024,
    );
    const wire = await listWireMcpTools(options.tools);
    const tools = wire.tools;
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
        p50ToolBytes: percentile(
            toolRows.map((row) => row.totalBytes),
            0.5,
        ),
        p95ToolBytes: percentile(
            toolRows.map((row) => row.totalBytes),
            0.95,
        ),
        timings: wire.timings,
        topTools: toolRows.slice(0, top),
        recommendations: buildRecommendations(totals, totalEnvelopeBytes),
    };
}

/**
 * Ask the real MCP SDK for tools/list through an in-memory transport. This avoids serializing internal Zod state and
 * stays aligned with the SDK's schema conversion, omitted fields, and execution metadata.
 *
 * @param {import('#copilot/mcp/public/protocol/catalog').McpToolDefinition[]} tools
 * @returns {Promise<{
 *   tools: Awaited<ReturnType<Client['listTools']>>['tools'];
 *   timings: { registerMs:number; connectMs:number; listMs:number; closeMs:number; totalMs:number };
 * }>}
 */
async function listWireMcpTools(tools) {
    const totalStarted = performance.now();
    const server = new McpServer({ name: 'copilot-mcp-tool-payload-audit', version: '1.0.0' });
    const registerStarted = performance.now();
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
    const registerMs = elapsedMs(registerStarted);
    const client = new Client({ name: 'copilot-mcp-tool-payload-audit-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    /** @type {{ tools: Awaited<ReturnType<Client['listTools']>>['tools']; connectMs:number; listMs:number; closeMs?:number } | undefined} */
    let measurement;
    try {
        const connectStarted = performance.now();
        await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
        const connectMs = elapsedMs(connectStarted);
        const listStarted = performance.now();
        const listedTools = (await client.listTools()).tools;
        const listMs = elapsedMs(listStarted);
        measurement = { tools: listedTools, connectMs, listMs };
    } finally {
        const closeStarted = performance.now();
        await Promise.allSettled([client.close(), server.close()]);
        if (measurement) measurement.closeMs = elapsedMs(closeStarted);
    }
    if (!measurement) throw new Error('[mcp/tool-payload-audit] SDK tools/list did not return a descriptor set.');
    return {
        tools: measurement.tools,
        timings: {
            registerMs,
            connectMs: measurement.connectMs,
            listMs: measurement.listMs,
            closeMs: measurement.closeMs ?? 0,
            totalMs: elapsedMs(totalStarted),
        },
    };
}

/**
 * Compare multiple explicit tool surfaces through the same SDK wire path used by buildToolPayloadAudit.
 *
 * @param {{
 *   surfaces: { mode:string; aliases?:string[]; tools: import('#copilot/mcp/public/protocol/catalog').McpToolDefinition[] }[];
 *   config: import('./config.js').McpToolPayloadAuditConfig;
 *   samples?: number;
 *   usageToolStarts?: { tool:string; count:number }[];
 *   usageEvidenceComplete?: boolean;
 * }} options
 */
export async function buildToolSurfacePayloadComparison(options) {
    if (!Array.isArray(options?.surfaces) || options.surfaces.length === 0) {
        throw new TypeError('[mcp/tool-payload-audit] surface comparison requires explicit surfaces.');
    }
    const samples = readPositiveInteger(options.samples, 3, 1, 9);
    const usageEvidenceComplete = options.usageEvidenceComplete !== false;
    const rawUsageToolStarts = normalizeUsageToolStarts(options.usageToolStarts);
    const fullSurface = options.surfaces.find((surface) => surface.mode === 'full') ?? options.surfaces[0];
    if (!fullSurface) throw new Error('[mcp/tool-payload-audit] surface comparison requires a full reference surface.');
    const currentToolNames = new Set(fullSurface.tools.map((tool) => tool.name));
    const excludedNonCurrentUsage = rawUsageToolStarts
        .filter((row) => !currentToolNames.has(row.tool))
        .sort((left, right) => right.count - left.count || left.tool.localeCompare(right.tool));
    const usageToolStarts = rawUsageToolStarts.filter((row) => currentToolNames.has(row.tool));
    const rows = [];
    for (const surface of options.surfaces) {
        const audits = [];
        for (let index = 0; index < samples; index += 1) {
            audits.push(await buildToolPayloadAudit({ tools: surface.tools, config: options.config, top: 1 }));
        }
        const representative = audits.at(-1);
        if (!representative) continue;
        const timings = audits.map((audit) => /** @type {Record<string, number>} */ (audit['timings']));
        rows.push({
            mode: surface.mode,
            aliases: Array.isArray(surface.aliases) ? [...surface.aliases] : [],
            toolCount: representative['toolCount'],
            totalEnvelopeBytes: representative['totalEnvelopeBytes'],
            averageToolBytes: representative['averageToolBytes'],
            p95ToolBytes: representative['p95ToolBytes'],
            timingsMs: {
                listP50: percentile(
                    timings.map((row) => row['listMs'] ?? 0),
                    0.5,
                ),
                listP95: percentile(
                    timings.map((row) => row['listMs'] ?? 0),
                    0.95,
                ),
                totalP50: percentile(
                    timings.map((row) => row['totalMs'] ?? 0),
                    0.5,
                ),
                totalP95: percentile(
                    timings.map((row) => row['totalMs'] ?? 0),
                    0.95,
                ),
            },
            usage: measureSurfaceUsageCoverage(surface.tools, usageToolStarts),
        });
    }
    const full = rows.find((row) => row.mode === 'full') ?? rows[0];
    if (!full) throw new Error('[mcp/tool-payload-audit] surface comparison produced no rows.');
    const fullBytes = Number(full.totalEnvelopeBytes ?? 0);
    const fullTools = Number(full.toolCount ?? 0);
    const ranked = rows.map((row) => {
        const bytes = Number(row.totalEnvelopeBytes ?? 0);
        const toolCount = Number(row.toolCount ?? 0);
        return {
            ...row,
            versusFull: {
                toolReduction: Math.max(0, fullTools - toolCount),
                toolReductionPercent: ratioPercent(Math.max(0, fullTools - toolCount), fullTools),
                envelopeSavingsBytes: Math.max(0, fullBytes - bytes),
                envelopeSavingsPercent: ratioPercent(Math.max(0, fullBytes - bytes), fullBytes),
            },
        };
    });
    const highCoverage = usageEvidenceComplete
        ? ranked.filter((row) => Number(row.usage.weightedCoverage ?? 0) >= 0.98 && row.mode !== 'full')
        : [];
    const rankedHighCoverage = highCoverage.sort(
        (left, right) => Number(right.versusFull.envelopeSavingsBytes) - Number(left.versusFull.envelopeSavingsBytes),
    );
    return {
        ok: true,
        measurement: 'sdk-in-memory-tools/list-surface-matrix',
        samplesPerSurface: samples,
        usageSample: {
            available: usageToolStarts.length > 0,
            complete: usageEvidenceComplete,
            rawObservedCalls: rawUsageToolStarts.reduce((sum, row) => sum + row.count, 0),
            totalObservedCalls: usageToolStarts.reduce((sum, row) => sum + row.count, 0),
            distinctObservedTools: usageToolStarts.length,
            excludedNonCurrentCalls: excludedNonCurrentUsage.reduce((sum, row) => sum + row.count, 0),
            excludedNonCurrentToolCount: excludedNonCurrentUsage.length,
            excludedNonCurrentTop: excludedNonCurrentUsage.slice(0, 20),
        },
        fullReference: { toolCount: fullTools, totalEnvelopeBytes: fullBytes },
        surfaces: ranked,
        evidence: {
            highCoverageReducedModes: rankedHighCoverage.map((row) => row.mode),
            defaultChangeRecommended: false,
            reason: !usageEvidenceComplete
                ? 'Usage evidence is incomplete for the requested window; surface coverage remains diagnostic-only and cannot nominate a reduced mode.'
                : rankedHighCoverage.length > 0
                  ? 'Reduced surfaces show local SDK/payload benefit with observed-usage coverage; a real host A/B is still required before changing the default surface.'
                  : 'No reduced surface reaches 98% observed-call coverage; keep full until the surface policy is improved and host A/B evidence exists.',
        },
    };
}

/** @param {number} started */
function elapsedMs(started) {
    return Math.round((performance.now() - started) * 1000) / 1000;
}

/** @param {{ tool:string; count:number }[] | undefined} rows */
function normalizeUsageToolStarts(rows) {
    if (!Array.isArray(rows)) return [];
    return rows
        .map((row) => ({ tool: String(row?.tool ?? '').trim(), count: Number(row?.count ?? 0) }))
        .filter((row) => row.tool.length > 0 && Number.isSafeInteger(row.count) && row.count > 0)
        .slice(0, 500);
}

/**
 * @param {import('#copilot/mcp/public/protocol/catalog').McpToolDefinition[]} tools
 * @param {{ tool:string; count:number }[]} usage
 */
function measureSurfaceUsageCoverage(tools, usage) {
    const names = new Set(tools.map((tool) => tool.name));
    const totalObservedCalls = usage.reduce((sum, row) => sum + row.count, 0);
    const missing = usage.filter((row) => !names.has(row.tool)).sort((left, right) => right.count - left.count);
    const missingCalls = missing.reduce((sum, row) => sum + row.count, 0);
    const coveredCalls = Math.max(0, totalObservedCalls - missingCalls);
    return {
        available: usage.length > 0,
        totalObservedCalls,
        coveredCalls,
        weightedCoverage: totalObservedCalls > 0 ? coveredCalls / totalObservedCalls : null,
        missingObservedToolCount: missing.length,
        topMissingObservedTools: missing.slice(0, 8),
    };
}

/** @param {number} numerator @param {number} denominator */
function ratioPercent(numerator, denominator) {
    return denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 100 : 0;
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
