// @ts-check
/** Cloudflare post-change gate orchestration and policy evaluation. */

import { isCloudflaredActionableOriginErrorLine } from '../error-taxonomy.js';
import { readCloudflaredMetricsSnapshot } from '../observability/public/index.js';
import { auditCloudflareRemoteTunnel } from '../remote/public/index.js';
import { readCloudflareTunnelStatus } from '../tunnel/public/index.js';

const MIN_HA_CONNECTIONS = 4;
const MAX_ERROR_RATE = 0;
const MAX_RPC_P95_MS = 2_500;
const MAX_QUIC_RTT_MS = 5_000;

/**
 * @param {{ includeDetails?: boolean }} options
 * @param {{ config: import('../config.js').CloudflareTunnelConfig; authority: import('../environment-authority.js').CloudflareEnvironmentAuthority }} runtime
 * @returns {Promise<Record<string, unknown>>}
 */
export async function runCloudflarePostChangeGates(options, runtime) {
    const [tunnelStatus, remoteAudit, metrics] = await Promise.all([
        safeTunnelStatus(runtime.config),
        safeRemoteAudit(runtime.authority),
        safeMetricsSnapshot(runtime.config),
    ]);
    const gateResults = evaluateCloudflarePostChangeGates({ tunnelStatus, remoteAudit, metrics });
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
    return options.includeDetails === true ? { ...base, tunnelStatus, remoteAudit, metrics } : base;
}

/** @param {import('../config.js').CloudflareTunnelConfig} config */
async function safeTunnelStatus(config) {
    try {
        return await readCloudflareTunnelStatus(config);
    } catch (error) {
        return { success: false, error: sanitizeError(error) };
    }
}

/** @param {import('../environment-authority.js').CloudflareEnvironmentAuthority} authority */
async function safeRemoteAudit(authority) {
    try {
        return await auditCloudflareRemoteTunnel({ authority });
    } catch (error) {
        return {
            ok: false,
            success: false,
            error: sanitizeError(error),
            critical: ['Cloudflare remote audit threw before returning a structured result.'],
        };
    }
}

/** @param {import('../config.js').CloudflareTunnelConfig} config */
async function safeMetricsSnapshot(config) {
    try {
        return await readCloudflaredMetricsSnapshot({ timeoutMs: 3000 }, config);
    } catch (error) {
        return { ok: false, error: sanitizeError(error) };
    }
}

/**
 * @returns {Promise<Record<string, unknown>>}
 */
/**
 * @param {{
 *     tunnelStatus: Record<string, unknown>;
 *     remoteAudit: Record<string, unknown>;
 *     metrics: Record<string, unknown>;
 * }} input
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

/**
 * @param {{
 *     tunnelStatus: Record<string, unknown>;
 *     remoteAudit: Record<string, unknown>;
 *     metrics: Record<string, unknown>;
 * }} input
 * @returns {{ critical: string[]; warnings: string[]; passed: string[] }}
 */
