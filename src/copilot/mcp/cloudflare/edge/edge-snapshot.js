// @ts-check
/**
 * Consolidated read-only Cloudflare edge snapshot for MCP operations.
 *
 * @module copilot/mcp/cloudflare/edge-snapshot
 */

import { auditCloudflareRemoteTunnel } from '../remote/public/runtime.js';
import { auditCloudflareEdgeRulesets } from './edge-audit.js';
import { diffCloudflareEdgePolicy } from './edge-policy-diff.js';

/**
 * @param {{ authority?: import('../environment-authority.js').CloudflareEnvironmentAuthority; env?: NodeJS.ProcessEnv; now?: Date }} [options]
 * @returns {Promise<Record<string, unknown> & { ok: boolean }>}
 */
export async function buildCloudflareEdgeSnapshot(options = {}) {
    const authorityOptions = options.authority
        ? { authority: options.authority }
        : options.env
          ? { env: options.env }
          : {};
    const [remoteAudit, edgeAudit, edgeDiff] = await Promise.all([
        auditCloudflareRemoteTunnel(authorityOptions),
        auditCloudflareEdgeRulesets(authorityOptions),
        diffCloudflareEdgePolicy(authorityOptions),
    ]);
    return buildCloudflareEdgeSnapshotReport(remoteAudit, edgeAudit, edgeDiff, options.now ?? new Date());
}

/**
 * @param {Record<string, unknown> & { ok?: boolean }} remoteAudit
 * @param {Record<string, unknown> & { ok?: boolean }} edgeAudit
 * @param {Record<string, unknown> & { ok?: boolean }} edgeDiff
 * @param {Date} now
 * @returns {Record<string, unknown> & { ok: boolean }}
 */
export function buildCloudflareEdgeSnapshotReport(remoteAudit, edgeAudit, edgeDiff, now) {
    const remoteCritical = normalizeStringArray(remoteAudit['critical']);
    const edgeCritical = normalizeStringArray(edgeAudit['critical']);
    const diffRecord = asRecord(edgeDiff['summary']);
    const criticalDiffs = numberValue(diffRecord['criticalDiffs']);
    const ok = remoteAudit.ok === true && edgeAudit.ok === true && edgeDiff.ok === true;
    return {
        ok,
        success: true,
        mode: 'read-only-snapshot',
        appliesChanges: false,
        capturedAt: now.toISOString(),
        readiness: {
            remoteTunnelOk: remoteAudit.ok === true,
            edgeAuditOk: edgeAudit.ok === true,
            edgeDiffOk: edgeDiff.ok === true,
            mutationReady: edgeDiff['mutationReady'] === true,
            criticalCount: remoteCritical.length + edgeCritical.length + criticalDiffs,
        },
        endpoint: edgeDiff['endpoint'] ?? edgeAudit['desired'] ?? remoteAudit['desired'] ?? null,
        remoteTunnel: {
            desired: remoteAudit['desired'] ?? null,
            remote: remoteAudit['remote'] ?? null,
            dns: remoteAudit['dns'] ?? null,
            critical: remoteCritical,
            warnings: normalizeStringArray(remoteAudit['warnings']),
        },
        edge: {
            zone: edgeAudit['zone'] ?? null,
            rulesets: edgeAudit['rulesets'] ?? [],
            findings: edgeAudit['findings'] ?? null,
            critical: edgeCritical,
            warnings: normalizeStringArray(edgeAudit['warnings']),
            permissionGaps: normalizeStringArray(edgeAudit['permissionGaps']),
        },
        policyDiff: {
            summary: edgeDiff['summary'] ?? null,
            diffs: edgeDiff['diffs'] ?? [],
            recommendedSequence: edgeDiff['recommendedSequence'] ?? [],
        },
        backupGuidance: [
            'Persist this JSON output before any Cloudflare dashboard/API change.',
            'After changing Cloudflare rulesets, capture a new snapshot and compare remoteTunnel, edge.rulesets and policyDiff.',
            'Do not use mutation automation until a rollback snapshot and restore path are implemented.',
        ],
        suggestedFileName: `cloudflare-edge-snapshot-${now.toISOString().replace(/[:.]/gu, '-')}.json`,
    };
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
 * @returns {string[]}
 */
function normalizeStringArray(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function numberValue(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
