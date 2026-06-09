// @ts-check
/**
 * Post-change gates for Cloudflare MCP operations.
 *
 * @module copilot/mcp/tools/cloudflare-post-change-gates
 */

import { auditCloudflareRemoteTunnel, readCloudflaredMetricsSnapshot } from '#copilot/mcp/cloudflare';
import { okResult, readOnlyAnnotations } from '#copilot/mcp/control-plane';
import { mcpTunnelStatusTool } from './tunnel-status.js';

const MIN_HA_CONNECTIONS = 4;
const MAX_ERROR_RATE = 0;

/** @type {import('../registry.js').McpToolDefinition} */
export const mcpCloudflarePostChangeGatesTool = {
    name: 'mcp_cloudflare_post_change_gates',
    title: 'Cloudflare post-change gates',
    description:
        'Run a read-only gate bundle after Cloudflare tunnel/origin/edge changes: tunnel status, remote audit, metrics and pass/fail recommendations.',
    inputSchema: {},
    annotations: readOnlyAnnotations(),
    handler: async () => okResult(await runCloudflarePostChangeGates()),
};

/**
 * @returns {Promise<Record<string, unknown>>}
 */
export async function runCloudflarePostChangeGates() {
    const tunnelStatus = await safeTunnelStatus();
    const remoteAudit = await auditCloudflareRemoteTunnel();
    const metrics = await safeMetricsSnapshot();
    const gateResults = evaluateGates({ tunnelStatus, remoteAudit, metrics });
    return {
        ok: gateResults.critical.length === 0,
        success: true,
        mode: 'read-only-post-change-gates',
        appliesChanges: false,
        tunnelStatus,
        remoteAudit,
        metrics,
        gates: gateResults,
        nextActions:
            gateResults.critical.length === 0
                ? ['Post-change gates passed. Keep monitoring metrics before promoting the change as default.']
                : ['Rollback or hold the change until every critical post-change gate passes.'],
    };
}

/**
 * @returns {Promise<Record<string, unknown>>}
 */
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
function evaluateGates(input) {
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
    const recentOriginErrors = filterActionableOriginErrors(
        Array.isArray(originDiagnostics['recentOriginErrors']) ? originDiagnostics['recentOriginErrors'] : [],
        asRecord(permanentTunnel['lastSmoke'])['checkedAt'],
    );
    if (permanentTunnel['lastSmokeFresh'] === true) passed.push('permanent tunnel smoke is fresh.');
    else critical.push('permanent tunnel smoke is not fresh.');
    if (recentOriginErrors.length === 0) passed.push('no actionable origin errors after the latest smoke.');
    else critical.push(`actionable origin errors after latest smoke: ${recentOriginErrors.length}.`);

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

    const latency = asRecord(input.metrics['latency']);
    const rpc = asRecord(latency['rpcClientLatency']);
    const p95 = toNumber(rpc['p95Ms']);
    if (p95 === null) warnings.push('rpcClientLatency.p95Ms unavailable; collect more samples before final promotion.');
    else passed.push(`rpcClientLatency.p95Ms available: ${p95}.`);

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
    const checkedAtMs = Date.parse(String(checkedAt ?? ''));
    return lines.map(String).filter((line) => {
        if (!/\bERR\b|error=/iu.test(line)) return false;
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
