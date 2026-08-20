#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { access, stat } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { COPILOT_TERMINAL_LLM_B_LIVE_TEST_PATH, REPO_ROOT } from '../index.mjs';

import {
    DEFAULT_MODEL_GATEWAY_CATALOG_PATH,
    JsonModelGatewayCatalogStore,
    SqliteModelGatewayCatalogStore,
    auditModelGatewayCatalogSnapshotIntegrity,
    auditModelGatewayPostRuntimeSelection,
    auditModelGatewayPreRuntimeSelection,
    buildModelGatewayRuntimeSelectorPlan,
    collectModelGatewaySecretAuditEnvValues,
    compareModelGatewayCatalogSnapshotParity,
    compareModelGatewaySelectionAudits,
    createEnvSecretRegistry,
    createGatewayRuntimeHealthIndex,
    deriveModelGatewayRuntimeAccountOverlaysFromHealth,
    evaluateModelGatewayCatalogEligibility,
    filterModelGatewayRuntimeEligibilityOverlayDecisions,
    listByokProviderModelHealth,
    mergeByokProviderHealthRecords,
    renderModelGatewayLocalProviderOptInGuidance,
    resolveModelGatewaySelectionPolicy,
    summarizeModelGatewayRuntimeAccountOverlays,
    summarizeModelGatewayLocalProviderOptInBlocks,
} from '../../../src/copilot/model-gateway/index.js';
import { setDbLogger } from '../../../src/copilot/db/sqlite.js';
import { loadModelGatewayDotenv } from '../lib/env.mjs';

loadModelGatewayDotenv();

const ROOT = REPO_ROOT;
const LIVE_RUNNER_PATH = COPILOT_TERMINAL_LLM_B_LIVE_TEST_PATH;
const REDACTION_WORKER_PATH = path.join(ROOT, 'scripts/model-gateway/commands/model-gateway-live-redaction-worker.mjs');
const DEFAULT_SQLITE_PATH = path.join(ROOT, 'data/copilot.sqlite');
const TERMINAL_LIVE_ROUTE_PROFILES = Object.freeze(['repo_agent', 'code', 'tool_agent']);
const TERMINAL_LIVE_PREFERRED_PROBE_KINDS = Object.freeze(['live_tool_protocol', 'live_ask_user']);
const TERMINAL_LIVE_BLOCK_FAILED_PROBE_KINDS = Object.freeze([
    ...TERMINAL_LIVE_PREFERRED_PROBE_KINDS,
    'live_turn',
]);
/** @type {readonly string[]} */
const TERMINAL_LIVE_REQUIRE_AGENT_PROBE_PROFILES = Object.freeze([]);
const TERMINAL_LIVE_TEMPORARY_FAILURE_COOLDOWN_MS = 900_000;
// Readiness needs a recent representative sample, not an exhaustive runtime-health replay. Keep this bounded so the
// MCP adapter can request SQLite-backed health without turning a readiness probe into a long-running analytics job.
const SQLITE_RUNTIME_HEALTH_READ_LIMIT = 500;
const DEFAULT_SQLITE_REDACTION_MAX_ROWS_PER_TABLE = 25;
const DEEP_SQLITE_REDACTION_MAX_ROWS_PER_TABLE = 100_000;
import { createArgReader } from '../cli-args.mjs';

const args = process.argv.slice(2);
const readArg = createArgReader(args);
const argSet = new Set(args);
/** @type {{ sourceStore: JsonModelGatewayCatalogStore; sqliteStore: SqliteModelGatewayCatalogStore } | null} */
let readinessStoreContext = null;
/** @type {{
 *     identity: string;
 *     sourceSnapshot: Awaited<ReturnType<JsonModelGatewayCatalogStore['readSnapshot']>>;
 *     integrity: ReturnType<typeof auditModelGatewayCatalogSnapshotIntegrity>;
 *     selectionEnvironmentIdentity?: string;
 *     allowProbeSelection?: ReturnType<typeof auditModelGatewayPreRuntimeSelection>;
 *     strictAccessSelection?: ReturnType<typeof auditModelGatewayPreRuntimeSelection>;
 * } | null} */
let catalogStaticReadinessCache = null;

function getReadinessStores() {
    if (readinessStoreContext) return readinessStoreContext;
    readinessStoreContext = {
        sourceStore: new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH }),
        sqliteStore: new SqliteModelGatewayCatalogStore({ dbPath: DEFAULT_SQLITE_PATH }),
    };
    return readinessStoreContext;
}

async function catalogFileIdentity(/** @type {string} */ filePath) {
    try {
        const info = await stat(filePath);
        return `${info.size}:${Math.trunc(info.mtimeMs)}:${Math.trunc(info.ctimeMs)}`;
    } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unknown';
        return `unavailable:${code}:${Date.now()}`;
    }
}

function readinessEnvironmentIdentity(env = process.env) {
    const hash = createHash('sha256');
    for (const [key, value] of Object.entries(env).sort(([left], [right]) => left.localeCompare(right))) {
        hash.update(key).update('\0').update(String(value ?? '')).update('\0');
    }
    return hash.digest('hex');
}

let persistentRedactionRequestSequence = 0;
/** @type {Map<string, { worker: Worker; pending: Map<string, { startedAt: number; timer: NodeJS.Timeout; resolve: (value: unknown) => void; reject: (reason?: unknown) => void }> }>} */
const persistentRedactionWorkers = new Map();

function normalizeRedactionWorkerResult(
    /** @type {'catalog' | 'sqlite'} */ mode,
    /** @type {number} */ startedAt,
    /** @type {{ success?: boolean; audit?: Record<string, unknown>; error?: string; durationMs?: number; sourceSnapshotId?: string; requestId?: string }} */ result,
) {
    if (!result || result.success !== true || !result.audit) {
        throw new Error(result?.error ?? `redaction worker ${mode} returned no audit`);
    }
    return {
        audit: result.audit,
        durationMs: Number((performance.now() - startedAt).toFixed(3)),
        workerDurationMs: Number(result.durationMs ?? 0),
        sourceSnapshotId: typeof result.sourceSnapshotId === 'string' ? result.sourceSnapshotId : null,
    };
}

