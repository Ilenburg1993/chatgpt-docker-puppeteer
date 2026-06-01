// @ts-check
/**
 * DevContainer network/DNS posture audit for MCP tunnel performance work.
 *
 * @module copilot/mcp/tools/devcontainer-network-posture
 */

import { readFile } from 'node:fs/promises';
import { readOnlyAnnotations } from '../control-plane/annotations.js';
import { okResult } from '../control-plane/result.js';

const LOCAL_DNS_SUMMARY = '/tmp/devcontainer-local-dns-cache.summary';
const LOCAL_DNS_ACTION_SUMMARY = '/tmp/devcontainer-local-dns-cache.action.summary';
const LOCAL_DNS_STATUS = '/tmp/devcontainer-local-dns-cache.status';
const NETWORK_CONTROL_PLANE_SUMMARY = '/tmp/devcontainer-network-control-plane.summary';
const NETWORK_CONTROL_PLANE_EVENTS = '/tmp/devcontainer-network-control-plane.events.tsv';

const DNS_KEYS = [
    'status',
    'reason',
    'script_version',
    'runtime_effective',
    'resolver_effective',
    'system_resolver_uses_cache',
    'resolv_conf_points_to_cache',
    'resolv_conf_drift',
    'resolv_conf_drift_reason',
    'resolv_conf_first_nameserver',
    'local_probe_status',
    'local_probe_tool',
    'local_probe_proven',
    'docker_embedded_resolver_detected',
    'docker_embedded_upstream_status',
    'docker_embedded_split_status',
    'docker_embedded_split_domains',
    'warmup_status',
    'warmup_ok_count',
    'warmup_failed_count',
    'dnsmasq_process_status',
    'dnsmasq_port_status',
    'dnsmasq_target_port_conflict_status',
    'dnsmasq_socket_owner_visibility',
];

/** @type {import('../registry.js').McpToolDefinition} */
export const mcpDevcontainerNetworkPostureAuditTool = {
    name: 'mcp_devcontainer_network_posture_audit',
    title: 'DevContainer network posture audit',
    description:
        'Read-only audit of DevContainer DNS/network artifacts relevant to MCP Cloudflare Tunnel latency and reliability.',
    inputSchema: {},
    annotations: readOnlyAnnotations(),
    handler: async () => okResult(await auditDevcontainerNetworkPosture()),
};

/**
 * @returns {Promise<Record<string, unknown>>}
 */
export async function auditDevcontainerNetworkPosture() {
    const [dnsStatus, dnsSummary, dnsActionSummary, controlSummary, controlEvents] = await Promise.all([
        readSingleLine(LOCAL_DNS_STATUS),
        readKvFile(LOCAL_DNS_SUMMARY),
        readKvFile(LOCAL_DNS_ACTION_SUMMARY),
        readKvFile(NETWORK_CONTROL_PLANE_SUMMARY),
        readTailLines(NETWORK_CONTROL_PLANE_EVENTS, 20),
    ]);
    const dns = pickKeys(dnsSummary.values, DNS_KEYS);
    const findings = buildFindings(dns, controlSummary.values);
    return {
        ok: findings.critical.length === 0,
        success: true,
        mode: 'read-only-devcontainer-network-posture-audit',
        appliesChanges: false,
        artifacts: {
            localDnsStatus: dnsStatus,
            localDnsSummary: dnsSummary.meta,
            localDnsActionSummary: dnsActionSummary.meta,
            networkControlPlaneSummary: controlSummary.meta,
            networkControlPlaneEvents: {
                path: NETWORK_CONTROL_PLANE_EVENTS,
                readable: controlEvents.readable,
                tailLines: controlEvents.lines,
            },
        },
        dns,
        controlPlane: {
            status: controlSummary.values['status'] ?? null,
            dnsState: controlSummary.values['dns_state'] ?? null,
            tunnelState: controlSummary.values['tunnel_state'] ?? null,
            recommendedActions: controlSummary.values['recommended_actions'] ?? null,
        },
        findings,
        nextActions: buildNextActions(findings),
    };
}

/**
 * @param {Record<string, string>} dns
 * @param {Record<string, string>} control
 * @returns {{ critical: string[]; warnings: string[]; observations: string[] }}
 */
