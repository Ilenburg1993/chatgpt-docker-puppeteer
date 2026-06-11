// @ts-check
/**
 * Post-change gates for Cloudflare MCP operations.
 *
 * @module copilot/mcp/tools/cloudflare-post-change-gates
 */

import { z } from 'zod';
import { auditCloudflareRemoteTunnel, readCloudflaredMetricsSnapshot } from '#copilot/mcp/cloudflare';
import { okResult, readOnlyAnnotations } from '#copilot/mcp/control-plane';
import { mcpTunnelStatusTool } from './tunnel-status.js';

const MIN_HA_CONNECTIONS = 4;
const MAX_ERROR_RATE = 0;
const MAX_RPC_P95_MS = 2_500;
const MAX_QUIC_RTT_MS = 5_000;

/** @type {import('../registry.js').McpToolDefinition} */
export const mcpCloudflarePostChangeGatesTool = {
    name: 'mcp_cloudflare_post_change_gates',
    title: 'Cloudflare post-change gates',
    description:
        'Run a read-only gate bundle after Cloudflare tunnel/origin/edge changes: tunnel status, remote audit, metrics and pass/fail recommendations.',
    inputSchema: {
        includeDetails: z.boolean().optional().describe('Include full tunnel, remote audit and metrics objects. Defaults to false for faster compact responses.'),
    },
    annotations: readOnlyAnnotations(),
    handler: async (input) => okResult(await runCloudflarePostChangeGates({ includeDetails: input['includeDetails'] === true })),
};

/**
 * @param {{ includeDetails?: boolean }} [options]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function runCloudflarePostChangeGates(options = {}) {
    const [tunnelStatus, remoteAudit, metrics] = await Promise.all([
        safeTunnelStatus(),
        safeRemoteAudit(),
        safeMetricsSnapshot(),
    ]);
    const gateResults = evaluateGates({ tunnelStatus, remoteAudit, metrics });
    const base = {
        ok: gateResults.critical.length === 0,
        success: true,
        mode: 'read-only-post-change-gates',
        appliesChanges: false,
        summary: buildPostChangeGateSummary({ tunnelStatus, remoteAudit, metrics }),
        gates: gateResults,
        nextActions:
            gateResults.critical.length === 0
                ? ['Post-change gates passed. Keep monitoring metrics before promoting the change as default.']
                : ['Rollback or hold the change until every critical post-change gate passes.'],
    };
    return options.includeDetails === true
        ? { ...base, tunnelStatus, remoteAudit, metrics }
        : base;
}

/**
 * @returns {Promise<Record<string, unknown>>}
 */
/**
 * @param {{ tunnelStatus: Record<string, unknown>; remoteAudit: Record<string, unknown>; metrics: Record<string, unknown> }} input
 * @returns {Record<string, unknown>}
 */
function buildPostChangeGateSummary(input) {
    const permanentTunnel = asRecord(input.tunnelStatus['permanentTunnel']);
    const remote = asRecord(input.remoteAudit['remote']);
    const connections = asRecord(remote['connections']);
    const operational = asRecord(input.metrics['operational']);
    const quic = asRecord(input.metrics['quic']);
    const latency = asRecord(input.metrics['latency']);
    const rpc = asRecord(latency['rpcClientLatency']);
    return {
        transportProtocol: permanentTunnel['transportProtocol'] ?? input.tunnelStatus['transportProtocol'] ?? null,
        lastSmokeFresh: permanentTunnel['lastSmokeFresh'] ?? null,
        remoteActiveConnections: connections['active'] ?? null,
        metricsOk: input.metrics['ok'] ?? null,
        haConnections: operational['haConnections'] ?? null,
        requestErrorRate: operational['requestErrorRate'] ?? null,
        quicPresent: quic['present'] ?? null,
        rpcClientP95Ms: rpc['p95Ms'] ?? null,
    };
}

