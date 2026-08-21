// @ts-check
/**
 * Non-mutating selection decision trace helpers.
 */

import { createConfiguredFsGrant, createConfiguredFsIo } from '#copilot/infra/public/composition/filesystem/configured';
import { basename, resolve } from 'node:path';

export const DEFAULT_MODEL_GATEWAY_SELECTION_TRACE_DIR = 'data/copilot/model-gateway/selection-traces';
const DEFAULT_MODEL_GATEWAY_SELECTION_TRACE_DIRECTORY = resolve(DEFAULT_MODEL_GATEWAY_SELECTION_TRACE_DIR);

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
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : null;
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
    return (
        raw
            .replace(/[^A-Za-z0-9_.-]+/gu, '-')
            .replace(/^-+|-+$/gu, '')
            .slice(0, 120) || 'selection-trace'
    );
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
        routeOptionRefs: Array.isArray(record['routeOptionRefs'])
            ? record['routeOptionRefs']
                  .map(optionalString)
                  .filter((item) => item !== null)
                  .slice(0, 8)
            : [],
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
                  secretConfigured:
                      typeof accountAccess['secretConfigured'] === 'boolean' ? accountAccess['secretConfigured'] : null,
                  modelVisible: accountAccess['modelVisible'] === true,
                  failureClass: optionalString(accountAccess['failureClass']),
                  accessConfidence: optionalString(accountAccess['accessConfidence']),
                  resetWindows: Array.isArray(accountAccess['resetWindows'])
                      ? accountAccess['resetWindows'].filter(optionalRecord).slice(0, 4)
                      : [],
                  hardReasons: Array.isArray(accountAccess['hardReasons'])
                      ? accountAccess['hardReasons']
                            .map(optionalString)
                            .filter((item) => item !== null)
                            .slice(0, 8)
                      : [],
                  softReasons: Array.isArray(accountAccess['softReasons'])
                      ? accountAccess['softReasons']
                            .map(optionalString)
                            .filter((item) => item !== null)
                            .slice(0, 8)
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
 * @returns {Map<string, ReturnType<typeof normalizeTraceRow>>}
 */
function traceRowsByProfile(trace) {
    const record = optionalRecord(trace) ?? {};
    const rows = Array.isArray(record['rows']) ? record['rows'] : [];
    return new Map(
        rows.map((row) => {
            const normalized = normalizeTraceRow(row);
            return [String(normalized['profileId']), normalized];
        }),
    );
}

/**
 * @param {{
 *     snapshot?: Record<string, unknown>;
 *     integrity?: Record<string, unknown>;
 *     selection: ReturnType<typeof import('./selection-audit.js').auditModelGatewayPreRuntimeSelection>;
 *     postRuntimeSelection: ReturnType<typeof import('./selection-audit.js').auditModelGatewayPostRuntimeSelection>;
 *     selectionComparison: ReturnType<typeof import('./selection-audit.js').compareModelGatewaySelectionAudits>;
 *     policyResolution: ReturnType<typeof import('./selection-audit.js').resolveModelGatewaySelectionPolicy>;
 *     runtimeSource?: string;
 *     runtimeHealthRecordCount?: number;
 *     runtimeAccountOverlaySummary?: Record<string, unknown>;
 *     traceId?: string;
 *     generatedAt?: string | Date;
 *     source?: string;
 * }} input
 */