function buildFindings(dns, control) {
    const critical = [];
    const warnings = [];
    const observations = [];
    if (!dns['status']) warnings.push('local DNS runtime summary is missing; run the DevContainer network summary/doctor before DNS tuning.');
    if (dns['status'] === 'failed' || dns['status'] === 'lock-failed') critical.push(`local DNS cache status is ${dns['status']}.`);
    if (dns['resolv_conf_drift'] === 'true') warnings.push(`resolv.conf drift reported: ${dns['resolv_conf_drift_reason'] ?? 'unknown'}.`);
    if (dns['resolv_conf_points_to_cache'] === 'true' && dns['local_probe_proven'] !== 'true') {
        critical.push('resolv.conf points to local DNS cache but local_probe_proven is not true.');
    }
    if (dns['dnsmasq_target_port_conflict_status'] && dns['dnsmasq_target_port_conflict_status'] !== 'none') {
        warnings.push(`DNS target port conflict status: ${dns['dnsmasq_target_port_conflict_status']}.`);
    }
    if (dns['docker_embedded_split_status'] === 'disabled' || dns['docker_embedded_split_status'] === 'unknown') {
        warnings.push(`Docker embedded DNS split status is ${dns['docker_embedded_split_status'] ?? 'unknown'}.`);
    }
    if (dns['warmup_failed_count'] && dns['warmup_failed_count'] !== '0') {
        warnings.push(`DNS warmup reported ${dns['warmup_failed_count']} failed host(s).`);
    }
    if (dns['runtime_effective'] === 'true') observations.push('local DNS runtime is effective.');
    if (dns['resolver_effective'] === 'true') observations.push('system resolver is using the local DNS cache.');
    if (control['status']) observations.push(`network control plane status is ${control['status']}.`);
    return { critical, warnings, observations };
}

/**
 * @param {{ critical: string[]; warnings: string[] }} findings
 * @returns {string[]}
 */
function buildNextActions(findings) {
    if (findings.critical.length > 0) return ['Run npm run network:dns:doctor before Cloudflare transport/origin tuning.'];
    if (findings.warnings.length > 0) return ['Review DNS warnings, then collect latency baseline before changing tunnel protocol or origin parameters.'];
    return ['Collect Cloudflare tunnel latency p50/p95/p99 baseline, then run controlled http2 versus auto transport benchmark.'];
}

/**
 * @param {string} path
 * @returns {Promise<{ path: string; readable: boolean; line: string | null; error: string | null }>}
 */
async function readSingleLine(path) {
    try {
        const content = await readFile(path, 'utf8');
        return { path, readable: true, line: content.split(/\r?\n/u)[0] ?? '', error: null };
    } catch (error) {
        return { path, readable: false, line: null, error: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * @param {string} path
 * @returns {Promise<{ meta: { path: string; readable: boolean; error: string | null }; values: Record<string, string> }>}
 */
async function readKvFile(path) {
    try {
        const content = await readFile(path, 'utf8');
        const values = Object.fromEntries(
            content
                .split(/\r?\n/u)
                .map((line) => line.trim())
                .filter((line) => line && !line.startsWith('#') && line.includes('='))
                .map((line) => {
                    const index = line.indexOf('=');
                    return [line.slice(0, index), line.slice(index + 1)];
                }),
        );
        return { meta: { path, readable: true, error: null }, values };
    } catch (error) {
        return {
            meta: { path, readable: false, error: error instanceof Error ? error.message : String(error) },
            values: {},
        };
    }
}

/**
 * @param {string} path
 * @param {number} limit
 * @returns {Promise<{ readable: boolean; lines: string[]; error: string | null }>}
 */
async function readTailLines(path, limit) {
    try {
        const content = await readFile(path, 'utf8');
        return { readable: true, lines: content.trim().split(/\r?\n/u).slice(-limit), error: null };
    } catch (error) {
        return { readable: false, lines: [], error: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * @param {Record<string, string>} values
 * @param {string[]} keys
 * @returns {Record<string, string>}
 */
function pickKeys(values, keys) {
    return Object.fromEntries(keys.map((key) => [key, values[key] ?? 'unknown']));
}