function destroyPersistentRedactionWorker(
    /** @type {'catalog' | 'sqlite'} */ mode,
    /** @type {{ worker: Worker; pending: Map<string, { startedAt: number; timer: NodeJS.Timeout; resolve: (value: unknown) => void; reject: (reason?: unknown) => void }> }} */ state,
    /** @type {unknown} */ error,
) {
    if (persistentRedactionWorkers.get(mode) === state) persistentRedactionWorkers.delete(mode);
    for (const pending of state.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
    }
    state.pending.clear();
    void state.worker.terminate();
}

function getPersistentRedactionWorker(/** @type {'catalog' | 'sqlite'} */ mode) {
    const existing = persistentRedactionWorkers.get(mode);
    if (existing) return existing;
    const worker = new Worker(REDACTION_WORKER_PATH, { workerData: { mode, persistent: true } });
    const state = { worker, pending: new Map() };
    worker.on('message', (result) => {
        const requestId = typeof result?.requestId === 'string' ? result.requestId : '';
        const pending = state.pending.get(requestId);
        if (!pending) return;
        state.pending.delete(requestId);
        clearTimeout(pending.timer);
        try {
            pending.resolve(normalizeRedactionWorkerResult(mode, pending.startedAt, result));
        } catch (error) {
            pending.reject(error);
        }
    });
    worker.on('error', (error) => destroyPersistentRedactionWorker(mode, state, error));
    worker.on('exit', (code) => {
        if (persistentRedactionWorkers.get(mode) !== state) return;
        destroyPersistentRedactionWorker(mode, state, new Error(`persistent redaction worker ${mode} exited with ${String(code)}`));
    });
    persistentRedactionWorkers.set(mode, state);
    return state;
}

function runPersistentRedactionWorker(
    /** @type {'catalog' | 'sqlite'} */ mode,
    /** @type {number} */ maxRowsPerTable,
) {
    const state = getPersistentRedactionWorker(mode);
    const requestId = `redaction-${mode}-${Date.now()}-${++persistentRedactionRequestSequence}`;
    return new Promise((resolvePromise, rejectPromise) => {
        const startedAt = performance.now();
        const timer = setTimeout(() => {
            const pending = state.pending.get(requestId);
            if (!pending) return;
            state.pending.delete(requestId);
            pending.reject(new Error(`persistent redaction worker ${mode} timed out`));
            destroyPersistentRedactionWorker(mode, state, new Error(`persistent redaction worker ${mode} timed out`));
        }, 30_000);
        timer.unref?.();
        state.pending.set(requestId, { startedAt, timer, resolve: resolvePromise, reject: rejectPromise });
        state.worker.postMessage({ requestId, maxRowsPerTable });
    });
}

/**
 * Run one fixed redaction audit in an isolated worker thread. MCP calls may reuse persistent workers; CLI calls remain
 * one-shot so the command exits naturally.
 *
 * @param {'catalog' | 'sqlite'} mode
 * @param {number} maxRowsPerTable
 * @param {boolean} [reuseWorker]
 */
function runRedactionWorker(mode, maxRowsPerTable, reuseWorker = false) {
    if (reuseWorker) return runPersistentRedactionWorker(mode, maxRowsPerTable);
    return new Promise((resolvePromise, rejectPromise) => {
        const startedAt = performance.now();
        let settled = false;
        const worker = new Worker(REDACTION_WORKER_PATH, { workerData: { mode, maxRowsPerTable } });
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            void worker.terminate();
            rejectPromise(new Error(`redaction worker ${mode} timed out`));
        }, 30_000);
        timer.unref?.();
        const finish = (
            /** @type {{ success?: boolean; audit?: Record<string, unknown>; error?: string; durationMs?: number; sourceSnapshotId?: string } | null} */ result,
            /** @type {unknown} */ error = null,
        ) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (error) return rejectPromise(error);
            if (!result) return rejectPromise(new Error(`redaction worker ${mode} returned no result`));
            try {
                resolvePromise(normalizeRedactionWorkerResult(mode, startedAt, result));
            } catch (normalizeError) {
                rejectPromise(normalizeError);
            }
        };
        worker.once('message', (result) => finish(result));
        worker.once('error', (error) => finish(null, error));
        worker.once('exit', (code) => {
            if (!settled && code !== 0) finish(null, new Error(`redaction worker ${mode} exited with ${String(code)}`));
        });
    });
}


/**
 * @param {unknown} value
 * @returns {string | null}
 */
function optionalString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
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
 * @returns {number}
 */
function optionalNumber(value) {
    const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    return Number.isFinite(number) ? number : 0;
}

/**
 * @param {string[]} names
 * @param {number} fallback
 * @returns {number}
 */