async function safeTunnelStatus() {
    try {
        return extractStructuredContent(await mcpTunnelStatusTool.handler({}));
    } catch (error) {
        return { success: false, error: sanitizeError(error) };
    }
}

/**
 * @returns {Promise<Record<string, unknown>>}
 */
async function safeRemoteAudit() {
    try {
        return await auditCloudflareRemoteTunnel();
    } catch (error) {
        return { ok: false, success: false, error: sanitizeError(error), critical: ['Cloudflare remote audit threw before returning a structured result.'] };
    }
}

async function safeMetricsSnapshot() {
    try {
        return await readCloudflaredMetricsSnapshot({ timeoutMs: 3000 });
    } catch (error) {
        return { ok: false, error: sanitizeError(error) };
    }
}

/**
 * @param {{ tunnelStatus: Record<string, unknown>; remoteAudit: Record<string, unknown>; metrics: Record<string, unknown> }} input
 * @returns {{ critical: string[]; warnings: string[]; passed: string[] }}
 */
export function evaluateGates(input) {
    /** @type {string[]} */
    const critical = [];
    /** @type {string[]} */
    const warnings = [];
    /** @type {string[]} */
    const passed = [];

    if (input.tunnelStatus['success'] === true) passed.push('tunnel status returned success=true.');
    else critical.push('mcp_tunnel_status equivalent did not return success=true.');

    const permanentTunnel = asRecord(input.tunnelStatus['permanentTunnel']);
    const originDiagnostics = asRecord(permanentTunnel['originDiagnostics']);
    const lastSmokeCheckedAt = asRecord(permanentTunnel['lastSmoke'])['checkedAt'];
    const recentOriginErrors = filterActionableOriginErrors(
        Array.isArray(originDiagnostics['recentOriginErrors']) ? originDiagnostics['recentOriginErrors'] : [],
        lastSmokeCheckedAt,
    );
    const recentTunnelTransportErrors = filterRecentLogLines(
        Array.isArray(originDiagnostics['recentTunnelTransportErrors']) ? originDiagnostics['recentTunnelTransportErrors'] : [],
        lastSmokeCheckedAt,
    );
    const recentMetricsBindErrors = filterRecentLogLines(
        Array.isArray(originDiagnostics['recentMetricsBindErrors']) ? originDiagnostics['recentMetricsBindErrors'] : [],
        lastSmokeCheckedAt,
    );
    if (permanentTunnel['lastSmokeFresh'] === true) passed.push('permanent tunnel smoke is fresh.');
    else critical.push('permanent tunnel smoke is not fresh.');
    if (recentOriginErrors.length === 0) passed.push('no actionable origin errors after the latest smoke.');
    else critical.push(`actionable origin errors after latest smoke: ${recentOriginErrors.length}.`);
    if (recentTunnelTransportErrors.length > 0) warnings.push(`recent tunnel transport errors after latest smoke: ${recentTunnelTransportErrors.length}; recovered state is judged by HA connections, smoke and metrics.`);
    if (recentMetricsBindErrors.length > 0) warnings.push(`recent cloudflared metrics bind errors after latest smoke: ${recentMetricsBindErrors.length}; ensure restart serialization remains enabled.`);

    if (input.remoteAudit['ok'] === true) passed.push('Cloudflare remote audit ok=true.');
    else critical.push('Cloudflare remote audit did not return ok=true.');
    const remote = asRecord(input.remoteAudit['remote']);
    const connections = asRecord(remote['connections']);
    const activeConnections = toNumber(connections['active']);
    if (activeConnections !== null && activeConnections >= MIN_HA_CONNECTIONS) {
        passed.push(`remote active HA connections >= ${MIN_HA_CONNECTIONS}.`);
    } else {
        critical.push(`remote active HA connections below ${MIN_HA_CONNECTIONS}.`);
    }

    if (input.metrics['ok'] === true) passed.push('cloudflared metrics snapshot ok=true.');
    else critical.push('cloudflared metrics snapshot did not return ok=true.');
    const operational = asRecord(input.metrics['operational']);
    const requestErrorRate = toNumber(operational['requestErrorRate']);
    const metricHaConnections = toNumber(operational['haConnections']);
    if (requestErrorRate !== null && requestErrorRate <= MAX_ERROR_RATE) {
        passed.push('requestErrorRate is 0.');
    } else {
        critical.push('requestErrorRate is above 0 or unavailable.');
    }
    if (metricHaConnections !== null && metricHaConnections >= MIN_HA_CONNECTIONS) {
        passed.push(`metrics haConnections >= ${MIN_HA_CONNECTIONS}.`);
    } else {
        critical.push(`metrics haConnections below ${MIN_HA_CONNECTIONS}.`);
    }

    const transportProtocol = String(permanentTunnel['transportProtocol'] ?? input.tunnelStatus['transportProtocol'] ?? '');
    const quic = asRecord(input.metrics['quic']);
    if (transportProtocol === 'quic') {
        if (quic['present'] === true) passed.push('QUIC metrics are present for strict QUIC transport.');
        else critical.push('strict QUIC transport is configured, but quic_client_* metrics are missing.');
        const latestRttMs = toNumber(quic['latestRttMs']);
        const smoothedRttMs = toNumber(quic['smoothedRttMs']);
        const effectiveRttMs = smoothedRttMs ?? latestRttMs;
        if (effectiveRttMs === null) warnings.push('QUIC RTT metrics unavailable; collect more samples before final promotion.');
        else if (effectiveRttMs > MAX_QUIC_RTT_MS) warnings.push(`QUIC RTT appears high: ${effectiveRttMs}ms.`);
        else passed.push(`QUIC RTT within budget: ${effectiveRttMs}ms.`);
    }

    const latency = asRecord(input.metrics['latency']);
    const rpc = asRecord(latency['rpcClientLatency']);
    const p95 = toNumber(rpc['p95Ms']);
    if (p95 === null) warnings.push('rpcClientLatency.p95Ms unavailable; collect more samples before final promotion.');
    else if (p95 > MAX_RPC_P95_MS) warnings.push(`rpcClientLatency.p95Ms above budget: ${p95}ms.`);
    else passed.push(`rpcClientLatency.p95Ms within budget: ${p95}ms.`);

    return { critical, warnings, passed };
}