export function evaluateCloudflarePostChangeGates(input) {
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
        Array.isArray(originDiagnostics['recentTunnelTransportErrors'])
            ? originDiagnostics['recentTunnelTransportErrors']
            : [],
        lastSmokeCheckedAt,
    );
    const recentMetricsBindErrors = filterRecentLogLines(
        Array.isArray(originDiagnostics['recentMetricsBindErrors']) ? originDiagnostics['recentMetricsBindErrors'] : [],
        lastSmokeCheckedAt,
    );
    const tunnelSmokeFresh = permanentTunnel['lastSmokeFresh'] === true;
    const noRecentActionableOriginErrors = recentOriginErrors.length === 0;
    if (tunnelSmokeFresh) passed.push('permanent tunnel smoke is fresh.');
    else critical.push('permanent tunnel smoke is not fresh.');
    if (noRecentActionableOriginErrors) passed.push('no actionable origin errors after the latest smoke.');
    else critical.push(`actionable origin errors after latest smoke: ${recentOriginErrors.length}.`);
    if (recentTunnelTransportErrors.length > 0)
        warnings.push(
            `recent tunnel transport errors after latest smoke: ${recentTunnelTransportErrors.length}; recovered state is judged by HA connections, smoke and metrics.`,
        );
    if (recentMetricsBindErrors.length > 0)
        warnings.push(
            `recent cloudflared metrics bind errors after latest smoke: ${recentMetricsBindErrors.length}; ensure restart serialization remains enabled.`,
        );

    const remoteAuditOk = input.remoteAudit['ok'] === true;
    if (remoteAuditOk) passed.push('Cloudflare remote audit ok=true.');
    else critical.push('Cloudflare remote audit did not return ok=true.');
    const remote = asRecord(input.remoteAudit['remote']);
    const connections = asRecord(remote['connections']);
    const activeConnections = toNumber(connections['active']);
    const remoteHaHealthy = activeConnections !== null && activeConnections >= MIN_HA_CONNECTIONS;
    if (remoteHaHealthy) {
        passed.push(`remote active HA connections >= ${MIN_HA_CONNECTIONS}.`);
    } else {
        critical.push(`remote active HA connections below ${MIN_HA_CONNECTIONS}.`);
    }

    const metricsOk = input.metrics['ok'] === true;
    if (metricsOk) passed.push('cloudflared metrics snapshot ok=true.');
    else critical.push('cloudflared metrics snapshot did not return ok=true.');
    const operational = asRecord(input.metrics['operational']);
    const requestErrorRate = toNumber(operational['requestErrorRate']);
    const metricHaConnections = toNumber(operational['haConnections']);
    const metricHaHealthy = metricHaConnections !== null && metricHaConnections >= MIN_HA_CONNECTIONS;
    const recoveredDespiteHistoricalRequestErrors =
        requestErrorRate !== null &&
        requestErrorRate > MAX_ERROR_RATE &&
        tunnelSmokeFresh &&
        noRecentActionableOriginErrors &&
        remoteAuditOk &&
        remoteHaHealthy &&
        metricsOk &&
        metricHaHealthy;
    if (requestErrorRate !== null && requestErrorRate <= MAX_ERROR_RATE) {
        passed.push('requestErrorRate is 0.');
    } else if (recoveredDespiteHistoricalRequestErrors) {
        warnings.push(
            `aggregate requestErrorRate is ${requestErrorRate}; treating as historical because latest smoke, HA connections and origin diagnostics are healthy.`,
        );
    } else {
        critical.push('requestErrorRate is above 0 or unavailable.');
    }
    if (metricHaHealthy) {
        passed.push(`metrics haConnections >= ${MIN_HA_CONNECTIONS}.`);
    } else {
        critical.push(`metrics haConnections below ${MIN_HA_CONNECTIONS}.`);
    }

    const transportProtocol = String(
        permanentTunnel['transportProtocol'] ?? input.tunnelStatus['transportProtocol'] ?? '',
    );
    const quic = asRecord(input.metrics['quic']);
    if (transportProtocol === 'quic') {
        if (quic['present'] === true) passed.push('QUIC metrics are present for strict QUIC transport.');
        else critical.push('strict QUIC transport is configured, but quic_client_* metrics are missing.');
        const latestRttMs = toNumber(quic['latestRttMs']);
        const smoothedRttMs = toNumber(quic['smoothedRttMs']);
        const effectiveRttMs = smoothedRttMs ?? latestRttMs;
        if (effectiveRttMs === null)
            warnings.push('QUIC RTT metrics unavailable; collect more samples before final promotion.');
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
 * @param {unknown[]} lines
 * @param {unknown} checkedAt
 * @returns {string[]}
 */
function filterActionableOriginErrors(lines, checkedAt) {
    return filterRecentLogLines(lines, checkedAt).filter(isCloudflaredActionableOriginErrorLine);
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
