// @ts-check
/**
 * DevContainer network/DNS posture audit for MCP tunnel performance work.
 *
 * @module copilot/mcp/tools/devcontainer-network-posture
 */

import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { boundedWriteAnnotations, errorResult, okResult, readOnlyAnnotations } from '#copilot/mcp/control-plane';

const LOCAL_DNS_SUMMARY = '/tmp/devcontainer-local-dns-cache.summary';
const LOCAL_DNS_ACTION_SUMMARY = '/tmp/devcontainer-local-dns-cache.action.summary';
const LOCAL_DNS_STATUS = '/tmp/devcontainer-local-dns-cache.status';
const NETWORK_CONTROL_PLANE_SUMMARY = '/tmp/devcontainer-network-control-plane.summary';
const NETWORK_CONTROL_PLANE_EVENTS = '/tmp/devcontainer-network-control-plane.events.tsv';
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const CANONICAL_NETWORK_CONTROL_PLANE_SCRIPT = resolve(REPO_ROOT, '.devcontainer/scripts/network-control-plane-state.sh');
const execFileAsync = promisify(execFile);
const NETWORK_CONTROL_PLANE_REFRESH_TIMEOUT_MS = 10_000;
const NETWORK_CONTROL_PLANE_REFRESH_MAX_BUFFER = 64 * 1024;

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

/** @type {import('../registry.js').McpToolDefinition} */
export const mcpDevcontainerNetworkControlPlaneRefreshTool = {
    name: 'mcp_devcontainer_network_control_plane_refresh',
    title: 'Refresh DevContainer network state',
    description:
        'Run only the canonical passive network-control-plane-state.sh summary action with fixed arguments, timeout and output bounds, then return a fresh posture audit. It performs no external network probes and accepts no caller command or path.',
    inputSchema: {},
    annotations: boundedWriteAnnotations(),
    handler: async () => refreshDevcontainerNetworkControlPlaneState(),
};

