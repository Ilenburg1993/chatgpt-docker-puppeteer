// @ts-check
/**
 * Non-mutating selection decision trace helpers.
 */

import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
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
 * @param {Record<string, unknown>} record
 * @param {string} field
 * @returns {boolean | null}
 */
function optionalRouteBoolean(record, field) {
    const value = record[field];
    return typeof value === 'boolean' ? value : null;
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
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function normalizePositiveInteger(value, fallback) {
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * @param {unknown} route
 * @returns {Record<string, unknown> | null}
 */
function summarizeSelectedRoute(route) {
    const record = optionalRecord(route);
    if (!record) return null;
    const runtimeHealth = optionalRecord(record['runtimeHealth']);
    const accountAccess = optionalRecord(record['accountAccess']);
    return {
        providerId: optionalString(record['providerId']),
        providerModel: optionalString(record['providerModel']),
        selectorSyntax: optionalString(record['selectorSyntax']) ?? optionalString(record['providerModel']),
        routeCandidateId: optionalString(record['routeCandidateId']),
        canonicalModelId: optionalString(record['canonicalModelId']),
        routeProfile: optionalString(record['routeProfile']),
        routeOptionRef: optionalString(record['routeOptionRef']),
        routeOptionRefs: Array.isArray(record['routeOptionRefs']) ? record['routeOptionRefs'].map(optionalString).filter((item) => item !== null).slice(0, 8) : [],
        selectorKind: optionalString(record['selectorKind']),
        routeLayer: optionalString(record['routeLayer']),
        wireApi: optionalString(record['wireApi']),
        runtimeKind: optionalString(record['runtimeKind']),
        upstreamProvider: optionalString(record['upstreamProvider']),
        baseUrl: optionalString(record['baseUrl']),
        openAICompatibleBaseUrl: optionalString(record['openAICompatibleBaseUrl']),
        endpoint: optionalString(record['endpoint']),
        aiSdkPackage: optionalString(record['aiSdkPackage']),
        autoSelection: optionalRouteBoolean(record, 'autoSelection'),
        supportsFallback: optionalRouteBoolean(record, 'supportsFallback'),
        localPrivate: optionalRouteBoolean(record, 'localPrivate'),
        score: optionalNumber(record['score']),
        eligibilityDisposition: optionalString(record['eligibilityDisposition']),
        accountScope: optionalString(record['accountScope']) ?? 'default',
        policyProfile: optionalString(record['policyProfile']),
        taskProfile: optionalString(record['taskProfile']),
        accountAccess: accountAccess
            ? {
                  status: optionalString(accountAccess['status']),
                  canAttempt: accountAccess['canAttempt'] === true,
                  secretConfigured: typeof accountAccess['secretConfigured'] === 'boolean' ? accountAccess['secretConfigured'] : null,
                  modelVisible: accountAccess['modelVisible'] === true,
                  failureClass: optionalString(accountAccess['failureClass']),
                  accessConfidence: optionalString(accountAccess['accessConfidence']),
                  resetWindows: Array.isArray(accountAccess['resetWindows']) ? accountAccess['resetWindows'].filter(optionalRecord).slice(0, 4) : [],
                  hardReasons: Array.isArray(accountAccess['hardReasons'])
                      ? accountAccess['hardReasons'].map(optionalString).filter((item) => item !== null).slice(0, 8)
                      : [],
                  softReasons: Array.isArray(accountAccess['softReasons'])
                      ? accountAccess['softReasons'].map(optionalString).filter((item) => item !== null).slice(0, 8)
                      : [],
              }
            : null,
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
 * @param {Record<string, unknown> | null} selected
 * @returns {string | null}
 */
function selectedRouteKey(selected) {
    if (!selected) return null;
    return [
        optionalString(selected['providerId']) ?? 'provider:none',
        optionalString(selected['providerModel']) ?? 'model:none',
        optionalString(selected['selectorKind']) ?? 'selector:none',
    ].join(':');
}

/**
 * @param {unknown} row
 * @returns {Record<string, unknown>}
 */
function normalizeTraceRow(row) {
    const record = optionalRecord(row) ?? {};
    const selected = optionalRecord(record['selected']);
    return {
        profileId: optionalString(record['profileId']) ?? 'unknown',
        source: optionalString(record['source']) ?? 'unknown',
        changedFromPreRuntime: record['changedFromPreRuntime'] === true,
        hasRuntimeProof: record['hasRuntimeProof'] === true,
        selected,
        selectedRouteKey: selectedRouteKey(selected),
        preSelected: optionalRecord(record['preSelected']),
        postSelected: optionalRecord(record['postSelected']),
    };
}

/**
 * @param {unknown} trace
 * @returns {Map<string, Record<string, unknown>>}
 */
function traceRowsByProfile(trace) {
    const record = optionalRecord(trace) ?? {};
    const rows = Array.isArray(record['rows']) ? record['rows'] : [];
    return new Map(rows.map((row) => {
        const normalized = normalizeTraceRow(row);
        return [String(normalized['profileId']), normalized];
    }));
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

/**
 * @param {string} filePath
 * @returns {Promise<Record<string, unknown>>}
 */
export async function readModelGatewaySelectionDecisionTrace(filePath) {
    const payload = JSON.parse(await readFile(resolve(filePath), 'utf8'));
    return optionalRecord(payload) ?? {};
}

/**
 * @param {Record<string, unknown>} leftTrace
 * @param {Record<string, unknown>} rightTrace
 * @returns {{
 *   schema: 'model-gateway-selection-trace-diff';
 *   ok: boolean;
 *   left: { traceId: string | null; generatedAt: string | null; policyMode: string | null };
 *   right: { traceId: string | null; generatedAt: string | null; policyMode: string | null };
 *   summary: {
 *     profileCount: number;
 *     addedProfileCount: number;
 *     removedProfileCount: number;
 *     changedProfileCount: number;
 *     unchangedProfileCount: number;
 *     selectedRouteChangedCount: number;
 *     sourceChangedCount: number;
 *     runtimeProofChangedCount: number;
 *   };
 *   rows: Array<{
 *     profileId: string;
 *     status: 'added' | 'removed' | 'changed' | 'unchanged';
 *     selectedRouteChanged: boolean;
 *     sourceChanged: boolean;
 *     runtimeProofChanged: boolean;
 *     left: Record<string, unknown> | null;
 *     right: Record<string, unknown> | null;
 *   }>;
 * }}
 */
export function compareModelGatewaySelectionDecisionTraces(leftTrace, rightTrace) {
    const leftRows = traceRowsByProfile(leftTrace);
    const rightRows = traceRowsByProfile(rightTrace);
    const profileIds = [...new Set([...leftRows.keys(), ...rightRows.keys()])].sort();
    const rows = profileIds.map((profileId) => {
        const left = leftRows.get(profileId) ?? null;
        const right = rightRows.get(profileId) ?? null;
        const selectedRouteChanged = left?.['selectedRouteKey'] !== right?.['selectedRouteKey'];
        const sourceChanged = left?.['source'] !== right?.['source'];
        const runtimeProofChanged = left?.['hasRuntimeProof'] !== right?.['hasRuntimeProof'];
        /** @type {'added' | 'removed' | 'changed' | 'unchanged'} */
        let status = 'unchanged';
        if (!left && right) status = 'added';
        else if (left && !right) status = 'removed';
        else if (selectedRouteChanged || sourceChanged || runtimeProofChanged) status = 'changed';
        return {
            profileId,
            status,
            selectedRouteChanged,
            sourceChanged,
            runtimeProofChanged,
            left,
            right,
        };
    });
    const leftPolicy = optionalRecord(leftTrace['policy']);
    const rightPolicy = optionalRecord(rightTrace['policy']);
    return {
        schema: 'model-gateway-selection-trace-diff',
        ok: true,
        left: {
            traceId: optionalString(leftTrace['traceId']),
            generatedAt: optionalString(leftTrace['generatedAt']),
            policyMode: optionalString(leftPolicy?.['mode']),
        },
        right: {
            traceId: optionalString(rightTrace['traceId']),
            generatedAt: optionalString(rightTrace['generatedAt']),
            policyMode: optionalString(rightPolicy?.['mode']),
        },
        summary: {
            profileCount: rows.length,
            addedProfileCount: rows.filter((row) => row.status === 'added').length,
            removedProfileCount: rows.filter((row) => row.status === 'removed').length,
            changedProfileCount: rows.filter((row) => row.status === 'changed').length,
            unchangedProfileCount: rows.filter((row) => row.status === 'unchanged').length,
            selectedRouteChangedCount: rows.filter((row) => row.selectedRouteChanged).length,
            sourceChangedCount: rows.filter((row) => row.sourceChanged).length,
            runtimeProofChangedCount: rows.filter((row) => row.runtimeProofChanged).length,
        },
        rows,
    };
}

/**
 * @param {{ directory?: string; limit?: number }} [options]
 * @returns {Promise<Array<{ name: string; filePath: string; mtimeMs: number; size: number }>>}
 */
export async function listModelGatewaySelectionDecisionTraceFiles(options = {}) {
    const directory = resolve(optionalString(options.directory) ?? DEFAULT_MODEL_GATEWAY_SELECTION_TRACE_DIR);
    const limit = normalizePositiveInteger(options.limit, 50);
    const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return [];
        throw error;
    });
    const files = await Promise.all(
        entries
            .filter((entry) => entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'latest.json')
            .map(async (entry) => {
                const filePath = resolve(directory, entry.name);
                const stats = await stat(filePath);
                return {
                    name: entry.name,
                    filePath,
                    mtimeMs: stats.mtimeMs,
                    size: stats.size,
                };
            }),
    );
    return files.sort((left, right) => right.mtimeMs - left.mtimeMs || right.name.localeCompare(left.name)).slice(0, limit);
}

/**
 * @param {{ directory?: string; maxFiles?: number; dryRun?: boolean }} [options]
 * @returns {Promise<{
 *   schema: 'model-gateway-selection-trace-retention';
 *   ok: boolean;
 *   directory: string;
 *   dryRun: boolean;
 *   maxFiles: number;
 *   candidateCount: number;
 *   retainedCount: number;
 *   prunedCount: number;
 *   deletedCount: number;
 *   retained: Array<{ name: string; filePath: string; mtimeMs: number; size: number }>;
 *   pruned: Array<{ name: string; filePath: string; mtimeMs: number; size: number }>;
 *   error: string | null;
 * }>}
 */
export async function applyModelGatewaySelectionTraceRetention(options = {}) {
    const directory = resolve(optionalString(options.directory) ?? DEFAULT_MODEL_GATEWAY_SELECTION_TRACE_DIR);
    const maxFiles = normalizePositiveInteger(options.maxFiles, 100);
    const dryRun = options.dryRun !== false;
    try {
        const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
            if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return [];
            throw error;
        });
        const candidates = entries.filter(
            (entry) => entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'latest.json',
        );
        const files = await Promise.all(
            candidates.map(async (entry) => {
                const filePath = resolve(directory, entry.name);
                const stats = await stat(filePath);
                return {
                    name: entry.name,
                    filePath,
                    mtimeMs: stats.mtimeMs,
                    size: stats.size,
                };
            }),
        );
        files.sort((left, right) => right.mtimeMs - left.mtimeMs || right.name.localeCompare(left.name));
        const retained = files.slice(0, maxFiles);
        const pruned = files.slice(maxFiles);
        let deletedCount = 0;
        if (!dryRun) {
            for (const file of pruned) {
                await rm(file.filePath, { force: true });
                deletedCount += 1;
            }
        }
        return {
            schema: 'model-gateway-selection-trace-retention',
            ok: true,
            directory,
            dryRun,
            maxFiles,
            candidateCount: files.length,
            retainedCount: retained.length,
            prunedCount: pruned.length,
            deletedCount,
            retained,
            pruned,
            error: null,
        };
    } catch (error) {
        return {
            schema: 'model-gateway-selection-trace-retention',
            ok: false,
            directory,
            dryRun,
            maxFiles,
            candidateCount: 0,
            retainedCount: 0,
            prunedCount: 0,
            deletedCount: 0,
            retained: [],
            pruned: [],
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
