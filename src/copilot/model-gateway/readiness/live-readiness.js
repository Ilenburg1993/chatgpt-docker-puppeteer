// @ts-check
/** Canonical Model Gateway live-readiness application service. */

import { resolveApplicationSqlitePath } from '#copilot/infra/public/composition/database/sqlite/path';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';

import {
    DEFAULT_MODEL_GATEWAY_CATALOG_PATH,
    JsonModelGatewayCatalogStore,
    SqliteModelGatewayCatalogStore,
    auditModelGatewayCatalogSnapshotIntegrity,
    auditPreparedModelGatewayPostRuntimeSelection,
    auditPreparedModelGatewayPreRuntimeSelection,
    buildModelGatewayRuntimeSelectorPlan,
    collectModelGatewaySecretAuditEnvValues,
    compareModelGatewayCatalogSnapshotToStructuralParityProjection,
    compareModelGatewaySelectionAudits,
    createEnvSecretRegistry,
    createGatewayRuntimeHealthIndex,
    deriveModelGatewayRuntimeAccountOverlaysFromHealth,
    evaluateModelGatewayCatalogEligibility,
    filterModelGatewayRuntimeEligibilityOverlayDecisions,
    listByokProviderModelHealth,
    mergeByokProviderHealthRecords,
    prepareModelGatewayCatalogRoutingSnapshot,
    resolveModelGatewaySelectionPolicy,
    summarizeModelGatewayLocalProviderOptInBlocks,
    summarizeModelGatewayRuntimeAccountOverlays,
} from '../index.js';

const DEFAULT_LIVE_RUNNER_RELATIVE_PATH = 'scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs';
const DEFAULT_REDACTION_WORKER_RELATIVE_PATH = 'scripts/model-gateway/commands/model-gateway-live-redaction-worker.mjs';
const TERMINAL_LIVE_ROUTE_PROFILES = Object.freeze(['repo_agent', 'code', 'tool_agent']);
const TERMINAL_LIVE_PREFERRED_PROBE_KINDS = Object.freeze(['live_tool_protocol', 'live_ask_user']);
const TERMINAL_LIVE_BLOCK_FAILED_PROBE_KINDS = Object.freeze([...TERMINAL_LIVE_PREFERRED_PROBE_KINDS, 'live_turn']);
/** @type {readonly string[]} */
const TERMINAL_LIVE_REQUIRE_AGENT_PROBE_PROFILES = Object.freeze([]);
const TERMINAL_LIVE_TEMPORARY_FAILURE_COOLDOWN_MS = 900_000;
// Readiness needs a recent representative sample, not an exhaustive runtime-health replay. Keep this bounded so the
// MCP adapter can request SQLite-backed health without turning a readiness probe into a long-running analytics job.
const SQLITE_RUNTIME_HEALTH_READ_LIMIT = 500;
const DEFAULT_SQLITE_REDACTION_MAX_ROWS_PER_TABLE = 25;
const REDACTION_WORKER_RESOURCE_LIMITS = Object.freeze({
    maxOldGenerationSizeMb: 768,
    maxYoungGenerationSizeMb: 128,
    stackSizeMb: 8,
});

/** @param {'catalog' | 'sqlite'} mode @param {string} code @param {string} message @param {unknown} [cause] */
function redactionWorkerError(mode, code, message, cause) {
    const error = new Error(`redaction worker ${mode} ${message}`, cause === undefined ? undefined : { cause });
    /** @type {Error & { code?: string }} */ (error).code = code;
    return error;
}

function normalizeRedactionWorkerResult(
    /** @type {'catalog' | 'sqlite'} */ mode,
    /** @type {number} */ startedAt,
    /**
     * @type {{
     *     success?: boolean;
     *     audit?: Record<string, unknown>;
     *     error?: string;
     *     durationMs?: number;
     *     sourceSnapshotId?: string;
     *     requestId?: string;
     *     heapStatistics?: Record<string, number>;
     * }}
     */ result,
) {
    if (!result || result.success !== true || !result.audit) {
        throw new Error(result?.error ?? `redaction worker ${mode} returned no audit`);
    }
    return {
        audit: result.audit,
        durationMs: Number((performance.now() - startedAt).toFixed(3)),
        workerDurationMs: Number(result.durationMs ?? 0),
        sourceSnapshotId: typeof result.sourceSnapshotId === 'string' ? result.sourceSnapshotId : null,
        heapStatistics:
            result.heapStatistics && typeof result.heapStatistics === 'object' ? { ...result.heapStatistics } : null,
    };
}