/**
 * @param {import('@modelcontextprotocol/sdk/types.js').CallToolResult} result
 * @returns {Record<string, unknown>}
 */
function extractStructuredContent(result) {
    const structured = /** @type {Record<string, unknown> | undefined} */ (result.structuredContent);
    if (structured && typeof structured === 'object' && !Array.isArray(structured)) return structured;
    const text = result.content
        ?.map((item) => (item.type === 'text' ? item.text : ''))
        .filter(Boolean)
        .join('\n');
    if (!text) return { success: false, error: 'missing structured content' };
    try {
        return asRecord(JSON.parse(text));
    } catch (error) {
        return { success: false, error: sanitizeError(error) };
    }
}

/**
 * @param {unknown[]} lines
 * @param {unknown} checkedAt
 * @returns {string[]}
 */
function filterActionableOriginErrors(lines, checkedAt) {
    return filterRecentLogLines(lines, checkedAt).filter((line) =>
        /origin service|originService=|first record does not look like a TLS handshake|connection refused|502|1033/iu.test(line),
    );
}

/**
 * @param {unknown[]} lines
 * @param {unknown} checkedAt
 * @returns {string[]}
 */
function filterRecentLogLines(lines, checkedAt) {
    const checkedAtMs = Date.parse(String(checkedAt ?? ''));
    return lines.map(String).filter((line) => {
        if (!Number.isFinite(checkedAtMs)) return true;
        const lineTime = Date.parse(line.slice(0, 20));
        return !Number.isFinite(lineTime) || lineTime >= checkedAtMs;
    });
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : {};
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function toNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function sanitizeError(error) {
    return error instanceof Error ? error.message : String(error);
}