/** @returns {Promise<ReturnType<typeof okResult> | ReturnType<typeof errorResult>>} */
export async function refreshDevcontainerNetworkControlPlaneState() {
    const script = await inspectFile(CANONICAL_NETWORK_CONTROL_PLANE_SCRIPT);
    if (!script.readable || !script.isFile) {
        return errorResult('Canonical DevContainer network control-plane script is unavailable.', {
            code: 'ERR_DEVCONTAINER_NETWORK_CONTROL_PLANE_SCRIPT_UNAVAILABLE',
            script: '.devcontainer/scripts/network-control-plane-state.sh',
        });
    }
    const startedAt = Date.now();
    try {
        const result = await execFileAsync('bash', [CANONICAL_NETWORK_CONTROL_PLANE_SCRIPT, '--quiet', 'summary'], {
            cwd: REPO_ROOT,
            env: process.env,
            encoding: 'utf8',
            timeout: NETWORK_CONTROL_PLANE_REFRESH_TIMEOUT_MS,
            maxBuffer: NETWORK_CONTROL_PLANE_REFRESH_MAX_BUFFER,
        });
        const audit = await auditDevcontainerNetworkPosture();
        return okResult(
            {
                success: true,
                mode: 'fixed-passive-network-control-plane-refresh',
                script: '.devcontainer/scripts/network-control-plane-state.sh',
                args: ['--quiet', 'summary'],
                durationMs: Date.now() - startedAt,
                stdoutBytes: Buffer.byteLength(result.stdout ?? '', 'utf8'),
                stderrBytes: Buffer.byteLength(result.stderr ?? '', 'utf8'),
                audit,
            },
            'Refreshed passive DevContainer network control-plane state and returned a fresh posture audit.',
        );
    } catch (error) {
        return errorResult('Passive DevContainer network control-plane refresh failed.', {
            code: 'ERR_DEVCONTAINER_NETWORK_CONTROL_PLANE_REFRESH_FAILED',
            script: '.devcontainer/scripts/network-control-plane-state.sh',
            durationMs: Date.now() - startedAt,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

/**
 * @returns {Promise<Record<string, unknown>>}
 */
export async function auditDevcontainerNetworkPosture() {
    const [dnsStatus, dnsSummary, dnsActionSummary, controlSummary, controlEvents, controlRuntime] = await Promise.all([
        readSingleLine(LOCAL_DNS_STATUS),
        readKvFile(LOCAL_DNS_SUMMARY),
        readKvFile(LOCAL_DNS_ACTION_SUMMARY),
        readKvFile(NETWORK_CONTROL_PLANE_SUMMARY),
        readTailLines(NETWORK_CONTROL_PLANE_EVENTS, 20),
        inspectNetworkControlPlaneRuntime(),
    ]);
    const dns = pickKeys(dnsSummary.values, DNS_KEYS);
    const findings = buildDevcontainerNetworkFindings(dns, controlSummary.values, controlRuntime);
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
            runtime: controlRuntime,
        },
        findings,
        nextActions: buildNextActions(findings),
    };
}

/**
 * @param {Record<string, string>} dns
 * @param {Record<string, string>} control
 * @param {Record<string, unknown>} [controlRuntime]
 * @returns {{ critical: string[]; warnings: string[]; observations: string[] }}
 */
export function buildDevcontainerNetworkFindings(dns, control, controlRuntime = {}) {
    const critical = [];
    const warnings = [];
    const observations = [];
    if (!dns['status']) warnings.push('local DNS runtime summary is missing; run the DevContainer network summary/doctor before DNS tuning.');
    if (dns['status'] === 'failed' || dns['status'] === 'lock-failed') critical.push(`local DNS cache status is ${dns['status']}.`);
    if (dns['resolv_conf_drift'] === 'true') warnings.push(`resolv.conf drift reported: ${dns['resolv_conf_drift_reason'] ?? 'unknown'}.`);
    if (dns['resolv_conf_points_to_cache'] === 'true' && dns['local_probe_proven'] !== 'true') {
        critical.push('resolv.conf points to local DNS cache but local_probe_proven is not true.');
    }

    const conflictStatus = dns['dnsmasq_target_port_conflict_status'];
    const processStatus = dns['dnsmasq_process_status'] ?? '';
    const portStatus = dns['dnsmasq_port_status'] ?? '';
    const managedOwnListener =
        conflictStatus === 'in-use' && processStatus.startsWith('running-managed') && portStatus.startsWith('bound-managed');
    if (managedOwnListener) {
        observations.push('DNS target port is occupied by the managed dnsmasq as expected; legacy in-use status is not a conflict.');
    } else if (conflictStatus === 'free' && dns['runtime_effective'] === 'true') {
        warnings.push('local DNS runtime claims to be effective while the configured target port is reported free.');
    } else if (conflictStatus && !['none', 'free'].includes(conflictStatus)) {
        warnings.push(`DNS target port conflict status: ${conflictStatus}.`);
    }

    const splitStatus = dns['docker_embedded_split_status'];
    const embeddedResolverDetected = dns['docker_embedded_resolver_detected'];
    if (splitStatus === 'disabled' && embeddedResolverDetected === 'false') {
        observations.push('Docker embedded DNS split is disabled because no embedded resolver was detected.');
    } else if (splitStatus === 'disabled' || splitStatus === 'unknown') {
        warnings.push(`Docker embedded DNS split status is ${splitStatus ?? 'unknown'}.`);
    }
    if (dns['warmup_failed_count'] && dns['warmup_failed_count'] !== '0') {
        warnings.push(`DNS warmup reported ${dns['warmup_failed_count']} failed host(s).`);
    }
    if (dns['runtime_effective'] === 'true') observations.push('local DNS runtime is effective.');
    if (dns['resolver_effective'] === 'true') observations.push('system resolver is using the local DNS cache.');

    const controlEnabled = controlRuntime['enabled'] !== false;
    if (controlEnabled && controlRuntime['canonicalScriptReadable'] === false) {
        warnings.push('canonical DevContainer network control-plane script is not readable.');
    }
    if (controlEnabled && controlRuntime['configuredScriptReadable'] === false) {
        if (controlRuntime['fallbackActive'] === true) {
            observations.push('configured DevContainer network control-plane path is stale/unreadable, but the canonical script is available and lifecycle hooks can self-heal to it.');
        } else {
            warnings.push('configured DevContainer network control-plane script is not readable and no canonical fallback is available.');
        }
    }
    if (controlEnabled && controlRuntime['expectedVersionMismatch'] === true) {
        observations.push(
            `current containerEnv expects network-control-plane ${String(controlRuntime['expectedVersion'] ?? 'unknown')} while canonical source is ${String(controlRuntime['canonicalVersion'] ?? 'unknown')}; an environment refresh will converge metadata.`,
        );
    }
    const controlStatus = control['status'];
    if (controlEnabled && (!controlStatus || controlStatus === 'skipped' || controlStatus === 'unknown')) {
        warnings.push(`network control plane is enabled but runtime status is ${controlStatus ?? 'missing'}.`);
    } else if (controlStatus === 'failed' || controlStatus === 'fatal') {
        critical.push(`network control plane status is ${controlStatus}.`);
    } else if (controlStatus === 'degraded') {
        warnings.push('network control plane status is degraded.');
    }
    if (controlStatus) observations.push(`network control plane status is ${controlStatus}.`);
    return { critical, warnings, observations };
}

/**
 * @param {{ critical: string[]; warnings: string[] }} findings
 * @returns {string[]}
 */
function buildNextActions(findings) {
    if (findings.critical.length > 0) return ['Run npm run network:dns:doctor before Cloudflare transport/origin tuning.'];
    if (findings.warnings.length > 0) return ['Resolve DevContainer network observability warnings before changing tunnel protocol or origin parameters.'];
    return ['Current authoritative DevContainer network posture is healthy/advisory-only. Do not retune DNS or Cloudflare transport solely for inter-tool latency; use mcp_latency_attribution and controlled pulse evidence first.'];
}

/** @returns {Promise<Record<string, unknown>>} */
async function inspectNetworkControlPlaneRuntime() {
    const enabled = !['0', 'false', 'off', 'disabled'].includes(
        String(process.env['DEVCONTAINER_ENABLE_NETWORK_CONTROL_PLANE_STATE'] ?? 'true').trim().toLowerCase(),
    );
    const configuredRaw = String(process.env['DEVCONTAINER_NETWORK_CONTROL_PLANE_SCRIPT'] ?? '').trim();
    const expanded = configuredRaw.replaceAll('${containerWorkspaceFolder}', REPO_ROOT.replace(/\/$/u, ''));
    const configuredScript = expanded
        ? isAbsolute(expanded)
            ? expanded
            : resolve(REPO_ROOT, expanded)
        : CANONICAL_NETWORK_CONTROL_PLANE_SCRIPT;
    const [configured, canonical, configuredVersion, canonicalVersion] = await Promise.all([
        inspectFile(configuredScript),
        inspectFile(CANONICAL_NETWORK_CONTROL_PLANE_SCRIPT),
        readScriptDeclaredVersion(configuredScript),
        readScriptDeclaredVersion(CANONICAL_NETWORK_CONTROL_PLANE_SCRIPT),
    ]);
    const configuredMatchesCanonical = configuredScript === CANONICAL_NETWORK_CONTROL_PLANE_SCRIPT;
    const fallbackActive = !configuredMatchesCanonical && !configured.readable && canonical.readable && canonical.isFile;
    const effectiveScript = configured.readable && configured.isFile ? configuredScript : fallbackActive ? CANONICAL_NETWORK_CONTROL_PLANE_SCRIPT : configuredScript;
    const expectedVersion = process.env['DEVCONTAINER_NETWORK_CONTROL_PLANE_SCRIPT_VERSION_EXPECTED'] ?? null;
    const expectedVersionMismatch =
        typeof expectedVersion === 'string' &&
        typeof canonicalVersion === 'string' &&
        normalizeVersion(expectedVersion) !== normalizeVersion(canonicalVersion);
    return {
        enabled,
        configuredScript,
        configuredScriptReadable: configured.readable,
        configuredScriptIsFile: configured.isFile,
        configuredVersion,
        canonicalScript: CANONICAL_NETWORK_CONTROL_PLANE_SCRIPT,
        canonicalScriptReadable: canonical.readable,
        canonicalScriptIsFile: canonical.isFile,
        canonicalVersion,
        configuredMatchesCanonical,
        fallbackAvailable: canonical.readable && canonical.isFile,
        fallbackActive,
        effectiveScript,
        expectedVersion,
        expectedVersionMismatch,
    };
}

/** @param {string | null} value */
function normalizeVersion(value) {
    return String(value ?? '').trim().replace(/^v/u, '');
}

/** @param {string} path */
async function readScriptDeclaredVersion(path) {
    try {
        const content = await readFile(path, 'utf8');
        const assignment = content.match(/\bSCRIPT_VERSION=["']([^"']+)["']/u)?.[1];
        if (assignment) return normalizeVersion(assignment);
        const header = content.slice(0, 8192).match(/^#\s*Version:\s*v?([^\s]+)\s*$/mu)?.[1];
        return header ? normalizeVersion(header) : null;
    } catch {
        return null;
    }
}

/** @param {string} path */
async function inspectFile(path) {
    try {
        const info = await stat(path);
        return { readable: true, isFile: info.isFile(), error: null };
    } catch (error) {
        return { readable: false, isFile: false, error: error instanceof Error ? error.message : String(error) };
    }
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
