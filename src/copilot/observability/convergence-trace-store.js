// @ts-check
/**
 * Store em memória para rastrear convergência SDK↔FS por `traceId`.
 *
 * A fonte dos eventos é `SdkOperationMetric`; este store não executa I/O e não participa do caminho crítico de
 * leitura/escrita. Ele apenas agrega eventos já emitidos pela camada SDK/HTTP para observabilidade operacional.
 *
 * @module copilot/observability/convergence-trace-store
 */

import { redactSecretText } from '../core/security/redaction.js';
import { createHistogram } from './metrics-histogram.js';

// ─── Persistência SQLite (opcional, L2) ──────────────────────────────────────

/** @type {import('#copilot/infra/public/database/sqlite').SqliteDatabasePort | null} */
let _persistenceDb = null;

/**
 * Inicializa a persistência SQLite do trace-store de convergência. Deve ser chamado uma vez no bootstrap (após
 * `ensureCopilotDbDir` + `getCopilotDb`). Idempotente — chamadas extras com o mesmo banco são ignoradas.
 *
 * @param {import('#copilot/infra/public/database/sqlite').SqliteDatabasePort} db
 * @returns {void}
 */
export function initConvergenceTracePersistence(db) {
    if (_persistenceDb === db) return;
    _persistenceDb = db;
}

/**
 * Retorna snapshot paginado de eventos persistidos no SQLite para o `traceId` ou operação especificados. Funciona mesmo
 * quando o ring-buffer in-memory foi rotacionado (dados históricos).
 *
 * @param {{
 *     traceId?: string;
 *     operation?: string;
 *     status?: string;
 *     limit?: number;
 *     offsetMs?: number;
 * }} [options]
 * @returns {{
 *     events: {
 *         id: number;
 *         traceId: string;
 *         operation: string;
 *         phase: string;
 *         direction: string | null;
 *         status: string;
 *         bytesRead: number | null;
 *         bytesWritten: number | null;
 *         durationMs: number | null;
 *         errorMsg: string | null;
 *         createdAtMs: number;
 *     }[];
 *     total: number;
 * } | null}
 *   null se a persistência não estiver inicializada
 */
