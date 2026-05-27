// @ts-check
/**
 * Non-mutating selection decision trace helpers.
 */

import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export const DEFAULT_MODEL_GATEWAY_SELECTION_TRACE_DIR = 'data/copilot/model-gateway/selection-traces';

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function optionalString(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function optionalRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? /** @type {Record<string, unknown>} */ (value) : null;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function optionalNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeTraceId(value) {
    const raw = optionalString(value) ?? `selection-${new Date().toISOString()}`;
    return raw.replace(/[^A-Za-z0-9_.-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 120) || 'selection-trace';
}

/**
 * @param {unknown} route
 * @returns {Record<string, unknown> | null}
 */
function summarizeSelectedRoute(route) {
    const record = optionalRecord(route);
    if (!record) return null;
    const runtimeHealth = optionalRecord(record['runtimeHealth']);
    return {
        providerId: optionalString(record['providerId']),
        providerModel: optionalString(record['providerModel']),
        routeProfile: optionalString(record['routeProfile']),
        selectorKind: optionalString(record['selectorKind']),
        score: optionalNumber(record['score']),
        eligibilityDisposition: optionalString(record['eligibilityDisposition']),
        hasRuntimeProof: record['hasRuntimeProof'] === true,
        runtimeHealth: runtimeHealth
            ? {
                  lastStatus: optionalString(runtimeHealth['lastStatus']),
                  agentProbeStatus: optionalString(runtimeHealth['agentProbeStatus']),
                  verifiedProbes: Array.isArray(runtimeHealth['verifiedProbes'])
                      ? runtimeHealth['verifiedProbes'].filter((item) => typeof item === 'string').sort()
                      : [],
              }
            : null,
    };
}

/**
 * @param {unknown} audit
 * @returns {Record<string, unknown>}
 */
function summarizeSelectionAudit(audit) {
    const record = optionalRecord(audit) ?? {};
    const summary = optionalRecord(record['summary']) ?? {};
    return {
        schema: optionalString(record['schema']),
        ok: record['ok'] === true,
        mode: optionalString(record['mode']),
        runtimeMode: optionalString(record['runtimeMode']),
        summary,
    };
}

/**
 * @param {{
 *   snapshot?: Record<string, unknown>;
 *   integrity?: Record<string, unknown>;
 *   selection: Record<string, unknown>;
 *   postRuntimeSelection: Record<string, unknown>;
 *   selectionComparison: Record<string, unknown>;
 *   policyResolution: Record<string, unknown>;
 *   runtimeSource?: string;
 *   runtimeHealthRecordCount?: number;
 *   runtimeAccountOverlaySummary?: Record<string, unknown>;
 *   traceId?: string;
 *   generatedAt?: string | Date;
 *   source?: string;
 * }} input
 * @returns {Record<string, unknown>}
 */
export function buildModelGatewaySelectionDecisionTrace(input) {
    const generatedAt =
        input.generatedAt instanceof Date
            ? input.generatedAt.toISOString()
            : optionalString(input.generatedAt) ?? new Date().toISOString();
    const comparisonSummary = optionalRecord(input.selectionComparison['summary']) ?? {};
    const policySummary = optionalRecord(input.policyResolution['summary']) ?? {};
    const rows = Array.isArray(input.policyResolution['rows']) ? input.policyResolution['rows'] : [];
    return {
        schema: 'model-gateway-selection-decision-trace',
        traceId: normalizeTraceId(input.traceId ?? generatedAt),
        generatedAt,
        source: optionalString(input.source) ?? 'model-gateway-effective-selection',
        snapshot: {
            snapshotId: optionalString(input.snapshot?.['snapshotId']),
            generatedAt: optionalString(input.snapshot?.['generatedAt']),
            source: optionalString(input.snapshot?.['source']),
            modelCount: Array.isArray(input.snapshot?.['models']) ? input.snapshot['models'].length : 0,
            providerCount: Array.isArray(input.snapshot?.['providers']) ? input.snapshot['providers'].length : 0,
        },
        integrity: {
            ok: input.integrity?.['ok'] === true,
            redactedIdentityCount: optionalNumber(input.integrity?.['redactedIdentityCount']) ?? 0,
        },
        runtime: {
            source: optionalString(input.runtimeSource) ?? 'merged',
            healthRecordCount: optionalNumber(input.runtimeHealthRecordCount) ?? 0,
            accountOverlaySummary: optionalRecord(input.runtimeAccountOverlaySummary) ?? {},
        },
        preRuntimeSelection: summarizeSelectionAudit(input.selection),
        postRuntimeSelection: summarizeSelectionAudit(input.postRuntimeSelection),
        comparison: {
            schema: optionalString(input.selectionComparison['schema']),
            ok: input.selectionComparison['ok'] === true,
            summary: comparisonSummary,
        },
        policy: {
            schema: optionalString(input.policyResolution['schema']),
            ok: input.policyResolution['ok'] === true,
            mode: optionalString(input.policyResolution['mode']) ?? 'metadata_first',
            summary: policySummary,
        },
        rows: rows.map((row) => {
            const record = optionalRecord(row) ?? {};
            return {
                profileId: optionalString(record['profileId']),
                source: optionalString(record['source']),
                changedFromPreRuntime: record['changedFromPreRuntime'] === true,
                hasRuntimeProof: record['hasRuntimeProof'] === true,
                selected: summarizeSelectedRoute(record['selected']),
                preSelected: summarizeSelectedRoute(record['preSelected']),
                postSelected: summarizeSelectedRoute(record['postSelected']),
            };
        }),
    };
}

/**
 * @param {Record<string, unknown>} trace
 * @param {{ directory?: string; fileName?: string; writeLatest?: boolean }} [options]
 * @returns {Promise<{
 *   schema: 'model-gateway-selection-decision-trace-persistence';
 *   ok: boolean;
 *   written: boolean;
 *   traceId: string;
 *   filePath: string | null;
 *   latestPath: string | null;
 *   error: string | null;
 * }>}
 */
export async function persistModelGatewaySelectionDecisionTrace(trace, options = {}) {
    const traceId = normalizeTraceId(trace['traceId']);
    const directory = resolve(optionalString(options.directory) ?? DEFAULT_MODEL_GATEWAY_SELECTION_TRACE_DIR);
    const fileName = `${normalizeTraceId(options.fileName ?? traceId)}.json`;
    const filePath = resolve(directory, fileName);
    const latestPath = options.writeLatest === false ? null : resolve(directory, 'latest.json');
    try {
        await mkdir(dirname(filePath), { recursive: true });
        const payload = `${JSON.stringify(trace, null, 2)}\n`;
        const temp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
        await writeFile(temp, payload, { encoding: 'utf8', mode: 0o600 });
        await rename(temp, filePath);
        if (latestPath) {
            const latestTemp = `${latestPath}.tmp-${process.pid}-${Date.now()}`;
            await writeFile(latestTemp, payload, { encoding: 'utf8', mode: 0o600 });
            await rename(latestTemp, latestPath);
        }
        return {
            schema: 'model-gateway-selection-decision-trace-persistence',
            ok: true,
            written: true,
            traceId,
            filePath,
            latestPath,
            error: null,
        };
    } catch (error) {
        return {
            schema: 'model-gateway-selection-decision-trace-persistence',
            ok: false,
            written: false,
            traceId,
            filePath: null,
            latestPath: null,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