/**
 * Run one fixed redaction audit in an isolated one-shot worker thread. Every readiness owns a finite child lifecycle;
 * no worker or pending-request map survives the call.
 *
 * @param {'catalog' | 'sqlite'} mode
 * @param {number} maxRowsPerTable
 * @param {string} redactionWorkerPath
 * @param {NodeJS.ProcessEnv} env
 * @param {boolean} diagnostics
 */
function runRedactionWorker(mode, maxRowsPerTable, redactionWorkerPath, env, diagnostics) {
    return new Promise((resolvePromise, rejectPromise) => {
        const startedAt = performance.now();
        let settled = false;
        const worker = new Worker(redactionWorkerPath, {
            workerData: { mode, maxRowsPerTable, env, diagnostics },
            name: mode === 'catalog' ? 'mg-redact-cat' : 'mg-redact-sql',
            // Do not inherit outer/MCP ambient authority. The redaction worker receives exactly the readiness projection.
            env: { ...env },
            execArgv: [],
            resourceLimits: REDACTION_WORKER_RESOURCE_LIMITS,
        });
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            void worker.terminate();
            rejectPromise(
                redactionWorkerError(mode, 'ERR_MODEL_GATEWAY_REDACTION_WORKER_TIMEOUT', 'timed out after 30000ms'),
            );
        }, 30_000);
        timer.unref?.();
        const finish = (
            /**
             * @type {{
             *     success?: boolean;
             *     audit?: Record<string, unknown>;
             *     error?: string;
             *     durationMs?: number;
             *     sourceSnapshotId?: string;
             *     heapStatistics?: Record<string, number>;
             * } | null}
             */ result,
            /** @type {unknown} */ error = null,
        ) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (error) {
                const failure = error instanceof Error ? error : new Error(String(error));
                const workerCode = /** @type {Error & { code?: string }} */ (failure).code;
                return rejectPromise(
                    redactionWorkerError(
                        mode,
                        workerCode === 'ERR_WORKER_OUT_OF_MEMORY'
                            ? 'ERR_MODEL_GATEWAY_REDACTION_WORKER_OOM'
                            : 'ERR_MODEL_GATEWAY_REDACTION_WORKER_FAILURE',
                        `failed: ${failure.message}`,
                        failure,
                    ),
                );
            }
            if (!result) {
                return rejectPromise(
                    redactionWorkerError(mode, 'ERR_MODEL_GATEWAY_REDACTION_WORKER_NO_RESULT', 'returned no result'),
                );
            }
            try {
                resolvePromise(normalizeRedactionWorkerResult(mode, startedAt, result));
            } catch (normalizeError) {
                rejectPromise(normalizeError instanceof Error ? normalizeError : new Error(String(normalizeError)));
            }
        };
        worker.once('message', (result) => finish(result));
        worker.once('error', (error) => finish(null, error));
        worker.once('exit', (code) => {
            if (!settled && code !== 0) {
                finish(
                    null,
                    redactionWorkerError(
                        mode,
                        'ERR_MODEL_GATEWAY_REDACTION_WORKER_EXIT',
                        `exited abnormally with code ${String(code)}`,
                    ),
                );
            }
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
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : null;
}

/**
 * @param {unknown} input
 * @param {string | null} proofContextId
 * @param {string} catalogFingerprint
 * @param {{ fingerprint:string; maxRowsPerTable:number }} sqliteFingerprint
 */
function reusableRedactionProof(input, proofContextId, catalogFingerprint, sqliteFingerprint) {
    const proof = optionalRecord(input);
    const catalog = optionalRecord(proof?.['catalog']);
    const sqlite = optionalRecord(proof?.['sqlite']);
    if (!proofContextId) return null;
    if (!proof || proof['schema'] !== 'model-gateway-readiness-redaction-proof' || proof['version'] !== 1) return null;
    if (proof['contextId'] !== proofContextId) return null;
    if (!catalog || !sqlite) return null;
    if (catalog['fingerprint'] !== catalogFingerprint || catalog['mode'] !== 'exhaustive') return null;
    if (sqlite['fingerprint'] !== sqliteFingerprint.fingerprint || sqlite['mode'] !== 'bounded') return null;
    if (Number(sqlite['maxRowsPerTable']) !== sqliteFingerprint.maxRowsPerTable) return null;
    return { proof, catalog, sqlite };
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function optionalNumber(value) {
    const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    return Number.isFinite(number) ? number : 0;
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
 * @param {ReturnType<typeof auditPreparedModelGatewayPreRuntimeSelection>} audit
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
 * @param {ReturnType<typeof auditPreparedModelGatewayPreRuntimeSelection>} audit
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
    return (
        optionalString(normalizedProbe['status']) ??
        (normalizedProbe['ok'] === true ? 'ok' : normalizedProbe['ok'] === false ? 'failed' : null)
    );
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
 * Build the canonical read-only LLM-B / Model Gateway readiness snapshot without writing to stdout or terminating the
 * process. This function is safe to call from the MCP process; CPU-heavy redaction remains isolated in worker threads.
 *
 * @param {{
 *     includeSqliteRuntimeHealth?: boolean;
 *     failOnSupplyWarning?: boolean;
 *     sqliteRedactionMaxRowsPerTable?: number;
 *     workspaceRoot?: string;
 *     liveRunnerPath?: string;
 *     redactionWorkerPath?: string;
 *     env?: NodeJS.ProcessEnv;
 *     redactionProof?: Record<string, unknown> | null;
 *     redactionProofContextId?: string | null;
 *     diagnostics?: boolean;
 * }} [options]
 */
export async function buildModelGatewayLiveReadiness(options = {}) {
    const readinessStartedAt = performance.now();
    /** @type {Record<string, number>} */
    const phaseTimingsMs = {};
    const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
    const env = options.env ?? process.env;
    const liveRunnerPath = options.liveRunnerPath ?? path.join(workspaceRoot, DEFAULT_LIVE_RUNNER_RELATIVE_PATH);
    const redactionWorkerPath =
        options.redactionWorkerPath ?? path.join(workspaceRoot, DEFAULT_REDACTION_WORKER_RELATIVE_PATH);
    const sqlitePath = resolveApplicationSqlitePath(env, workspaceRoot);
    const includeSqliteRuntimeHealth = options.includeSqliteRuntimeHealth === true;
    const failOnSupplyWarning = options.failOnSupplyWarning === true;
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

    const sourceStore = new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH });
    const sqliteStore = new SqliteModelGatewayCatalogStore();
    const [catalogSource, sqliteStructuralParity, sqliteRedactionFingerprint] = await Promise.all([
        timedAsync('sourceSnapshotRead', () => sourceStore.readSnapshotWithContentFingerprint()),
        timedAsync('sqliteStructuralParityRead', () => sqliteStore.readCatalogStructuralParityProjection()),
        timedAsync('sqliteRedactionFingerprint', () =>
            sqliteStore.readStoredPayloadRedactionFingerprint({ maxRowsPerTable: sqliteRedactionMaxRowsPerTable }),
        ),
    ]);
    const sourceSnapshot = catalogSource.snapshot;
    const catalogFingerprint = catalogSource.contentFingerprint;
    const redactionProofContextId = optionalString(options.redactionProofContextId);
    const reusableProof = reusableRedactionProof(
        options.redactionProof,
        redactionProofContextId,
        catalogFingerprint,
        sqliteRedactionFingerprint,
    );
    const redactionWorkersPromise = reusableProof
        ? Promise.resolve({ results: null, error: null })
        : Promise.all([
              runRedactionWorker(
                  'catalog',
                  sqliteRedactionMaxRowsPerTable,
                  redactionWorkerPath,
                  env,
                  options.diagnostics === true,
              ),
              runRedactionWorker(
                  'sqlite',
                  sqliteRedactionMaxRowsPerTable,
                  redactionWorkerPath,
                  env,
                  options.diagnostics === true,
              ),
          ]).then(
              (results) => ({ results, error: null }),
              (error) => ({ results: null, error: error instanceof Error ? error : new Error(String(error)) }),
          );
    const integrity = timedSync('catalogIntegrityAudit', () =>
        auditModelGatewayCatalogSnapshotIntegrity(sourceSnapshot),
    );
    const parity = timedSync('catalogSqliteParity', () =>
        compareModelGatewayCatalogSnapshotToStructuralParityProjection(sourceSnapshot, sqliteStructuralParity),
    );
    const secretAuditValues = timedSync('secretAuditEnvCollection', () => collectModelGatewaySecretAuditEnvValues(env));
    const secretRegistry = createEnvSecretRegistry();
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
    const runtimeHealthIndex = timedSync('runtimeHealthIndexBuild', () =>
        createGatewayRuntimeHealthIndex(healthRecords),
    );
    const sqliteProbeOnlyRecords = sqliteHealthRecords.filter(
        (record) => record?.['runtimeHealthStatus'] === 'probe-only',
    );
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
    const runtimeOverlayDecisions = filterModelGatewayRuntimeEligibilityOverlayDecisions(
        effectiveEligibility.decisions,
    );
    const effectiveSnapshot = {
        ...sourceSnapshot,
        source: 'live-readiness-effective-preview',
        modelEligibilityDecisions: [
            ...(Array.isArray(sourceSnapshot.modelEligibilityDecisions)
                ? sourceSnapshot.modelEligibilityDecisions
                : []),
            ...runtimeOverlayDecisions,
        ],
        modelEligibilityRuns: [
            ...(Array.isArray(sourceSnapshot.modelEligibilityRuns) ? sourceSnapshot.modelEligibilityRuns : []),
            effectiveEligibility.run,
        ],
    };
    phaseTimingsMs['eligibilityEvaluation'] = Number((performance.now() - eligibilityStartedAt).toFixed(3));
    const selectionStartedAt = performance.now();
    const sourcePreparedRouting = timedSync('selectionSourceRoutingPrepare', () =>
        prepareModelGatewayCatalogRoutingSnapshot(sourceSnapshot),
    );
    const effectivePreparedRouting = timedSync('selectionEffectiveRoutingPrepare', () =>
        prepareModelGatewayCatalogRoutingSnapshot(effectiveSnapshot),
    );
    const allowProbeSelection = timedSync('selectionAllowProbeAudit', () =>
        auditPreparedModelGatewayPreRuntimeSelection(sourcePreparedRouting, {
            strict: false,
            secretRegistry,
        }),
    );
    const strictAccessSelection = timedSync('selectionStrictAccessAudit', () =>
        auditPreparedModelGatewayPreRuntimeSelection(sourcePreparedRouting, {
            strict: true,
            secretRegistry,
        }),
    );
    const effectiveStrictSelection = timedSync('selectionEffectiveStrictAudit', () =>
        auditPreparedModelGatewayPreRuntimeSelection(effectivePreparedRouting, {
            strict: true,
            secretRegistry,
        }),
    );
    const postRuntimeEffectiveSelection = timedSync('selectionPostRuntimeAudit', () =>
        auditPreparedModelGatewayPostRuntimeSelection(effectivePreparedRouting, {
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
            env,
        }),
    );
    phaseTimingsMs['terminalLiveBaseSelectionAudit'] = 0;
    const terminalLivePostRuntimeSelection = timedSync('terminalLivePostRuntimeAudit', () =>
        auditPreparedModelGatewayPostRuntimeSelection(effectivePreparedRouting, {
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
            env,
            runtimeHealthRecords: healthRecords,
            runtimeHealthIndex,
            blockFailedProbeKinds: [...TERMINAL_LIVE_BLOCK_FAILED_PROBE_KINDS],
            temporaryFailureCooldownMs: TERMINAL_LIVE_TEMPORARY_FAILURE_COOLDOWN_MS,
        }),
    );
    phaseTimingsMs['selectionAndSelectorPlans'] = Number((performance.now() - selectionStartedAt).toFixed(3));
    const runnerExists = await timedAsync('liveRunnerPresenceCheck', () => fileExists(liveRunnerPath));
    /** @type {Record<string, any>} */
    let catalogRedaction;
    /** @type {Record<string, any>} */
    let sqliteRedaction;
    let redactionProofReused = false;
    let redactionProofGeneratedAt = new Date().toISOString();
    /** @type {{ catalog: Record<string, number> | null; sqlite: Record<string, number> | null } | null} */
    let redactionWorkerDiagnostics = null;
    if (reusableProof) {
        catalogRedaction = reusableProof.catalog;
        sqliteRedaction = reusableProof.sqlite;
        redactionProofReused = true;
        redactionProofGeneratedAt = optionalString(reusableProof.proof['generatedAt']) ?? redactionProofGeneratedAt;
        phaseTimingsMs['catalogRedactionAudit'] = 0;
        phaseTimingsMs['sqliteRedactionAudit'] = 0;
        phaseTimingsMs['catalogRedactionWorkerCore'] = 0;
        phaseTimingsMs['sqliteRedactionWorkerCore'] = 0;
    } else {
        const redactionWorkers = await redactionWorkersPromise;
        if (redactionWorkers.error || !redactionWorkers.results) {
            throw redactionWorkers.error ?? new Error('redaction workers returned no results');
        }
        const [catalogRedactionWorker, sqliteRedactionWorker] = redactionWorkers.results;
        if (!catalogRedactionWorker || !sqliteRedactionWorker)
            throw new Error('redaction worker result pair is incomplete');
        if (catalogRedactionWorker.sourceSnapshotId !== sourceSnapshot.snapshotId) {
            throw new Error(
                `catalog redaction worker snapshot mismatch: expected ${sourceSnapshot.snapshotId}, got ${String(catalogRedactionWorker.sourceSnapshotId)}`,
            );
        }
        catalogRedaction = /** @type {Record<string, any>} */ (catalogRedactionWorker.audit);
        sqliteRedaction = /** @type {Record<string, any>} */ (sqliteRedactionWorker.audit);
        if (catalogRedaction['fingerprint'] !== catalogFingerprint) {
            throw new Error('catalog redaction proof surface changed during audit');
        }
        if (sqliteRedaction['fingerprint'] !== sqliteRedactionFingerprint.fingerprint) {
            throw new Error('SQLite redaction proof surface changed during audit');
        }
        phaseTimingsMs['catalogRedactionAudit'] = catalogRedactionWorker.durationMs;
        phaseTimingsMs['sqliteRedactionAudit'] = sqliteRedactionWorker.durationMs;
        phaseTimingsMs['catalogRedactionWorkerCore'] = catalogRedactionWorker.workerDurationMs;
        phaseTimingsMs['sqliteRedactionWorkerCore'] = sqliteRedactionWorker.workerDurationMs;
        if (options.diagnostics === true) {
            redactionWorkerDiagnostics = {
                catalog: catalogRedactionWorker.heapStatistics,
                sqlite: sqliteRedactionWorker.heapStatistics,
            };
        }
    }
    const redactionProof = {
        schema: 'model-gateway-readiness-redaction-proof',
        version: 1,
        contextId: redactionProofContextId,
        generatedAt: redactionProofGeneratedAt,
        ok: catalogRedaction['ok'] === true && sqliteRedaction['ok'] === true,
        catalog: {
            surface: 'json:catalog',
            mode: 'exhaustive',
            fingerprint: catalogFingerprint,
            payloadBytes: Number(catalogRedaction['payloadBytes'] ?? catalogSource.payloadBytes),
            ok: catalogRedaction['ok'] === true,
            leakCount: Number(catalogRedaction['leakCount'] ?? 0),
            scannedStringCount: Number(catalogRedaction['scannedStringCount'] ?? 0),
        },
        sqlite: {
            surface: 'sqlite:payload_json',
            mode: 'bounded',
            fingerprint: sqliteRedactionFingerprint.fingerprint,
            ok: sqliteRedaction['ok'] === true,
            leakCount: Number(sqliteRedaction['leakCount'] ?? 0),
            scannedStringCount: Number(sqliteRedaction['scannedStringCount'] ?? 0),
            tableCount: sqliteRedactionFingerprint.tableCount,
            rowCount: sqliteRedactionFingerprint.rowCount,
            payloadBytes: sqliteRedactionFingerprint.payloadBytes,
            maxRowsPerTable: sqliteRedactionFingerprint.maxRowsPerTable,
        },
    };
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
            ok: redactionProof.ok,
            detail: `proof=${redactionProofReused ? 'reused' : 'fresh'}, catalogMode=exhaustive, catalogLeaks=${redactionProof.catalog.leakCount}, sqliteMode=bounded, sqliteLeaks=${redactionProof.sqlite.leakCount}, sqliteRowsPerTable=${redactionProof.sqlite.maxRowsPerTable}`,
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
            ok:
                !failOnSupplyWarning ||
                (effectiveStrictSupplyWarnings.total === 0 && postRuntimeEffectiveSupplyWarnings.total === 0),
            detail: `allow=${allowProbeSupplyWarnings.total}, strict=${strictAccessSupplyWarnings.total}, effective=${effectiveStrictSupplyWarnings.total}, postRuntime=${postRuntimeEffectiveSupplyWarnings.total}`,
        },
        {
            id: 'runtime_not_promoted',
            ok: strictAccessSelection.profiles.every(
                (profile) => optionalNumber(profile.decisionLayers['runtimeProbeProofCount']) === 0,
            ),
            detail: 'runtime proof count remains zero before live tests',
        },
        {
            id: 'runtime_sqlite_observability',
            ok: true,
            detail: `runtimeHealthSource=${includeSqliteRuntimeHealth ? 'sqlite+file' : 'file'}, loadedSqliteHealthRecords=${sqliteHealthRecords.length}`,
        },
        {
            id: 'runtime_sqlite_probe_source',
            ok: true,
            detail: `sqliteHealthRecords=${sqliteHealthRecords.length}, probeOnly=${sqliteProbeOnlyRecords.length}, probeProofRecords=${sqliteRuntimeProbeProofRecords.length}`,
        },
        {
            id: 'live_runner_present',
            ok: runnerExists,
            detail: path.relative(workspaceRoot, liveRunnerPath),
        },
    ];
    const [completedCatalogSource, completedSqliteRedactionFingerprint] = await Promise.all([
        timedAsync('catalogContentFingerprintCompleted', () => sourceStore.readContentFingerprint()),
        timedAsync('sqliteRedactionFingerprintCompleted', () =>
            sqliteStore.readStoredPayloadRedactionFingerprint({ maxRowsPerTable: sqliteRedactionMaxRowsPerTable }),
        ),
    ]);
    if (completedCatalogSource.contentFingerprint !== catalogFingerprint) {
        throw new Error('catalog redaction source changed during readiness build');
    }
    if (
        completedSqliteRedactionFingerprint.fingerprint !== sqliteRedactionFingerprint.fingerprint ||
        completedSqliteRedactionFingerprint.maxRowsPerTable !== sqliteRedactionFingerprint.maxRowsPerTable
    ) {
        throw new Error('SQLite redaction proof surface changed during readiness build');
    }

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
    const slowestPhase =
        Object.entries(phaseTimingsMs)
            .sort((left, right) => right[1] - left[1])
            .map(([name, durationMs]) => ({ name, durationMs }))[0] ?? null;
    const summary = {
        schema: 'model-gateway-live-readiness',
        ok: checks.every((check) => check.ok),
        storePath: sourceStore.filePath,
        sqlitePath,
        snapshotId: sourceSnapshot.snapshotId,
        generatedAt: sourceSnapshot.generatedAt,
        timing: {
            totalMs: readinessTotalMs,
            phasesMs: phaseTimingsMs,
            slowestPhase,
        },
        ...(options.diagnostics === true
            ? {
                  diagnostics: {
                      redactionWorkers: redactionWorkerDiagnostics,
                  },
              }
            : {}),
        checks,
        integrity: {
            ok: integrity.ok,
            redactedIdentityCount: integrity.redactedIdentityCount,
        },
        sqlite: {
            parityOk: parity.ok,
            countMismatches: parity.countMismatches,
            keyMismatches: parity.keyMismatches,
            runtimeHealthReadLimit: SQLITE_RUNTIME_HEALTH_READ_LIMIT,
            runtimeHealthSource: includeSqliteRuntimeHealth ? 'sqlite+file' : 'file',
            loadedSqliteHealthRecords: sqliteHealthRecords.length,
            runtimeProbeOnlyRecords: sqliteProbeOnlyRecords.length,
            runtimeProbeProofRecords: sqliteRuntimeProbeProofRecords.length,
        },
        redaction: {
            ok: redactionProof.ok,
            proofReused: redactionProofReused,
            proof: redactionProof,
            envSecretCandidateCount: secretAuditValues.length,
            catalog: {
                surface: redactionProof.catalog.surface,
                mode: redactionProof.catalog.mode,
                fingerprint: redactionProof.catalog.fingerprint,
                ok: redactionProof.catalog.ok,
                leakCount: redactionProof.catalog.leakCount,
                scannedStringCount: redactionProof.catalog.scannedStringCount,
            },
            sqlite: {
                surface: redactionProof.sqlite.surface,
                mode: redactionProof.sqlite.mode,
                fingerprint: redactionProof.sqlite.fingerprint,
                ok: redactionProof.sqlite.ok,
                leakCount: redactionProof.sqlite.leakCount,
                scannedStringCount: redactionProof.sqlite.scannedStringCount,
                tableCount: redactionProof.sqlite.tableCount,
                rowCount: redactionProof.sqlite.rowCount,
                payloadBytes: redactionProof.sqlite.payloadBytes,
                maxRowsPerTable: redactionProof.sqlite.maxRowsPerTable,
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