export function getPersistedSnapshot(options = {}) {
    if (!_persistenceDb) return null;
    const db = _persistenceDb;

    const limit = typeof options.limit === 'number' && options.limit > 0 ? Math.floor(options.limit) : 100;
    const conditions = /** @type {string[]} */ ([]);
    const params = /** @type {unknown[]} */ ([]);

    if (options.traceId) {
        conditions.push('trace_id = ?');
        params.push(redactSecretText(options.traceId));
    }
    if (options.operation) {
        conditions.push('operation = ?');
        params.push(redactSecretText(options.operation));
    }
    if (options.status) {
        conditions.push('status = ?');
        params.push(options.status);
    }
    if (options.offsetMs) {
        conditions.push('created_at_ms >= ?');
        params.push(options.offsetMs);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const events = /** @type {any[]} */ (
        db
            .prepare(`SELECT * FROM copilot_convergence_trace_events ${where} ORDER BY created_at_ms DESC LIMIT ?`)
            .all(...params, limit)
    );
    const countRow = /** @type {{ n: number }} */ (
        db.prepare(`SELECT COUNT(*) AS n FROM copilot_convergence_trace_events ${where}`).get(...params)
    );
    return {
        events: events.map((row) => ({
            id: row.id,
            traceId: redactSecretText(row.trace_id),
            operation: redactSecretText(row.operation),
            phase: redactSecretText(row.phase),
            direction: row.direction,
            status: row.status,
            bytesRead: row.bytes_read,
            bytesWritten: row.bytes_written,
            durationMs: row.duration_ms,
            errorMsg: row.error_msg ? redactSecretText(row.error_msg) : null,
            createdAtMs: row.created_at_ms,
        })),
        total: countRow?.n ?? 0,
    };
}

/**
 * @param {string} traceId
 * @param {ConvergenceTraceEvent} event
 * @returns {void}
 */
function persistEvent(traceId, event) {
    if (!_persistenceDb) return;
    try {
        _persistenceDb
            .prepare(
                `INSERT INTO copilot_convergence_trace_events
                    (trace_id, operation, phase, direction, status, bytes_read, bytes_written, duration_ms, error_msg, created_at_ms)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
                traceId,
                event.operation,
                event.phase,
                // bytes split heuristic: direction from localPath/sdkPath presence
                event.localPath && event.sdkPath ? 'sdk->fs' : event.localPath ? 'fs->sdk' : null,
                event.status,
                event.bytes, // stored as bytes_read for convergence events (read+write aggregated)
                null,
                event.durationMs,
                event.reason,
                event.ts,
            );
    } catch {
        // Persistence failure is non-fatal — ring-buffer continues
    }
}

const DEFAULT_MAX_TRACES = 500;
const DEFAULT_MAX_EVENTS_PER_TRACE = 80;
const CONVERGENCE_OPERATION_PREFIX = 'workspace.';

/**
 * @typedef {import('../sdk/types.js').SdkOperationMetric} SdkOperationMetric
 *
 * @typedef {'started' | 'succeeded' | 'failed'} ConvergenceStatus
 *
 * @typedef {object} ConvergenceTraceEvent
 * @property {number} ts
 * @property {string} operation
 * @property {string} phase
 * @property {ConvergenceStatus} status
 * @property {string | null} sessionId
 * @property {number | null} durationMs
 * @property {number | null} bytes
 * @property {string | null} sdkPath
 * @property {string | null} localPath
 * @property {string | null} reason
 *
 * @typedef {object} ConvergencePhaseSnapshot
 * @property {string} phase
 * @property {number} total
 * @property {number} started
 * @property {number} succeeded
 * @property {number} failed
 * @property {number} bytes
 * @property {number | null} lastDurationMs
 * @property {import('./metrics-histogram.js').LatencyHistogram} latency
 *
 * @typedef {object} ConvergenceTraceSnapshot
 * @property {string} traceId
 * @property {string} operation
 * @property {string | null} sessionId
 * @property {'running' | 'succeeded' | 'failed' | 'mixed'} status
 * @property {number} startedAt
 * @property {number} updatedAt
 * @property {number} eventCount
 * @property {number} bytes
 * @property {string | null} sdkPath
 * @property {string | null} localPath
 * @property {boolean | null} overwrite
 * @property {string | null} destinationRoot
 * @property {Record<string, ConvergencePhaseSnapshot>} phases
 * @property {ConvergenceTraceEvent[]} events
 *
 * @typedef {object} ConvergenceOperationSnapshot
 * @property {string} operation
 * @property {number} traces
 * @property {number} running
 * @property {number} succeeded
 * @property {number} failed
 * @property {number} mixed
 * @property {number} bytes
 * @property {Record<string, ConvergencePhaseSnapshot>} phases
 *
 * @typedef {object} ConvergenceTraceStore
 * @property {(metric: SdkOperationMetric) => void} recordMetric
 * @property {(options?: { traceId?: string; operation?: string; limit?: number }) => {
 *     totalTraces: number;
 *     operations: Record<string, ConvergenceOperationSnapshot>;
 *     traces: ConvergenceTraceSnapshot[];
 *     selectedTrace: ConvergenceTraceSnapshot | null;
 *     updatedAt: number | null;
 * }} getSnapshot
 * @property {() => void} clear
 */

/**
 * @typedef {object} MutablePhase
 * @property {string} phase
 * @property {number} total
 * @property {number} started
 * @property {number} succeeded
 * @property {number} failed
 * @property {number} bytes
 * @property {number | null} lastDurationMs
 * @property {ReturnType<typeof createHistogram>} latency
 * @property {number | null} activeStartedAt
 *
 * @typedef {object} MutableTrace
 * @property {string} traceId
 * @property {string} operation
 * @property {string | null} sessionId
 * @property {'running' | 'succeeded' | 'failed' | 'mixed'} status
 * @property {number} startedAt
 * @property {number} updatedAt
 * @property {number} bytes
 * @property {string | null} sdkPath
 * @property {string | null} localPath
 * @property {boolean | null} overwrite
 * @property {string | null} destinationRoot
 * @property {Map<string, MutablePhase>} phases
 * @property {ConvergenceTraceEvent[]} events
 */

/**
 * @param {number} [maxTraces]
 * @param {number} [maxEventsPerTrace]
 * @returns {ConvergenceTraceStore}
 */
export function createConvergenceTraceStore(
    maxTraces = DEFAULT_MAX_TRACES,
    maxEventsPerTrace = DEFAULT_MAX_EVENTS_PER_TRACE,
) {
    /** @type {Map<string, MutableTrace>} */
    const traces = new Map();
    /** @type {string[]} */
    const traceOrder = [];
    /** @type {number | null} */
    let updatedAt = null;

    /**
     * @param {SdkOperationMetric} metric
     * @returns {void}
     */
    function recordMetric(metric) {
        const normalized = normalizeConvergenceMetric(metric);
        if (!normalized) return;

        const { traceId, event, overwrite, destinationRoot } = normalized;
        let trace = traces.get(traceId);
        if (!trace) {
            trace = {
                traceId: redactSecretText(traceId),
                operation: event.operation,
                sessionId: event.sessionId,
                status: event.status === 'failed' ? 'failed' : 'running',
                startedAt: event.ts,
                updatedAt: event.ts,
                bytes: 0,
                sdkPath: event.sdkPath,
                localPath: event.localPath,
                overwrite,
                destinationRoot,
                phases: new Map(),
                events: [],
            };
            traces.set(traceId, trace);
            traceOrder.push(traceId);
            trimOldTraces();
        }

        trace.operation = event.operation;
        trace.sessionId = trace.sessionId ?? event.sessionId;
        trace.updatedAt = event.ts;
        trace.sdkPath = trace.sdkPath ?? event.sdkPath;
        trace.localPath = trace.localPath ?? event.localPath;
        trace.overwrite = trace.overwrite ?? overwrite;
        trace.destinationRoot = trace.destinationRoot ?? destinationRoot;
        if (event.bytes !== null) trace.bytes += event.bytes;

        const phase = getOrCreatePhase(trace, event.phase);
        phase.total += 1;
        phase[event.status] += 1;
        if (event.bytes !== null) phase.bytes += event.bytes;

        if (event.status === 'started') {
            phase.activeStartedAt = event.ts;
        } else {
            const durationMs =
                typeof event.durationMs === 'number'
                    ? event.durationMs
                    : phase.activeStartedAt !== null
                      ? Math.max(0, event.ts - phase.activeStartedAt)
                      : null;
            if (durationMs !== null) {
                phase.lastDurationMs = durationMs;
                phase.latency.record(durationMs);
            }
            phase.activeStartedAt = null;
        }

        trace.events.push(redactConvergenceEvent(event));
        if (trace.events.length > maxEventsPerTrace) trace.events.shift();
        trace.status = resolveTraceStatus(trace);
        updatedAt = event.ts;
        persistEvent(redactSecretText(traceId), redactConvergenceEvent(event));
    }

    /**
     * @param {{ traceId?: string; operation?: string; limit?: number }} [options]
     */
    function getSnapshot(options = {}) {
        const limit =
            typeof options.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0
                ? Math.floor(options.limit)
                : 50;
        const operation = typeof options.operation === 'string' && options.operation ? options.operation : null;
        const traceId = typeof options.traceId === 'string' && options.traceId ? options.traceId : null;

        const allSnapshots = [...traces.values()]
            .map(snapshotTrace)
            .filter(isTraceSnapshot)
            .filter((trace) => (operation ? trace.operation === operation : true))
            .sort((a, b) => b.updatedAt - a.updatedAt);
        const selectedTrace = traceId ? snapshotTrace(traces.get(traceId) ?? null) : null;
        const tracesPage = traceId && selectedTrace ? [selectedTrace] : allSnapshots.slice(0, limit);

        return {
            totalTraces: traces.size,
            operations: buildOperationsSnapshot([...traces.values()]),
            traces: tracesPage,
            selectedTrace,
            updatedAt,
        };
    }

    function clear() {
        traces.clear();
        traceOrder.length = 0;
        updatedAt = null;
    }

    function trimOldTraces() {
        while (traceOrder.length > maxTraces) {
            const oldest = traceOrder.shift();
            if (oldest) traces.delete(oldest);
        }
    }

    return { recordMetric, getSnapshot, clear };
}

/**
 * @param {ConvergenceTraceSnapshot | null} trace
 * @returns {trace is ConvergenceTraceSnapshot}
 */
function isTraceSnapshot(trace) {
    return trace !== null;
}

/**
 * @param {SdkOperationMetric} metric
 * @returns {{
 *     traceId: string;
 *     event: ConvergenceTraceEvent;
 *     overwrite: boolean | null;
 *     destinationRoot: string | null;
 * } | null}
 */
function normalizeConvergenceMetric(metric) {
    if (!metric || typeof metric.operation !== 'string' || !metric.operation.startsWith(CONVERGENCE_OPERATION_PREFIX)) {
        return null;
    }
    const attributes = metric.attributes ?? {};
    const traceId = typeof attributes['traceId'] === 'string' && attributes['traceId'] ? attributes['traceId'] : null;
    const phase = typeof attributes['phase'] === 'string' && attributes['phase'] ? attributes['phase'] : null;
    if (!traceId || !phase) return null;

    const bytes = attributes['bytes'];
    const durationMs = metric.durationMs;
    return {
        traceId,
        overwrite: typeof attributes['overwrite'] === 'boolean' ? attributes['overwrite'] : null,
        destinationRoot:
            typeof attributes['destinationRoot'] === 'string' && attributes['destinationRoot']
                ? attributes['destinationRoot']
                : null,
        event: {
            ts: Date.now(),
            operation: redactSecretText(metric.operation),
            phase: redactSecretText(phase),
            status: metric.status,
            sessionId: metric.sessionId ? redactSecretText(metric.sessionId) : null,
            durationMs:
                typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : null,
            bytes: typeof bytes === 'number' && Number.isFinite(bytes) && bytes >= 0 ? bytes : null,
            sdkPath: typeof attributes['sdkPath'] === 'string' ? redactSecretText(attributes['sdkPath']) : null,
            localPath: typeof attributes['localPath'] === 'string' ? redactSecretText(attributes['localPath']) : null,
            reason: typeof attributes['reason'] === 'string' ? redactSecretText(attributes['reason']) : null,
        },
    };
}

/**
 * @param {ConvergenceTraceEvent} event
 * @returns {ConvergenceTraceEvent}
 */
function redactConvergenceEvent(event) {
    return {
        ...event,
        operation: redactSecretText(event.operation),
        phase: redactSecretText(event.phase),
        sessionId: event.sessionId ? redactSecretText(event.sessionId) : null,
        sdkPath: event.sdkPath ? redactSecretText(event.sdkPath) : null,
        localPath: event.localPath ? redactSecretText(event.localPath) : null,
        reason: event.reason ? redactSecretText(event.reason) : null,
    };
}

/**
 * @param {MutableTrace} trace
 * @param {string} phaseName
 * @returns {MutablePhase}
 */
function getOrCreatePhase(trace, phaseName) {
    let phase = trace.phases.get(phaseName);
    if (!phase) {
        phase = {
            phase: phaseName,
            total: 0,
            started: 0,
            succeeded: 0,
            failed: 0,
            bytes: 0,
            lastDurationMs: null,
            latency: createHistogram(),
            activeStartedAt: null,
        };
        trace.phases.set(phaseName, phase);
    }
    return phase;
}

/**
 * @param {MutableTrace} trace
 * @returns {'running' | 'succeeded' | 'failed' | 'mixed'}
 */
function resolveTraceStatus(trace) {
    const failed = [...trace.phases.values()].some((phase) => phase.failed > 0);
    const succeeded = [...trace.phases.values()].some((phase) => phase.succeeded > 0);
    const running = [...trace.phases.values()].some((phase) => phase.started > phase.succeeded + phase.failed);
    if (running) return failed ? 'mixed' : 'running';
    if (failed && succeeded) return 'mixed';
    if (failed) return 'failed';
    if (succeeded) return 'succeeded';
    return 'running';
}

/**
 * @param {MutableTrace | null} trace
 * @returns {ConvergenceTraceSnapshot | null}
 */
function snapshotTrace(trace) {
    if (!trace) return null;
    return {
        traceId: redactSecretText(trace.traceId),
        operation: redactSecretText(trace.operation),
        sessionId: trace.sessionId ? redactSecretText(trace.sessionId) : null,
        status: trace.status,
        startedAt: trace.startedAt,
        updatedAt: trace.updatedAt,
        eventCount: trace.events.length,
        bytes: trace.bytes,
        sdkPath: trace.sdkPath ? redactSecretText(trace.sdkPath) : null,
        localPath: trace.localPath ? redactSecretText(trace.localPath) : null,
        overwrite: trace.overwrite,
        destinationRoot: trace.destinationRoot ? redactSecretText(trace.destinationRoot) : null,
        phases: Object.fromEntries(
            [...trace.phases.entries()].map(([name, phase]) => [redactSecretText(name), snapshotPhase(phase)]),
        ),
        events: trace.events.map(redactConvergenceEvent),
    };
}

/**
 * @param {MutablePhase} phase
 * @returns {ConvergencePhaseSnapshot}
 */
function snapshotPhase(phase) {
    return {
        phase: redactSecretText(phase.phase),
        total: phase.total,
        started: phase.started,
        succeeded: phase.succeeded,
        failed: phase.failed,
        bytes: phase.bytes,
        lastDurationMs: phase.lastDurationMs,
        latency: phase.latency.snapshot(),
    };
}

/**
 * @param {MutableTrace[]} traces
 * @returns {Record<string, ConvergenceOperationSnapshot>}
 */
function buildOperationsSnapshot(traces) {
    /** @type {Record<string, ConvergenceOperationSnapshot>} */
    const operations = {};
    for (const trace of traces) {
        const op = (operations[trace.operation] ??= {
            operation: trace.operation,
            traces: 0,
            running: 0,
            succeeded: 0,
            failed: 0,
            mixed: 0,
            bytes: 0,
            phases: {},
        });
        op.traces += 1;
        op[trace.status] += 1;
        op.bytes += trace.bytes;
        for (const [name, phase] of trace.phases.entries()) {
            const existing = op.phases[name];
            if (!existing) {
                op.phases[name] = snapshotPhase(phase);
                continue;
            }
            existing.total += phase.total;
            existing.started += phase.started;
            existing.succeeded += phase.succeeded;
            existing.failed += phase.failed;
            existing.bytes += phase.bytes;
            existing.lastDurationMs = phase.lastDurationMs ?? existing.lastDurationMs;
        }
    }
    return operations;
}

export const defaultConvergenceTraceStore = createConvergenceTraceStore();