function readPositiveInteger(names, fallback) {
    for (const name of names) {
        const raw = readArg(name);
        if (!raw) continue;
        const parsed = Number.parseInt(raw, 10);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return fallback;
}

async function fileExists(/** @type {string} */ filePath) {
    try {
        await access(filePath);
        return true;
    } catch {
        return false;
    }
}

/**
 * @param {ReturnType<typeof auditModelGatewayPreRuntimeSelection>} audit
 * @returns {string[]}
 */
function selectedDispositions(audit) {
    return [
        ...new Set(
            audit.profiles.flatMap((profile) => {
                const disposition = optionalString(profile.selected?.['eligibilityDisposition']);
                return disposition ? [disposition] : [];
            }),
        ),
    ].sort();
}

/**
 * @param {ReturnType<typeof auditModelGatewayPreRuntimeSelection>} audit
 * @returns {{ total: number; byProfile: Record<string, number> }}
 */
function supplyWarningSummary(audit) {
    /** @type {Record<string, number>} */
    const byProfile = {};
    for (const profile of audit.profiles) {
        byProfile[profile.profileId] = profile.supplyWarnings.length;
    }
    return {
        total: Object.values(byProfile).reduce((sum, count) => sum + count, 0),
        byProfile,
    };
}

/**
 * @param {Record<string, unknown> | null | undefined} probe
 * @returns {string | null}
 */
function runtimeProbeStatus(probe) {
    const normalizedProbe = optionalRecord(probe);
    if (!normalizedProbe) return null;
    return optionalString(normalizedProbe['status']) ?? (normalizedProbe['ok'] === true ? 'ok' : normalizedProbe['ok'] === false ? 'failed' : null);
}

/**
 * @param {unknown} probes
 * @returns {Record<string, string>}
 */
function runtimeProbeStatuses(probes) {
    const normalizedProbes = optionalRecord(probes);
    if (!normalizedProbes) return {};
    /** @type {[string, string][]} */
    const entries = [];
    for (const [kind, probe] of Object.entries(normalizedProbes)) {
        const status = runtimeProbeStatus(optionalRecord(probe));
        if (status) entries.push([kind, status]);
    }
    entries.sort(([left], [right]) => left.localeCompare(right));
    return Object.fromEntries(entries);
}

/**
 * @param {ReturnType<typeof buildModelGatewayRuntimeSelectorPlan>['routes'][number]} route
 * @returns {Record<string, unknown>}
 */
function summarizeTerminalLiveRoute(route) {
    const runtimeHealth = optionalRecord(route.runtimeHealth);
    const health = optionalRecord(runtimeHealth?.['health']);
    const probeStatuses = runtimeProbeStatuses(health?.['probes']);
    const routeProfile = optionalString(route.selected?.['routeProfile']);
    const healthRouteProfile = optionalString(health?.['routeProfile']);
    return {
        profileId: route.profileId,
        status: route.status,
        providerId: optionalString(route.selected?.['providerId']),
        providerModel: optionalString(route.selected?.['providerModel']),
        routeProfile,
        hasRuntimeProof: route.hasRuntimeProof,
        runtimeHealth: runtimeHealth
            ? {
                  include: runtimeHealth['include'] === true,
                  reason: optionalString(runtimeHealth['reason']),
                  healthRouteProfile,
                  exactRouteProfileMatch: routeProfile !== null && healthRouteProfile === routeProfile,
                  profilelessHealth: healthRouteProfile === null,
                  chatStatus: optionalString(health?.['chatStatus']),
                  agentProbeStatus: optionalString(health?.['agentProbeStatus']),
                  probeStatuses,
                  preferredProbeProofs: Object.fromEntries(
                      TERMINAL_LIVE_PREFERRED_PROBE_KINDS.map((kind) => [kind, probeStatuses[kind] === 'ok']),
                  ),
                  blockingProbeFailures: Object.fromEntries(
                      TERMINAL_LIVE_BLOCK_FAILED_PROBE_KINDS.map((kind) => [kind, probeStatuses[kind] === 'failed']),
                  ),
              }
            : null,
        reasons: route.reasons,
    };
}

/**
 * Build the canonical read-only LLM-B / Model Gateway readiness snapshot without writing to stdout or terminating the process.
 * This function is safe to call from the MCP process; CPU-heavy redaction remains isolated in worker threads.
 *
 * @param {{ includeSqliteRuntimeHealth?: boolean; failOnSupplyWarning?: boolean; sqliteRedactionMaxRowsPerTable?: number; reuseRedactionWorkers?: boolean }} [options]
 */
export async function buildModelGatewayLiveReadiness(options = {}) {
    const readinessStartedAt = performance.now();
    /** @type {Record<string, number>} */
    const phaseTimingsMs = {};
    const includeSqliteRuntimeHealth = options.includeSqliteRuntimeHealth === true;
    const failOnSupplyWarning = options.failOnSupplyWarning === true;
    const reuseRedactionWorkers = options.reuseRedactionWorkers === true;
    const sqliteRedactionMaxRowsPerTable = Math.max(
        1,
        Math.min(options.sqliteRedactionMaxRowsPerTable ?? DEFAULT_SQLITE_REDACTION_MAX_ROWS_PER_TABLE, 1_000_000),
    );

    /** @template T @param {string} name @param {() => Promise<T>} task @returns {Promise<T>} */
    async function timedAsync(name, task) {
        const startedAt = performance.now();
        try {
            return await task();
        } finally {
            phaseTimingsMs[name] = Number((performance.now() - startedAt).toFixed(3));
        }
    }

    /** @template T @param {string} name @param {() => T} task @returns {T} */
    function timedSync(name, task) {
        const startedAt = performance.now();
        try {
            return task();
        } finally {
            phaseTimingsMs[name] = Number((performance.now() - startedAt).toFixed(3));
        }
    }

const redactionWorkersPromise = Promise.all([
    runRedactionWorker('catalog', sqliteRedactionMaxRowsPerTable, reuseRedactionWorkers),
    runRedactionWorker('sqlite', sqliteRedactionMaxRowsPerTable, reuseRedactionWorkers),
]).then(
    (results) => ({ results, error: null }),
    (error) => ({ results: null, error: error instanceof Error ? error : new Error(String(error)) }),
);
const { sourceStore, sqliteStore } = getReadinessStores();
const sourceCatalogIdentity = await timedAsync('sourceCatalogIdentityRead', () => catalogFileIdentity(sourceStore.filePath));
const cachedSourceCatalog =
    catalogStaticReadinessCache && catalogStaticReadinessCache.identity === sourceCatalogIdentity
        ? catalogStaticReadinessCache
        : null;
const sourceSnapshotPromise = cachedSourceCatalog
    ? Promise.resolve(cachedSourceCatalog.sourceSnapshot)
    : timedAsync('sourceSnapshotRead', () => sourceStore.readSnapshot());
if (cachedSourceCatalog) phaseTimingsMs['sourceSnapshotRead'] = 0;
const [sourceSnapshot, sqliteSnapshot, sqliteDiagnostics] = await Promise.all([
    sourceSnapshotPromise,
    timedAsync('sqliteSnapshotRead', () => sqliteStore.readSnapshot()),
    timedAsync('sqliteStorageDiagnostics', () => sqliteStore.readStorageDiagnostics()),
]);
const integrity = cachedSourceCatalog
    ? cachedSourceCatalog.integrity
    : timedSync('catalogIntegrityAudit', () => auditModelGatewayCatalogSnapshotIntegrity(sourceSnapshot));
if (cachedSourceCatalog) phaseTimingsMs['catalogIntegrityAudit'] = 0;
if (!cachedSourceCatalog) {
    catalogStaticReadinessCache = { identity: sourceCatalogIdentity, sourceSnapshot, integrity };
}
const sourceCatalogStaticCacheHit = cachedSourceCatalog !== null;
const parity = timedSync('catalogSqliteParity', () => compareModelGatewayCatalogSnapshotParity(sourceSnapshot, sqliteSnapshot));
const secretAuditValues = timedSync('secretAuditEnvCollection', () => collectModelGatewaySecretAuditEnvValues(process.env));
const secretRegistry = createEnvSecretRegistry();
const selectionEnvironmentIdentity = timedSync('selectionEnvironmentIdentity', () => readinessEnvironmentIdentity(process.env));
const fileHealthRecords = timedSync('fileRuntimeHealthRead', () => listByokProviderModelHealth());
/** @type {Awaited<ReturnType<SqliteModelGatewayCatalogStore['listLatestRuntimeHealthRecords']>>} */
let sqliteHealthRecords = [];
let sqliteRuntimeError = null;
if (includeSqliteRuntimeHealth) {
    try {
        sqliteHealthRecords = await timedAsync('sqliteRuntimeHealthRead', () =>
            sqliteStore.listLatestRuntimeHealthRecords({ limit: SQLITE_RUNTIME_HEALTH_READ_LIMIT }),
        );
    } catch (error) {
        sqliteRuntimeError = error instanceof Error ? error.message : String(error);
    }
} else {
    phaseTimingsMs['sqliteRuntimeHealthRead'] = 0;
}
const healthRecords = timedSync('runtimeHealthMerge', () =>
    mergeByokProviderHealthRecords(fileHealthRecords, sqliteHealthRecords),
);
const runtimeHealthIndex = timedSync('runtimeHealthIndexBuild', () => createGatewayRuntimeHealthIndex(healthRecords));
const sqliteProbeOnlyRecords = sqliteHealthRecords.filter((record) => record?.['runtimeHealthStatus'] === 'probe-only');
const sqliteRuntimeProbeProofRecords = sqliteHealthRecords.filter(
    (record) =>
        record &&
        typeof record === 'object' &&
        record['probes'] &&
        typeof record['probes'] === 'object' &&
        Object.values(record['probes']).some((probe) => probe && typeof probe === 'object' && probe['ok'] === true),
);
const eligibilityStartedAt = performance.now();
const runtimeAccountOverlays = deriveModelGatewayRuntimeAccountOverlaysFromHealth(healthRecords);
const evaluationNow = new Date();
const runtimeAccountOverlaySummary = summarizeModelGatewayRuntimeAccountOverlays(runtimeAccountOverlays, {
    now: evaluationNow,
});
const effectiveEligibility = evaluateModelGatewayCatalogEligibility({
    snapshot: sourceSnapshot,
    secretRegistry,
    healthRecords,
    now: () => evaluationNow,
    policy: {
        unknownAccessPolicy: 'block',
        policyProfile: 'live-readiness-effective-strict',
    },
});
const runtimeOverlayDecisions = filterModelGatewayRuntimeEligibilityOverlayDecisions(effectiveEligibility.decisions);
const effectiveSnapshot = {
    ...sourceSnapshot,
    source: 'live-readiness-effective-preview',
    modelEligibilityDecisions: [
        ...(Array.isArray(sourceSnapshot.modelEligibilityDecisions) ? sourceSnapshot.modelEligibilityDecisions : []),
        ...runtimeOverlayDecisions,
    ],
    modelEligibilityRuns: [
        ...(Array.isArray(sourceSnapshot.modelEligibilityRuns) ? sourceSnapshot.modelEligibilityRuns : []),
        effectiveEligibility.run,
    ],
};
phaseTimingsMs['eligibilityEvaluation'] = Number((performance.now() - eligibilityStartedAt).toFixed(3));
const selectionStartedAt = performance.now();
const cachedStaticSelections =
    catalogStaticReadinessCache?.selectionEnvironmentIdentity === selectionEnvironmentIdentity &&
    catalogStaticReadinessCache?.allowProbeSelection &&
    catalogStaticReadinessCache?.strictAccessSelection
        ? catalogStaticReadinessCache
        : null;
const allowProbeSelection =
    cachedStaticSelections?.allowProbeSelection ??
    timedSync('selectionAllowProbeAudit', () =>
          auditModelGatewayPreRuntimeSelection(sourceSnapshot, {
              strict: false,
              secretRegistry,
          }),
      );
const strictAccessSelection =
    cachedStaticSelections?.strictAccessSelection ??
    timedSync('selectionStrictAccessAudit', () =>
          auditModelGatewayPreRuntimeSelection(sourceSnapshot, {
              strict: true,
              secretRegistry,
          }),
      );
if (cachedStaticSelections) {
    phaseTimingsMs['selectionAllowProbeAudit'] = 0;
    phaseTimingsMs['selectionStrictAccessAudit'] = 0;
} else if (catalogStaticReadinessCache) {
    catalogStaticReadinessCache.selectionEnvironmentIdentity = selectionEnvironmentIdentity;
    catalogStaticReadinessCache.allowProbeSelection = allowProbeSelection;
    catalogStaticReadinessCache.strictAccessSelection = strictAccessSelection;
}
const sourceSelectionStaticCacheHit = cachedStaticSelections !== null;
const effectiveStrictSelection = timedSync('selectionEffectiveStrictAudit', () =>
    auditModelGatewayPreRuntimeSelection(effectiveSnapshot, {
        strict: true,
        secretRegistry,
    }),
);
const postRuntimeEffectiveSelection = timedSync('selectionPostRuntimeAudit', () =>
    auditModelGatewayPostRuntimeSelection(effectiveSnapshot, {
        strict: true,
        secretRegistry,
        runtimeHealthRecords: healthRecords,
        runtimeHealthIndex,
    }),
);
const runtimeSelectionComparison = timedSync('runtimeSelectionComparison', () =>
    compareModelGatewaySelectionAudits(effectiveStrictSelection, postRuntimeEffectiveSelection),
);
const runtimeSelectionPolicy = timedSync('runtimeSelectionPolicy', () =>
    resolveModelGatewaySelectionPolicy(runtimeSelectionComparison, { mode: 'metadata_first' }),
);
const runtimeSelectorPlan = timedSync('runtimeSelectorPlan', () =>
    buildModelGatewayRuntimeSelectorPlan(runtimeSelectionPolicy, {
        source: 'model-gateway-live-readiness',
        requireRuntimeEnvReady: true,
        env: process.env,
    }),
);
phaseTimingsMs['terminalLiveBaseSelectionAudit'] = 0;
const terminalLivePostRuntimeSelection = timedSync('terminalLivePostRuntimeAudit', () =>
    auditModelGatewayPostRuntimeSelection(effectiveSnapshot, {
        strict: true,
        secretRegistry,
        profiles: [...TERMINAL_LIVE_ROUTE_PROFILES],
        runtimeHealthRecords: healthRecords,
        runtimeHealthIndex,
        blockFailedProbeKinds: [...TERMINAL_LIVE_BLOCK_FAILED_PROBE_KINDS],
        temporaryFailureCooldownMs: TERMINAL_LIVE_TEMPORARY_FAILURE_COOLDOWN_MS,
    }),
);
const terminalLiveRuntimeSelectionComparison = timedSync('terminalLiveSelectionComparison', () =>
    compareModelGatewaySelectionAudits(effectiveStrictSelection, terminalLivePostRuntimeSelection, {
        profiles: [...TERMINAL_LIVE_ROUTE_PROFILES],
    }),
);
const terminalLiveRuntimeSelectionPolicy = timedSync('terminalLiveSelectionPolicy', () =>
    resolveModelGatewaySelectionPolicy(terminalLiveRuntimeSelectionComparison, {
        mode: 'prefer_runtime_proved',
    }),
);
const terminalLiveRuntimeSelectorPlan = timedSync('terminalLiveSelectorPlan', () =>
    buildModelGatewayRuntimeSelectorPlan(terminalLiveRuntimeSelectionPolicy, {
        source: 'model-gateway-live-readiness:terminal-live',
        requireRuntimeEnvReady: true,
        requireAgentProbeProfiles: [...TERMINAL_LIVE_REQUIRE_AGENT_PROBE_PROFILES],
        env: process.env,
        runtimeHealthRecords: healthRecords,
        runtimeHealthIndex,
        blockFailedProbeKinds: [...TERMINAL_LIVE_BLOCK_FAILED_PROBE_KINDS],
        temporaryFailureCooldownMs: TERMINAL_LIVE_TEMPORARY_FAILURE_COOLDOWN_MS,
    }),
);
phaseTimingsMs['selectionAndSelectorPlans'] = Number((performance.now() - selectionStartedAt).toFixed(3));
const runnerExists = await timedAsync('liveRunnerPresenceCheck', () => fileExists(LIVE_RUNNER_PATH));
const redactionWorkers = await redactionWorkersPromise;
if (redactionWorkers.error || !redactionWorkers.results) {
    throw redactionWorkers.error ?? new Error('redaction workers returned no results');
}
const [catalogRedactionWorker, sqliteRedactionWorker] = redactionWorkers.results;
if (catalogRedactionWorker.sourceSnapshotId !== sourceSnapshot.snapshotId) {
    throw new Error(
        `catalog redaction worker snapshot mismatch: expected ${sourceSnapshot.snapshotId}, got ${String(catalogRedactionWorker.sourceSnapshotId)}`,
    );
}
const catalogRedaction = catalogRedactionWorker.audit;
const sqliteRedaction = sqliteRedactionWorker.audit;
phaseTimingsMs['catalogRedactionAudit'] = catalogRedactionWorker.durationMs;
phaseTimingsMs['sqliteRedactionAudit'] = sqliteRedactionWorker.durationMs;
phaseTimingsMs['catalogRedactionWorkerCore'] = catalogRedactionWorker.workerDurationMs;
phaseTimingsMs['sqliteRedactionWorkerCore'] = sqliteRedactionWorker.workerDurationMs;
const strictSelectedDispositions = selectedDispositions(strictAccessSelection);
const effectiveSelectedDispositions = selectedDispositions(effectiveStrictSelection);
const postRuntimeSelectedDispositions = selectedDispositions(postRuntimeEffectiveSelection);
const allowProbeSupplyWarnings = supplyWarningSummary(allowProbeSelection);
const strictAccessSupplyWarnings = supplyWarningSummary(strictAccessSelection);
const effectiveStrictSupplyWarnings = supplyWarningSummary(effectiveStrictSelection);
const postRuntimeEffectiveSupplyWarnings = supplyWarningSummary(postRuntimeEffectiveSelection);
const localProviderOptIn = {
    allowProbe: summarizeModelGatewayLocalProviderOptInBlocks(allowProbeSelection),
    strictAccess: summarizeModelGatewayLocalProviderOptInBlocks(strictAccessSelection),
    effectiveStrict: summarizeModelGatewayLocalProviderOptInBlocks(effectiveStrictSelection),
    postRuntimeEffective: summarizeModelGatewayLocalProviderOptInBlocks(postRuntimeEffectiveSelection),
};
const strictOnlyKnownAccess =
    strictAccessSelection.ok &&
    strictSelectedDispositions.length > 0 &&
    strictSelectedDispositions.every((disposition) => disposition === 'eligible');
const effectiveOnlyKnownAccess =
    effectiveStrictSelection.ok &&
    effectiveSelectedDispositions.length > 0 &&
    effectiveSelectedDispositions.every((disposition) => disposition === 'eligible');
const postRuntimeOnlyKnownAccess =
    postRuntimeEffectiveSelection.ok &&
    postRuntimeSelectedDispositions.length > 0 &&
    postRuntimeSelectedDispositions.every((disposition) => disposition === 'eligible');
const checks = [
    {
        id: 'catalog_integrity',
        ok: integrity.ok,
        detail: `duplicate checks ok=${integrity.ok}`,
    },
    {
        id: 'sqlite_parity',
        ok: parity.ok,
        detail: `count mismatches=${parity.countMismatches.length}, key mismatches=${parity.keyMismatches.length}`,
    },
    {
        id: 'redaction_audit',
        ok: catalogRedaction.ok && sqliteRedaction.ok,
        detail: `catalogLeaks=${catalogRedaction.leakCount}, sqliteLeaks=${sqliteRedaction.leakCount}, sqliteRowsPerTable=${sqliteRedactionMaxRowsPerTable}`,
    },
    {
        id: 'selection_allow_probe',
        ok: allowProbeSelection.ok,
        detail: `${allowProbeSelection.summary.selectedProfileCount}/${allowProbeSelection.summary.profileCount} profiles selected`,
    },
    {
        id: 'selection_strict_access',
        ok: strictAccessSelection.ok && strictOnlyKnownAccess,
        detail: `${strictAccessSelection.summary.selectedProfileCount}/${strictAccessSelection.summary.profileCount} profiles selected, dispositions=${strictSelectedDispositions.join(',') || 'none'}`,
    },
    {
        id: 'selection_effective_observed_health',
        ok: effectiveStrictSelection.ok && effectiveOnlyKnownAccess,
        detail: `${effectiveStrictSelection.summary.selectedProfileCount}/${effectiveStrictSelection.summary.profileCount} profiles selected, runtimeOverlays=${runtimeAccountOverlays.length} active=${runtimeAccountOverlaySummary.activeCount} expired=${runtimeAccountOverlaySummary.expiredCount}, dispositions=${effectiveSelectedDispositions.join(',') || 'none'}`,
    },
    {
        id: 'selection_post_runtime_observed_health',
        ok: postRuntimeEffectiveSelection.ok && postRuntimeOnlyKnownAccess,
        detail: `${postRuntimeEffectiveSelection.summary.selectedProfileCount}/${postRuntimeEffectiveSelection.summary.profileCount} profiles selected, healthMatches=${postRuntimeEffectiveSelection.summary.healthRecordCount}, healthProofs=${postRuntimeEffectiveSelection.summary.runtimeHealthProofCount}, agentProofs=${postRuntimeEffectiveSelection.summary.runtimeAgentProbeProofCount}, probeProofs=${postRuntimeEffectiveSelection.summary.runtimeProbeProofCount}, dispositions=${postRuntimeSelectedDispositions.join(',') || 'none'}`,
    },
    {
        id: 'runtime_selector_plan_ready',
        ok: runtimeSelectorPlan.ready && runtimeSelectorPlan.summary.blockedProfileCount === 0,
        detail: `${runtimeSelectorPlan.summary.selectedProfileCount}/${runtimeSelectorPlan.summary.profileCount} routes selected, blocked=${runtimeSelectorPlan.summary.blockedProfileCount}, accessBlocked=${runtimeSelectorPlan.summary.accountAccessBlockedCount ?? 0}, envReady=${runtimeSelectorPlan.summary.runtimeEnvReadyCount}, envBlocked=${runtimeSelectorPlan.summary.runtimeEnvBlockedCount}, proofSelected=${runtimeSelectorPlan.summary.runtimeProofSelectedCount}`,
    },
    {
        id: 'terminal_live_runtime_selector_plan_ready',
        ok:
            terminalLiveRuntimeSelectorPlan.ready &&
            terminalLiveRuntimeSelectorPlan.summary.selectedProfileCount === TERMINAL_LIVE_ROUTE_PROFILES.length &&
            terminalLiveRuntimeSelectorPlan.summary.blockedProfileCount === 0,
        detail: `${terminalLiveRuntimeSelectorPlan.summary.selectedProfileCount}/${terminalLiveRuntimeSelectorPlan.summary.profileCount} terminal routes selected, blocked=${terminalLiveRuntimeSelectorPlan.summary.blockedProfileCount}, accessBlocked=${terminalLiveRuntimeSelectorPlan.summary.accountAccessBlockedCount ?? 0}, envReady=${terminalLiveRuntimeSelectorPlan.summary.runtimeEnvReadyCount}, envBlocked=${terminalLiveRuntimeSelectorPlan.summary.runtimeEnvBlockedCount}, proofSelected=${terminalLiveRuntimeSelectorPlan.summary.runtimeProofSelectedCount}, probeBlocked=${terminalLiveRuntimeSelectorPlan.summary.runtimeProbeBlockedCount}`,
    },
    {
        id: 'selection_supply_warnings',
        ok: !failOnSupplyWarning || (effectiveStrictSupplyWarnings.total === 0 && postRuntimeEffectiveSupplyWarnings.total === 0),
        detail: `allow=${allowProbeSupplyWarnings.total}, strict=${strictAccessSupplyWarnings.total}, effective=${effectiveStrictSupplyWarnings.total}, postRuntime=${postRuntimeEffectiveSupplyWarnings.total}`,
    },
    {
        id: 'runtime_not_promoted',
        ok: strictAccessSelection.profiles.every((profile) => optionalNumber(profile.decisionLayers['runtimeProbeProofCount']) === 0),
        detail: 'runtime proof count remains zero before live tests',
    },
    {
        id: 'runtime_sqlite_observability',
        ok: true,
        detail: `runtimeRows=${sqliteDiagnostics.runtimeRows}, healthObservations=${sqliteDiagnostics.tableCounts['copilot_model_gateway_health_observations']}, probeResults=${sqliteDiagnostics.tableCounts['copilot_model_gateway_runtime_probe_results']}`,
    },
    {
        id: 'runtime_sqlite_probe_source',
        ok: true,
        detail: `sqliteHealthRecords=${sqliteHealthRecords.length}, probeOnly=${sqliteProbeOnlyRecords.length}, probeProofRecords=${sqliteRuntimeProbeProofRecords.length}`,
    },
    {
        id: 'live_runner_present',
        ok: runnerExists,
        detail: path.relative(ROOT, LIVE_RUNNER_PATH),
    },
];
const commands = [
    'npm run model-gateway:selection:effective -- --strict --fail',
    'npm run model-gateway:runtime-selector -- --fail',
    'npm run model-gateway:runtime-health:diff -- --write-snapshot',
    'npm run model-gateway:runtime-health:mirror',
    'npm run model-gateway:live:llm-b -- --control-only --timeout-ms=180000',
    'npm run model-gateway:live:llm-b -- --byok-probe --byok-fixture --control-only --timeout-ms=240000',
    `npm run model-gateway:live:llm-b -- --byok-real --byok-real-route-profile=repo_agent --byok-real-route-fallback-profiles=code,tool_agent --byok-real-route-selection-policy=prefer_runtime_proved --byok-real-route-execute --byok-real-route-allow-probe --byok-real-route-temporary-failure-cooldown-ms=${TERMINAL_LIVE_TEMPORARY_FAILURE_COOLDOWN_MS} --byok-real-route-max-attempts=8 --byok-real-route-max-attempts-per-provider=4 --byok-real-route-timeout-ms=20000 --control-only --timeout-ms=240000`,
    `npm run model-gateway:live:llm-b -- --byok-real --byok-real-route-profile=repo_agent --byok-real-route-fallback-profiles=code,tool_agent --byok-real-route-selection-policy=prefer_runtime_proved --byok-real-route-execute --byok-real-route-allow-probe --byok-real-route-temporary-failure-cooldown-ms=${TERMINAL_LIVE_TEMPORARY_FAILURE_COOLDOWN_MS} --byok-real-route-max-attempts=8 --byok-real-route-max-attempts-per-provider=4 --byok-real-route-timeout-ms=20000 --timeout-ms=900000`,
];
const readinessTotalMs = Number((performance.now() - readinessStartedAt).toFixed(3));
const slowestPhase = Object.entries(phaseTimingsMs)
    .sort((left, right) => right[1] - left[1])
    .map(([name, durationMs]) => ({ name, durationMs }))[0] ?? null;
const summary = {
    schema: 'model-gateway-live-readiness',
    ok: checks.every((check) => check.ok),
    storePath: sourceStore.filePath,
    sqlitePath: DEFAULT_SQLITE_PATH,
    snapshotId: sourceSnapshot.snapshotId,
    generatedAt: sourceSnapshot.generatedAt,
    timing: {
        totalMs: readinessTotalMs,
        phasesMs: phaseTimingsMs,
        slowestPhase,
    },
    cache: {
        sourceCatalogStaticHit: sourceCatalogStaticCacheHit,
        sourceSelectionStaticHit: sourceSelectionStaticCacheHit,
    },
    checks,
    integrity: {
        ok: integrity.ok,
        redactedIdentityCount: integrity.redactedIdentityCount,
    },
    sqlite: {
        parityOk: parity.ok,
        countMismatches: parity.countMismatches,
        keyMismatches: parity.keyMismatches,
        runtimeRows: sqliteDiagnostics.runtimeRows,
        runtimeHealthReadLimit: SQLITE_RUNTIME_HEALTH_READ_LIMIT,
            healthObservations: sqliteDiagnostics.tableCounts['copilot_model_gateway_health_observations'],
            runtimeProbeRuns: sqliteDiagnostics.tableCounts['copilot_model_gateway_runtime_probe_runs'],
            runtimeProbeResults: sqliteDiagnostics.tableCounts['copilot_model_gateway_runtime_probe_results'],
        runtimeProbeOnlyRecords: sqliteProbeOnlyRecords.length,
        runtimeProbeProofRecords: sqliteRuntimeProbeProofRecords.length,
    },
    redaction: {
        ok: catalogRedaction.ok && sqliteRedaction.ok,
        envSecretCandidateCount: secretAuditValues.length,
        catalog: {
            ok: catalogRedaction.ok,
            leakCount: catalogRedaction.leakCount,
            scannedStringCount: catalogRedaction.scannedStringCount,
        },
        sqlite: {
            ok: sqliteRedaction.ok,
            leakCount: sqliteRedaction.leakCount,
            scannedStringCount: sqliteRedaction.scannedStringCount,
            tableCount: sqliteRedaction.tableCount,
            maxRowsPerTable: sqliteRedactionMaxRowsPerTable,
        },
    },
    selection: {
        allowProbe: {
            ok: allowProbeSelection.ok,
            selected: allowProbeSelection.summary.selectedProfileCount,
            profiles: allowProbeSelection.summary.profileCount,
            providers: allowProbeSelection.summary.selectedProviders,
            supplyWarnings: allowProbeSupplyWarnings,
            localProviderOptIn: localProviderOptIn.allowProbe,
        },
        strictAccess: {
            ok: strictAccessSelection.ok,
            selected: strictAccessSelection.summary.selectedProfileCount,
            profiles: strictAccessSelection.summary.profileCount,
            providers: strictAccessSelection.summary.selectedProviders,
            dispositions: strictSelectedDispositions,
            supplyWarnings: strictAccessSupplyWarnings,
            localProviderOptIn: localProviderOptIn.strictAccess,
        },
        effectiveStrict: {
            ok: effectiveStrictSelection.ok,
            selected: effectiveStrictSelection.summary.selectedProfileCount,
            profiles: effectiveStrictSelection.summary.profileCount,
            providers: effectiveStrictSelection.summary.selectedProviders,
            dispositions: effectiveSelectedDispositions,
            supplyWarnings: effectiveStrictSupplyWarnings,
            localProviderOptIn: localProviderOptIn.effectiveStrict,
            healthRecords: healthRecords.length,
            fileHealthRecords: fileHealthRecords.length,
            sqliteHealthRecords: sqliteHealthRecords.length,
            sqliteRuntimeError,
            runtimeAccountOverlays: runtimeAccountOverlays.length,
            runtimeAccountOverlaySummary,
            eligibilityDecisions: effectiveEligibility.decisions.length,
            runtimeOverlayDecisions: runtimeOverlayDecisions.length,
        },
        postRuntimeEffective: {
            ok: postRuntimeEffectiveSelection.ok,
            selected: postRuntimeEffectiveSelection.summary.selectedProfileCount,
            profiles: postRuntimeEffectiveSelection.summary.profileCount,
            providers: postRuntimeEffectiveSelection.summary.selectedProviders,
            dispositions: postRuntimeSelectedDispositions,
            supplyWarnings: postRuntimeEffectiveSupplyWarnings,
            localProviderOptIn: localProviderOptIn.postRuntimeEffective,
            healthRecordMatches: postRuntimeEffectiveSelection.summary.healthRecordCount,
            runtimeHealthProofs: postRuntimeEffectiveSelection.summary.runtimeHealthProofCount,
            runtimeAgentProofs: postRuntimeEffectiveSelection.summary.runtimeAgentProbeProofCount,
            runtimeProbeProofs: postRuntimeEffectiveSelection.summary.runtimeProbeProofCount,
            healthRecords: healthRecords.length,
        },
        runtimeSelectorPlan: {
            ok: runtimeSelectorPlan.ok,
            ready: runtimeSelectorPlan.ready,
            mode: runtimeSelectorPlan.mode,
            selected: runtimeSelectorPlan.summary.selectedProfileCount,
            profiles: runtimeSelectorPlan.summary.profileCount,
            blocked: runtimeSelectorPlan.summary.blockedProfileCount,
            accountAccessBlocked: runtimeSelectorPlan.summary.accountAccessBlockedCount ?? 0,
            runtimeProofSelected: runtimeSelectorPlan.summary.runtimeProofSelectedCount,
            runtimeEnvReady: runtimeSelectorPlan.summary.runtimeEnvReadyCount,
            runtimeEnvBlocked: runtimeSelectorPlan.summary.runtimeEnvBlockedCount,
        },
        terminalLiveRuntimeSelectorPlan: {
            ok: terminalLiveRuntimeSelectorPlan.ok,
            ready: terminalLiveRuntimeSelectorPlan.ready,
            mode: terminalLiveRuntimeSelectorPlan.mode,
            profiles: TERMINAL_LIVE_ROUTE_PROFILES,
            preferredProbeKinds: TERMINAL_LIVE_PREFERRED_PROBE_KINDS,
            blockFailedProbeKinds: TERMINAL_LIVE_BLOCK_FAILED_PROBE_KINDS,
            requireAgentProbeProfiles: [...TERMINAL_LIVE_REQUIRE_AGENT_PROBE_PROFILES],
            temporaryFailureCooldownMs: TERMINAL_LIVE_TEMPORARY_FAILURE_COOLDOWN_MS,
            selected: terminalLiveRuntimeSelectorPlan.summary.selectedProfileCount,
            blocked: terminalLiveRuntimeSelectorPlan.summary.blockedProfileCount,
            accountAccessBlocked: terminalLiveRuntimeSelectorPlan.summary.accountAccessBlockedCount ?? 0,
            runtimeProofSelected: terminalLiveRuntimeSelectorPlan.summary.runtimeProofSelectedCount,
            runtimeEnvReady: terminalLiveRuntimeSelectorPlan.summary.runtimeEnvReadyCount,
            runtimeEnvBlocked: terminalLiveRuntimeSelectorPlan.summary.runtimeEnvBlockedCount,
            runtimeHealthBlocked: terminalLiveRuntimeSelectorPlan.summary.runtimeHealthBlockedCount,
            runtimeProbeBlocked: terminalLiveRuntimeSelectorPlan.summary.runtimeProbeBlockedCount,
            selectedRoutes: terminalLiveRuntimeSelectorPlan.routes.map(summarizeTerminalLiveRoute),
        },
    },
    livePlan: {
        executeNow: false,
        commands,
    },
};
    return summary;
}

const directCliEntry = process.argv[1];
const isDirectCli =
    typeof directCliEntry === 'string' && path.resolve(directCliEntry) === path.resolve(fileURLToPath(import.meta.url));
if (isDirectCli) {
    if (argSet.has('--help') || argSet.has('-h')) {
        process.stdout.write(`Usage: node scripts/model-gateway/commands/model-gateway-live-readiness.mjs [--json] [--fail] [--fail-on-supply-warning] [--sqlite-runtime-health] [--redaction-max-rows-per-table N] [--deep-redaction]\n\nCheck whether the model-gateway metadata database is ready for terminal llm-b live tests.\nThis does not start the terminal, execute providers, run models or run runtime probes.\n`);
    } else {
        const json = argSet.has('--json');
        const fail = argSet.has('--fail');
        if (json) {
            setDbLogger((level, message) => {
                if (level === 'WARN' || level === 'ERROR' || level === 'FATAL') {
                    process.stderr.write(`[db][${level}] ${message}\n`);
                }
            });
        }
        const sqliteRedactionMaxRowsPerTable =
            argSet.has('--deep-redaction') || argSet.has('--full-redaction')
                ? DEEP_SQLITE_REDACTION_MAX_ROWS_PER_TABLE
                : readPositiveInteger(
                      ['--redaction-max-rows-per-table', '--sqlite-redaction-max-rows-per-table'],
                      DEFAULT_SQLITE_REDACTION_MAX_ROWS_PER_TABLE,
                  );
        const summary = await buildModelGatewayLiveReadiness({
            includeSqliteRuntimeHealth: argSet.has('--sqlite-runtime-health'),
            failOnSupplyWarning: argSet.has('--fail-on-supply-warning'),
            sqliteRedactionMaxRowsPerTable,
        });
        if (json) {
            process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
        } else {
            process.stdout.write(`model-gateway live readiness: ok=${summary['ok'] ? 'yes' : 'no'}\n`);
            for (const check of summary['checks']) {
                process.stdout.write(`  ${check.ok ? 'OK' : 'FAIL'} ${check.id}: ${check.detail}\n`);
            }
            const localProviderOptIn = summary['selection'].effectiveStrict.localProviderOptIn;
            if (localProviderOptIn.hasBlocks) {
                process.stdout.write(`\n${renderModelGatewayLocalProviderOptInGuidance({ profileIds: localProviderOptIn.blockedProfileIds })}\n`);
            }
            process.stdout.write('\nrecommended live order:\n');
            summary['livePlan'].commands.forEach((command, index) => process.stdout.write(`  ${index + 1}. ${command}\n`));
        }
        if (fail && !summary['ok']) process.exitCode = 1;
    }
}