export function buildModelGatewaySelectionDecisionTrace(input) {
    const generatedAt =
        input.generatedAt instanceof Date
            ? input.generatedAt.toISOString()
            : (optionalString(input.generatedAt) ?? new Date().toISOString());
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

/** @param {unknown} value */
function normalizeTraceFileName(value) {
    const raw = optionalString(value);
    if (!raw) throw new TypeError('selection trace file name is required');
    if (basename(raw) !== raw) throw new TypeError('selection trace file name must not contain path components');
    const stem = raw.endsWith('.json') ? raw.slice(0, -'.json'.length) : raw;
    return `${normalizeTraceId(stem)}.json`;
}

/**
 * Build a trace store from a directory capability already granted by the composition root. The store owns its queue;
 * operational calls may choose trace ids/file basenames, but can never retarget the persistence directory.
 *
 * @param {{ directory: string; io: ReturnType<typeof createConfiguredFsIo> }} binding
 */
export function createModelGatewaySelectionTraceStore(binding) {
    const directory = resolve(binding.directory);
    const io = binding.io;
    /** @type {Promise<void>} */
    let persistQueue = Promise.resolve();

    return Object.freeze({
        directory,
        async persist(
            /** @type {Record<string, unknown>} */ trace,
            /** @type {{fileName?:string;writeLatest?:boolean}} */ options = {},
        ) {
            const traceId = normalizeTraceId(trace['traceId']);
            const fileName = normalizeTraceFileName(options.fileName ?? traceId);
            const filePath = resolve(directory, fileName);
            const latestPath = options.writeLatest === false ? null : resolve(directory, 'latest.json');
            const operation = persistQueue
                .catch(() => undefined)
                .then(async () => {
                    try {
                        const payload = `${JSON.stringify(trace, null, 2)}\n`;
                        await io.writeFileAtomic(filePath, payload, { mode: 0o600 });
                        if (latestPath) await io.writeFileAtomic(latestPath, payload, { mode: 0o600 });
                        return {
                            schema: /** @type {const} */ ('model-gateway-selection-decision-trace-persistence'),
                            ok: true,
                            written: true,
                            traceId,
                            filePath,
                            latestPath,
                            error: null,
                        };
                    } catch (error) {
                        return {
                            schema: /** @type {const} */ ('model-gateway-selection-decision-trace-persistence'),
                            ok: false,
                            written: false,
                            traceId,
                            filePath: null,
                            latestPath: null,
                            error: error instanceof Error ? error.message : String(error),
                        };
                    }
                });
            persistQueue = operation.then(
                () => undefined,
                () => undefined,
            );
            return operation;
        },
        async read(/** @type {string} */ fileName) {
            const target = resolve(directory, normalizeTraceFileName(fileName));
            const snapshot = await io.readTextFresh(target);
            const payload = JSON.parse(snapshot.content);
            return optionalRecord(payload) ?? {};
        },
        async list(/** @type {{limit?:number}} */ options = {}) {
            const limit = normalizePositiveInteger(options.limit, 50);
            return (await listSelectionTraceMetadata(directory, io)).slice(0, limit);
        },
        async applyRetention(/** @type {{maxFiles?:number;dryRun?:boolean}} */ options = {}) {
            const maxFiles = normalizePositiveInteger(options.maxFiles, 100);
            const dryRun = options.dryRun !== false;
            try {
                const files = await listSelectionTraceMetadata(directory, io);
                const retained = files.slice(0, maxFiles);
                const pruned = files.slice(maxFiles);
                let deletedCount = 0;
                if (!dryRun) {
                    for (const file of pruned) {
                        const removed = await io.deleteFile(file.filePath, { ignoreMissing: true });
                        if (removed) deletedCount += 1;
                    }
                }
                return {
                    schema: /** @type {const} */ ('model-gateway-selection-trace-retention'),
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
                    schema: /** @type {const} */ ('model-gateway-selection-trace-retention'),
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
        },
    });
}

const DEFAULT_MODEL_GATEWAY_SELECTION_TRACE_IO = createConfiguredFsIo(
    createConfiguredFsGrant({
        id: 'model-gateway.routing.selection-trace',
        roots: [DEFAULT_MODEL_GATEWAY_SELECTION_TRACE_DIRECTORY],
        operations: ['delete', 'list', 'read', 'stat', 'write'],
        symlinkPolicy: 'deny',
        durability: ['file-and-directory'],
    }),
);
const DEFAULT_MODEL_GATEWAY_SELECTION_TRACE_STORE = createModelGatewaySelectionTraceStore({
    directory: DEFAULT_MODEL_GATEWAY_SELECTION_TRACE_DIRECTORY,
    io: DEFAULT_MODEL_GATEWAY_SELECTION_TRACE_IO,
});

/** @param {Record<string, unknown>} trace @param {{fileName?:string;writeLatest?:boolean}} [options] */
export async function persistModelGatewaySelectionDecisionTrace(trace, options = {}) {
    return DEFAULT_MODEL_GATEWAY_SELECTION_TRACE_STORE.persist(trace, options);
}

/** @param {string} fileName */
export async function readModelGatewaySelectionDecisionTrace(fileName) {
    return DEFAULT_MODEL_GATEWAY_SELECTION_TRACE_STORE.read(fileName);
}

/** @param {unknown} error */
function isMissingTracePathError(error) {
    const code = error && typeof error === 'object' ? /** @type {{ code?: unknown }} */ (error).code : undefined;
    return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * Build a fresh, symlink-safe metadata projection for persisted trace files.
 *
 * `readdir(..., { withFileTypes: true }).isFile()` previously excluded symlinks. The canonical IO migration preserves
 * that property explicitly with lstat instead of accidentally following a symlink through stat.
 *
 * @param {string} directory
 * @param {ReturnType<typeof createConfiguredFsIo>} io
 * @returns {Promise<{ name: string; filePath: string; mtimeMs: number; size: number }[]>}
 */
async function listSelectionTraceMetadata(directory, io) {
    /** @type {string[]} */
    let names;
    try {
        const listing = await io.listDirectoryNamesFresh(directory);
        names = listing.entries;
    } catch (error) {
        if (isMissingTracePathError(error)) return [];
        throw error;
    }

    const candidates = names.filter((name) => name.endsWith('.json') && name !== 'latest.json');
    const rows = await Promise.all(
        candidates.map(async (name) => {
            const filePath = resolve(directory, name);
            try {
                const { stats } = await io.lstatPath(filePath);
                if (!stats.isFile() || stats.isSymbolicLink()) return null;
                return { name, filePath, mtimeMs: stats.mtimeMs, size: stats.size };
            } catch (error) {
                // A concurrent retention/write may remove one name after readdir. That race is a missing candidate,
                // not a failure of the entire projection.
                if (isMissingTracePathError(error)) return null;
                throw error;
            }
        }),
    );
    return rows
        .filter((row) => row !== null)
        .sort((left, right) => right.mtimeMs - left.mtimeMs || right.name.localeCompare(left.name));
}

/**
 * @param {Record<string, unknown>} leftTrace
 * @param {Record<string, unknown>} rightTrace
 * @returns {{
 *     schema: 'model-gateway-selection-trace-diff';
 *     ok: boolean;
 *     left: { traceId: string | null; generatedAt: string | null; policyMode: string | null };
 *     right: { traceId: string | null; generatedAt: string | null; policyMode: string | null };
 *     summary: {
 *         profileCount: number;
 *         addedProfileCount: number;
 *         removedProfileCount: number;
 *         changedProfileCount: number;
 *         unchangedProfileCount: number;
 *         selectedRouteChangedCount: number;
 *         sourceChangedCount: number;
 *         runtimeProofChangedCount: number;
 *     };
 *     rows: {
 *         profileId: string;
 *         status: 'added' | 'removed' | 'changed' | 'unchanged';
 *         selectedRouteChanged: boolean;
 *         sourceChanged: boolean;
 *         runtimeProofChanged: boolean;
 *         left: Record<string, unknown> | null;
 *         right: Record<string, unknown> | null;
 *     }[];
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
 * @param {{ limit?: number }} [options]
 * @returns {Promise<{ name: string; filePath: string; mtimeMs: number; size: number }[]>}
 */
export async function listModelGatewaySelectionDecisionTraceFiles(options = {}) {
    return DEFAULT_MODEL_GATEWAY_SELECTION_TRACE_STORE.list(options);
}

/** @param {{ maxFiles?: number; dryRun?: boolean }} [options] */
export async function applyModelGatewaySelectionTraceRetention(options = {}) {
    return DEFAULT_MODEL_GATEWAY_SELECTION_TRACE_STORE.applyRetention(options);
}
