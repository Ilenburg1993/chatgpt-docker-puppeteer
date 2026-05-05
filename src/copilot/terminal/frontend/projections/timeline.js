// @ts-check
/**
 * Projection family: timeline.
 *
 * Consolida a timeline canônica do terminal a partir do Conversation Hub persistido e do histórico vivo do transporte
 * LLM-A ↔ LLM-B.
 */

import { getWorkspaceContext } from '#copilot/boot';
import { sendRuntimeDialogTurnForRuntime } from '../../../presentation/runtime-dialog.js';
import { readTerminalSessionBinding } from '../gateways/agent-runtime.js';
import { clearTerminalHistoryFeed, readTerminalHistoryFeed, seedTerminalHistoryFeed } from '../gateways/dialog.js';
import { countTerminalHubTurns, readTerminalHubTurns, writeTerminalHubTimelineTurn } from '../gateways/hub.js';
import { readTerminalRuntimeBase } from './shared.js';

/** @typedef {'hub' | 'bridge' | 'mixed' | 'empty'} TerminalTimelineSource */
/** @typedef {'persistent' | 'transport' | 'reconciled' | 'none'} TerminalTimelineAuthority */
/** @typedef {'persistent_only' | 'bridge_only' | 'aligned' | 'bridge_tail' | 'diverged' | 'empty'} TerminalTimelineReconciliation */
/** @typedef {'none' | 'lazy'} TerminalTimelineSyncPolicy */
/** @typedef {'disabled' | 'not_needed' | 'unavailable' | 'scheduled' | 'inflight' | 'synced' | 'failed'} TerminalTimelineSyncStatus */

const TIMELINE_SYNC_CACHE_TTL_MS = 10 * 60 * 1000;
const TIMELINE_SYNC_MAX_CACHE_ENTRIES = 500;
const TIMELINE_SYNC_WRITE_MAX_ATTEMPTS = 3;
const TIMELINE_SYNC_WRITE_RETRY_DELAYS_MS = [0, 25, 100];
const TIMELINE_SYNC_FAILURE_MAX_LIFECYCLE_ATTEMPTS = 3;
const TIMELINE_SYNC_FAILURE_RETRY_DELAYS_MS = [1_000, 5_000, 15_000];

/**
 * @typedef {{
 *     role: string;
 *     rawRole: string;
 *     content: string;
 *     timestamp: number;
 *     persisted: boolean;
 *     origin: 'hub' | 'bridge';
 *     turnId: number | null;
 *     sdkTurnId: string | null;
 * }} TerminalTimelineTurn
 */

/**
 * @typedef {{
 *     policy: TerminalTimelineSyncPolicy;
 *     status: TerminalTimelineSyncStatus;
 *     reason: string | null;
 *     pendingCount: number;
 *     syncedCount: number;
 *     failedCount: number;
 *     key: string | null;
 *     lastError: string | null;
 *     attempts: number;
 *     nextRetryAt: number | null;
 *     cacheExpiresAt: number | null;
 * }} TerminalTimelineSyncState
 */

/**
 * @typedef {{
 *     scheduledTotal: number;
 *     inflightCount: number;
 *     syncedTotal: number;
 *     failedTotal: number;
 *     retryTotal: number;
 *     cacheExpiredTotal: number;
 *     cacheEvictedTotal: number;
 *     turnsScheduledTotal: number;
 *     turnsSyncedTotal: number;
 *     turnsFailedTotal: number;
 *     completedCacheSize: number;
 *     failureCacheSize: number;
 *     lastScheduledAt: number | null;
 *     lastSyncedAt: number | null;
 *     lastFailedAt: number | null;
 *     lastDurationMs: number | null;
 *     lastError: string | null;
 * }} TerminalTimelineSyncTelemetry
 */

/** @type {Map<string, { promise: Promise<number>; startedAt: number; pendingCount: number; attempts: number }>} */
const _timelineSyncInflight = new Map();

/** @type {Map<string, { syncedCount: number; at: number; expiresAt: number }>} */
const _timelineSyncCompleted = new Map();

/**
 * @type {Map<
 *     string,
 *     {
 *         failedCount: number;
 *         at: number;
 *         error: string;
 *         attempts: number;
 *         nextRetryAt: number | null;
 *         expiresAt: number;
 *     }
 * >}
 */
const _timelineSyncFailures = new Map();

/** @type {TerminalTimelineSyncTelemetry} */
const _timelineSyncTelemetry = {
    scheduledTotal: 0,
    inflightCount: 0,
    syncedTotal: 0,
    failedTotal: 0,
    retryTotal: 0,
    cacheExpiredTotal: 0,
    cacheEvictedTotal: 0,
    turnsScheduledTotal: 0,
    turnsSyncedTotal: 0,
    turnsFailedTotal: 0,
    completedCacheSize: 0,
    failureCacheSize: 0,
    lastScheduledAt: null,
    lastSyncedAt: null,
    lastFailedAt: null,
    lastDurationMs: null,
    lastError: null,
};

/**
 * @param {string} name
 * @param {number} [delta=1] Default is `1`
 * @returns {void}
 */
function recordTimelineSyncCounter(name, delta = 1) {
    void import('#copilot/observability')
        .then((mod) => {
            mod.defaultMetrics?.recordCounter?.(`terminal.timeline_sync.${name}`, delta);
        })
        .catch(() => {});
}

/**
 * @param {string} name
 * @param {number} value
 * @returns {void}
 */
function recordTimelineSyncGauge(name, value) {
    void import('#copilot/observability')
        .then((mod) => {
            mod.defaultMetrics?.recordGauge?.(`terminal.timeline_sync.${name}`, value);
        })
        .catch(() => {});
}

/**
 * @returns {void}
 */
function refreshTimelineSyncGauges() {
    _timelineSyncTelemetry.inflightCount = _timelineSyncInflight.size;
    _timelineSyncTelemetry.completedCacheSize = _timelineSyncCompleted.size;
    _timelineSyncTelemetry.failureCacheSize = _timelineSyncFailures.size;
    recordTimelineSyncGauge('inflight', _timelineSyncInflight.size);
    recordTimelineSyncGauge('completed_cache_size', _timelineSyncCompleted.size);
    recordTimelineSyncGauge('failure_cache_size', _timelineSyncFailures.size);
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @template T
 * @param {Map<string, T>} map
 * @returns {void}
 */
function enforceTimelineSyncCacheLimit(map) {
    while (map.size > TIMELINE_SYNC_MAX_CACHE_ENTRIES) {
        const firstKey = map.keys().next().value;
        if (typeof firstKey !== 'string') return;
        map.delete(firstKey);
        _timelineSyncTelemetry.cacheEvictedTotal += 1;
        recordTimelineSyncCounter('cache_evicted');
    }
}

/**
 * @param {number} [now]
 * @returns {void}
 */
function pruneTimelineSyncCaches(now = Date.now()) {
    for (const [key, entry] of _timelineSyncCompleted) {
        if (entry.expiresAt <= now) {
            _timelineSyncCompleted.delete(key);
            _timelineSyncTelemetry.cacheExpiredTotal += 1;
            recordTimelineSyncCounter('cache_expired');
        }
    }
    for (const [key, entry] of _timelineSyncFailures) {
        if (entry.expiresAt <= now) {
            _timelineSyncFailures.delete(key);
            _timelineSyncTelemetry.cacheExpiredTotal += 1;
            recordTimelineSyncCounter('cache_expired');
        }
    }
    enforceTimelineSyncCacheLimit(_timelineSyncCompleted);
    enforceTimelineSyncCacheLimit(_timelineSyncFailures);
    refreshTimelineSyncGauges();
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeTimelineRole(value) {
    const role = typeof value === 'string' ? value : 'assistant';
    if (role === 'llm_b' || role === 'assistant') return 'assistant';
    if (role === 'llm_a') return 'llm_a';
    if (role === 'user') return 'user';
    return role;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function normalizeTimestamp(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * @param {Record<string, unknown>} turn
 * @param {number} index
 * @returns {TerminalTimelineTurn}
 */
function mapHubTimelineTurn(turn, index) {
    const rawRole = typeof turn['role'] === 'string' ? turn['role'] : 'assistant';
    /** @type {Record<string, unknown> | null} */
    let metadata = null;
    if (typeof turn['metadata'] === 'string' && turn['metadata']) {
        try {
            metadata = /** @type {Record<string, unknown>} */ (JSON.parse(turn['metadata']));
        } catch {
            metadata = null;
        }
    }
    const sdkTurnId =
        typeof turn['sdk_turn_id'] === 'string'
            ? turn['sdk_turn_id']
            : typeof metadata?.['sdkTurnId'] === 'string'
              ? metadata['sdkTurnId']
              : null;
    return {
        role: normalizeTimelineRole(rawRole),
        rawRole,
        content: typeof turn['content'] === 'string' ? turn['content'] : String(turn['content'] ?? ''),
        timestamp: normalizeTimestamp(turn['created_at'], Date.now() + index),
        persisted: true,
        origin: 'hub',
        turnId: typeof turn['id'] === 'number' ? turn['id'] : null,
        sdkTurnId,
    };
}

/**
 * @param {{ role: string; content: string; timestamp?: number }} turn
 * @param {number} index
 * @returns {TerminalTimelineTurn}
 */
function mapBridgeTimelineTurn(turn, index) {
    const rawRole = typeof turn.role === 'string' ? turn.role : 'assistant';
    return {
        role: normalizeTimelineRole(rawRole),
        rawRole,
        content: typeof turn.content === 'string' ? turn.content : String(turn.content ?? ''),
        timestamp: normalizeTimestamp(turn.timestamp, Date.now() + index),
        persisted: false,
        origin: 'bridge',
        turnId: null,
        sdkTurnId: null,
    };
}

/**
 * @param {TerminalTimelineTurn} turn
 * @returns {string}
 */
function buildTimelineSignature(turn) {
    return `${turn.role}\u241f${turn.content.trim()}`;
}

/**
 * @param {unknown} value
 * @returns {TerminalTimelineSyncPolicy}
 */
function normalizeTimelineSyncPolicy(value) {
    return value === 'none' ? 'none' : 'lazy';
}

/**
 * @param {TerminalTimelineTurn} turn
 * @returns {'llm_a' | 'llm_b' | 'user'}
 */
function mapTimelineTurnToHubRole(turn) {
    if (turn.role === 'assistant') return 'llm_b';
    if (turn.role === 'llm_a') return 'llm_a';
    if (turn.origin === 'bridge' && turn.role === 'user') return 'llm_a';
    return 'user';
}

/**
 * @param {string} hubSessionId
 * @param {TerminalTimelineTurn[]} turns
 * @returns {string}
 */
function buildTimelineSyncKey(hubSessionId, turns) {
    return `${hubSessionId}:${turns.map(buildTimelineSignature).join('\u241e')}`;
}

/**
 * @param {string} hubSessionId
 * @param {TerminalTimelineTurn[]} turns
 * @param {string | null | undefined} sdkSessionId
 * @returns {Promise<number>}
 */
async function persistBridgeTailToHub(hubSessionId, turns, sdkSessionId) {
    let syncedCount = 0;
    for (const turn of turns) {
        let lastError = null;
        for (let attempt = 1; attempt <= TIMELINE_SYNC_WRITE_MAX_ATTEMPTS; attempt += 1) {
            try {
                await writeTerminalHubTimelineTurn(hubSessionId, {
                    role: mapTimelineTurnToHubRole(turn),
                    content: turn.content,
                    sdkSessionId: sdkSessionId ?? null,
                    metadata: {
                        source: 'terminal.timeline_sync',
                        syncPolicy: 'lazy',
                        originalOrigin: turn.origin,
                        originalRole: turn.rawRole,
                        originalTimestamp: turn.timestamp,
                        signature: buildTimelineSignature(turn),
                    },
                });
                lastError = null;
                break;
            } catch (error) {
                lastError = error;
                if (attempt < TIMELINE_SYNC_WRITE_MAX_ATTEMPTS) {
                    _timelineSyncTelemetry.retryTotal += 1;
                    recordTimelineSyncCounter('retry');
                    await sleep(TIMELINE_SYNC_WRITE_RETRY_DELAYS_MS[attempt - 1] ?? 0);
                }
            }
        }
        if (lastError) {
            throw lastError instanceof Error ? lastError : new Error(String(lastError));
        }
        syncedCount += 1;
    }
    return syncedCount;
}

/**
 * @param {{
 *     policy: TerminalTimelineSyncPolicy;
 *     hubSessionId: string | null;
 *     sdkSessionId: string | null | undefined;
 *     reconciliationStatus: TerminalTimelineReconciliation;
 *     bridgeTurns: TerminalTimelineTurn[];
 *     liveBridgeTail: TerminalTimelineTurn[];
 * }} input
 * @returns {TerminalTimelineSyncState}
 */
function maybeScheduleTimelineSync(input) {
    const { policy, hubSessionId, sdkSessionId, reconciliationStatus, bridgeTurns, liveBridgeTail } = input;
    const now = Date.now();
    pruneTimelineSyncCaches(now);
    if (policy === 'none') {
        return {
            policy,
            status: 'disabled',
            reason: 'policy-none',
            pendingCount: 0,
            syncedCount: 0,
            failedCount: 0,
            key: null,
            lastError: null,
            attempts: 0,
            nextRetryAt: null,
            cacheExpiresAt: null,
        };
    }
    if (!hubSessionId) {
        return {
            policy,
            status: 'unavailable',
            reason: 'no-hub-session',
            pendingCount: 0,
            syncedCount: 0,
            failedCount: 0,
            key: null,
            lastError: null,
            attempts: 0,
            nextRetryAt: null,
            cacheExpiresAt: null,
        };
    }
    const turnsToSync =
        reconciliationStatus === 'bridge_tail'
            ? liveBridgeTail
            : reconciliationStatus === 'bridge_only'
              ? bridgeTurns
              : [];
    if (turnsToSync.length === 0) {
        return {
            policy,
            status: 'not_needed',
            reason: reconciliationStatus,
            pendingCount: 0,
            syncedCount: 0,
            failedCount: 0,
            key: null,
            lastError: null,
            attempts: 0,
            nextRetryAt: null,
            cacheExpiresAt: null,
        };
    }

    const key = buildTimelineSyncKey(hubSessionId, turnsToSync);
    const completed = _timelineSyncCompleted.get(key);
    if (completed) {
        return {
            policy,
            status: 'synced',
            reason: 'already-synced',
            pendingCount: 0,
            syncedCount: completed.syncedCount,
            failedCount: 0,
            key,
            lastError: null,
            attempts: 0,
            nextRetryAt: null,
            cacheExpiresAt: completed.expiresAt,
        };
    }
    const failure = _timelineSyncFailures.get(key);
    if (failure) {
        if (failure.attempts >= TIMELINE_SYNC_FAILURE_MAX_LIFECYCLE_ATTEMPTS || (failure.nextRetryAt ?? 0) > now) {
            return {
                policy,
                status: 'failed',
                reason:
                    failure.attempts >= TIMELINE_SYNC_FAILURE_MAX_LIFECYCLE_ATTEMPTS
                        ? 'max-retries-exhausted'
                        : 'retry-backoff',
                pendingCount: turnsToSync.length,
                syncedCount: 0,
                failedCount: failure.failedCount,
                key,
                lastError: failure.error,
                attempts: failure.attempts,
                nextRetryAt: failure.nextRetryAt,
                cacheExpiresAt: failure.expiresAt,
            };
        }
        _timelineSyncFailures.delete(key);
        _timelineSyncTelemetry.retryTotal += 1;
        recordTimelineSyncCounter('lifecycle_retry');
    }
    const inflight = _timelineSyncInflight.get(key);
    if (inflight) {
        return {
            policy,
            status: 'inflight',
            reason: 'already-inflight',
            pendingCount: inflight.pendingCount,
            syncedCount: 0,
            failedCount: 0,
            key,
            lastError: null,
            attempts: inflight.attempts,
            nextRetryAt: null,
            cacheExpiresAt: null,
        };
    }

    const lifecycleAttempt = (failure?.attempts ?? 0) + 1;
    const startedAt = Date.now();
    const syncPromise = persistBridgeTailToHub(hubSessionId, turnsToSync, sdkSessionId);
    _timelineSyncInflight.set(key, {
        promise: syncPromise,
        startedAt,
        pendingCount: turnsToSync.length,
        attempts: lifecycleAttempt,
    });
    _timelineSyncTelemetry.scheduledTotal += 1;
    _timelineSyncTelemetry.turnsScheduledTotal += turnsToSync.length;
    _timelineSyncTelemetry.lastScheduledAt = startedAt;
    recordTimelineSyncCounter('scheduled');
    recordTimelineSyncCounter('turns_scheduled', turnsToSync.length);
    refreshTimelineSyncGauges();
    void syncPromise
        .then((syncedCount) => {
            const at = Date.now();
            _timelineSyncCompleted.set(key, { syncedCount, at, expiresAt: at + TIMELINE_SYNC_CACHE_TTL_MS });
            _timelineSyncFailures.delete(key);
            _timelineSyncTelemetry.syncedTotal += 1;
            _timelineSyncTelemetry.turnsSyncedTotal += syncedCount;
            _timelineSyncTelemetry.lastSyncedAt = at;
            _timelineSyncTelemetry.lastDurationMs = at - startedAt;
            _timelineSyncTelemetry.lastError = null;
            recordTimelineSyncCounter('synced');
            recordTimelineSyncCounter('turns_synced', syncedCount);
            recordTimelineSyncGauge('last_duration_ms', at - startedAt);
            recordTimelineSyncGauge('last_synced_count', syncedCount);
            pruneTimelineSyncCaches(at);
        })
        .catch((error) => {
            const at = Date.now();
            const attempts = lifecycleAttempt;
            const canRetry = attempts < TIMELINE_SYNC_FAILURE_MAX_LIFECYCLE_ATTEMPTS;
            const retryDelay =
                TIMELINE_SYNC_FAILURE_RETRY_DELAYS_MS[
                    Math.min(attempts - 1, TIMELINE_SYNC_FAILURE_RETRY_DELAYS_MS.length - 1)
                ] ?? 0;
            const errorMessage = error instanceof Error ? error.message : String(error);
            _timelineSyncFailures.set(key, {
                failedCount: turnsToSync.length,
                at,
                error: errorMessage,
                attempts,
                nextRetryAt: canRetry ? at + retryDelay : null,
                expiresAt: at + TIMELINE_SYNC_CACHE_TTL_MS,
            });
            _timelineSyncTelemetry.failedTotal += 1;
            _timelineSyncTelemetry.turnsFailedTotal += turnsToSync.length;
            _timelineSyncTelemetry.lastFailedAt = at;
            _timelineSyncTelemetry.lastDurationMs = at - startedAt;
            _timelineSyncTelemetry.lastError = errorMessage;
            recordTimelineSyncCounter('failed');
            recordTimelineSyncCounter('turns_failed', turnsToSync.length);
            recordTimelineSyncGauge('last_duration_ms', at - startedAt);
            recordTimelineSyncGauge('last_failed_count', turnsToSync.length);
            pruneTimelineSyncCaches(at);
        })
        .finally(() => {
            _timelineSyncInflight.delete(key);
            refreshTimelineSyncGauges();
        });

    return {
        policy,
        status: 'scheduled',
        reason: reconciliationStatus,
        pendingCount: turnsToSync.length,
        syncedCount: 0,
        failedCount: 0,
        key,
        lastError: null,
        attempts: lifecycleAttempt,
        nextRetryAt: null,
        cacheExpiresAt: null,
    };
}

/**
 * @returns {TerminalTimelineSyncTelemetry}
 */
export function readTerminalTimelineSyncTelemetry() {
    pruneTimelineSyncCaches();
    return { ..._timelineSyncTelemetry };
}

/**
 * Retorna o maior overlap em que o final do hub coincide com o início do bridge.
 *
 * @param {TerminalTimelineTurn[]} persistedTurns
 * @param {TerminalTimelineTurn[]} bridgeTurns
 * @returns {number}
 */
function computeHubBridgeOverlap(persistedTurns, bridgeTurns) {
    const maxOverlap = Math.min(persistedTurns.length, bridgeTurns.length);
    for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
        const persistedSlice = persistedTurns.slice(-overlap);
        const bridgeSlice = bridgeTurns.slice(0, overlap);
        const isMatch = persistedSlice.every((turn, index) => {
            const candidate = bridgeSlice[index];
            return candidate ? buildTimelineSignature(turn) === buildTimelineSignature(candidate) : false;
        });
        if (isMatch) return overlap;
    }
    return 0;
}

/**
 * @param {string} hubSessionId
 * @param {number} limitTurns
 * @param {number} newestOffset
 * @returns {{ totalTurns: number; effectiveOffset: number; turns: Record<string, unknown>[] }}
 */
function readLatestTerminalHubTurnsWindow(hubSessionId, limitTurns, newestOffset) {
    const totalTurns = countTerminalHubTurns(hubSessionId);
    const safeLimit = Math.max(1, Math.trunc(limitTurns));
    const safeNewestOffset = Math.max(0, Math.trunc(newestOffset));
    const effectiveOffset = Math.max(totalTurns - safeLimit - safeNewestOffset, 0);
    return {
        totalTurns,
        effectiveOffset,
        turns: readTerminalHubTurns(hubSessionId, { limit: safeLimit, offset: effectiveOffset }),
    };
}

/**
 * @param {{
 *     limitPairs?: number;
 *     runtimeId?: string | null;
 *     newestOffset?: number;
 *     syncPolicy?: TerminalTimelineSyncPolicy;
 * }} [input]
 * @returns {{
 *     requestedRuntimeId: string | null;
 *     runtimeId: string;
 *     runtimeFound: boolean;
 *     usedDefaultRuntimeFallback: boolean;
 *     runtimeFallbackWarning: string | null;
 *     hubSessionId: string | null;
 *     sdkSessionId: string | null;
 *     timelineSource: TerminalTimelineSource;
 *     timelineAuthority: TerminalTimelineAuthority;
 *     reconciliationStatus: TerminalTimelineReconciliation;
 *     totalPersistedTurns: number;
 *     effectiveOffset: number;
 *     bridgeTurnCount: number;
 *     liveBridgeTailCount: number;
 *     overlapCount: number;
 *     sync: TerminalTimelineSyncState;
 *     turns: TerminalTimelineTurn[];
 * }}
 */
export function readTerminalTimelineProjection({
    limitPairs = 10,
    runtimeId = null,
    newestOffset = 0,
    syncPolicy = 'lazy',
} = {}) {
    const base = readTerminalRuntimeBase(runtimeId);
    const binding = readTerminalSessionBinding();
    const hubSessionId = binding.hubSessionId ?? base.binding.hubSessionId ?? null;
    const limitTurns = Math.max(1, Math.trunc(limitPairs * 2));
    const policy = normalizeTimelineSyncPolicy(syncPolicy);

    const bridgeTurns = readTerminalHistoryFeed().slice(-limitTurns).map(mapBridgeTimelineTurn);

    /** @type {TerminalTimelineTurn[]} */
    let persistedTurns = [];
    let totalPersistedTurns = 0;
    let effectiveOffset = 0;
    if (hubSessionId) {
        const persistedWindow = readLatestTerminalHubTurnsWindow(hubSessionId, limitTurns, newestOffset);
        totalPersistedTurns = persistedWindow.totalTurns;
        effectiveOffset = persistedWindow.effectiveOffset;
        persistedTurns = persistedWindow.turns.map(mapHubTimelineTurn);
    }

    /** @type {TerminalTimelineSource} */
    let timelineSource = 'empty';
    /** @type {TerminalTimelineAuthority} */
    let timelineAuthority = 'none';
    /** @type {TerminalTimelineReconciliation} */
    let reconciliationStatus = 'empty';
    /** @type {TerminalTimelineTurn[]} */
    let turns = [];
    let overlapCount = 0;
    let liveBridgeTailCount = 0;
    /** @type {TerminalTimelineTurn[]} */
    let liveBridgeTail = [];

    if (persistedTurns.length > 0) {
        turns = persistedTurns;
        timelineSource = 'hub';
        timelineAuthority = 'persistent';
        reconciliationStatus = 'persistent_only';

        if (bridgeTurns.length > 0) {
            overlapCount = computeHubBridgeOverlap(persistedTurns, bridgeTurns);
            if (overlapCount === bridgeTurns.length) {
                reconciliationStatus = 'aligned';
            } else if (overlapCount > 0) {
                liveBridgeTail = bridgeTurns.slice(overlapCount);
                if (liveBridgeTail.length > 0) {
                    turns = [...persistedTurns, ...liveBridgeTail];
                    timelineSource = 'mixed';
                    timelineAuthority = 'reconciled';
                    reconciliationStatus = 'bridge_tail';
                    liveBridgeTailCount = liveBridgeTail.length;
                } else {
                    reconciliationStatus = 'aligned';
                }
            } else {
                reconciliationStatus = 'diverged';
            }
        }
    } else if (bridgeTurns.length > 0) {
        turns = bridgeTurns;
        timelineSource = 'bridge';
        timelineAuthority = 'transport';
        reconciliationStatus = 'bridge_only';
    }

    const sync = maybeScheduleTimelineSync({
        policy,
        hubSessionId,
        sdkSessionId: binding.sdkSessionId,
        reconciliationStatus,
        bridgeTurns,
        liveBridgeTail,
    });

    return {
        requestedRuntimeId: base.requestedRuntimeId,
        runtimeId: base.runtimeId,
        runtimeFound: base.runtimeFound,
        usedDefaultRuntimeFallback: base.usedDefaultRuntimeFallback,
        runtimeFallbackWarning: base.runtimeFallbackWarning,
        hubSessionId,
        sdkSessionId: binding.sdkSessionId,
        timelineSource,
        timelineAuthority,
        reconciliationStatus,
        totalPersistedTurns,
        effectiveOffset,
        bridgeTurnCount: bridgeTurns.length,
        liveBridgeTailCount,
        overlapCount,
        sync,
        turns,
    };
}

/**
 * @param {number} [limitPairs=10] Default is `10`
 * @param {string | null | undefined} [runtimeId]
 * @returns {TerminalTimelineTurn[]}
 */
export function readTerminalHistoryProjection(limitPairs = 10, runtimeId) {
    return readTerminalTimelineProjection({ limitPairs, runtimeId: runtimeId ?? null }).turns;
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {{
 *     hasHistory: boolean;
 *     totalChars: number;
 *     turnCount: number;
 *     usedTokens: number;
 *     maxTokens: number;
 *     utilization: number;
 *     isRealData: boolean;
 *     workspace: ReturnType<typeof getWorkspaceContext>;
 *     timelineSource: TerminalTimelineSource;
 *     timelineAuthority: TerminalTimelineAuthority;
 *     reconciliationStatus: TerminalTimelineReconciliation;
 *     hasPersistentHistory: boolean;
 *     persistedTurnCount: number;
 *     bridgeTurnCount: number;
 *     liveBridgeTailCount: number;
 *     syncStatus: TerminalTimelineSyncStatus;
 *     syncReason: string | null;
 *     syncPendingCount: number;
 *     syncSyncedCount: number;
 *     syncFailedCount: number;
 *     syncLastError: string | null;
 *     syncAttempts: number;
 *     syncNextRetryAt: number | null;
 * }}
 */
export function readTerminalContextProjection(runtimeId) {
    const base = readTerminalRuntimeBase(runtimeId);
    const timeline = readTerminalTimelineProjection({ limitPairs: 50, runtimeId: runtimeId ?? null });
    const history = timeline.turns;

    let totalChars = 0;
    for (const turn of history) {
        totalChars += turn.content.length;
    }

    const isRealData = Boolean(base.contextWindow);
    const usedTokens = isRealData ? (base.contextWindow?.tokens ?? 0) : Math.ceil(totalChars / 4);
    const maxTokens = isRealData ? (base.contextWindow?.tokenLimit ?? 0) : 128_000;
    const utilization = isRealData ? (base.contextWindow?.utilization ?? 0) : Math.min(usedTokens / maxTokens, 1);

    return {
        hasHistory: history.length > 0,
        totalChars,
        turnCount: history.length,
        usedTokens,
        maxTokens,
        utilization,
        isRealData,
        workspace: getWorkspaceContext(),
        timelineSource: timeline.timelineSource,
        timelineAuthority: timeline.timelineAuthority,
        reconciliationStatus: timeline.reconciliationStatus,
        hasPersistentHistory: timeline.totalPersistedTurns > 0,
        persistedTurnCount: timeline.totalPersistedTurns,
        bridgeTurnCount: timeline.bridgeTurnCount,
        liveBridgeTailCount: timeline.liveBridgeTailCount,
        syncStatus: timeline.sync.status,
        syncReason: timeline.sync.reason,
        syncPendingCount: timeline.sync.pendingCount,
        syncSyncedCount: timeline.sync.syncedCount,
        syncFailedCount: timeline.sync.failedCount,
        syncLastError: timeline.sync.lastError,
        syncAttempts: timeline.sync.attempts,
        syncNextRetryAt: timeline.sync.nextRetryAt,
    };
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<{
 *     ok: boolean;
 *     reply: string | null;
 *     estimatedTokens: number | null;
 *     runtimeId: string | null;
 *     timelineSourceBeforeCompaction: TerminalTimelineSource;
 * }>}
 */
export async function requestTerminalCompactionProjection(runtimeId) {
    const base = readTerminalRuntimeBase(runtimeId);
    const resolvedRuntimeId = base.runtimeId;
    const timeline = readTerminalTimelineProjection({ limitPairs: 50, runtimeId: runtimeId ?? null });
    const reply = await sendRuntimeDialogTurnForRuntime(
        '[SISTEMA] Compacte toda esta conversa em um resumo técnico denso. Preserve: ' +
            'todos os fatos, código, decisões, estados e contexto de arquivos discutidos. ' +
            'Responda APENAS com esse resumo. Após isso, considere o resumo como o novo ' +
            'contexto inicial desta sessão.',
        'user',
        undefined,
        runtimeId,
    );
    if (!reply) {
        return {
            ok: false,
            reply: null,
            estimatedTokens: null,
            runtimeId: resolvedRuntimeId,
            timelineSourceBeforeCompaction: timeline.timelineSource,
        };
    }

    clearTerminalHistoryFeed();
    seedTerminalHistoryFeed('assistant', reply);

    return {
        ok: true,
        reply,
        estimatedTokens: Math.ceil((reply?.length ?? 0) / 4),
        runtimeId: resolvedRuntimeId,
        timelineSourceBeforeCompaction: timeline.timelineSource,
    };
}

/**
 * @returns {void}
 */
export function clearTerminalHistory() {
    clearTerminalHistoryFeed();
}

/**
 * @param {{ hubSessionId?: string | null; limit?: number; offset?: number }} input
 * @returns {{
 *     available: boolean;
 *     reason: string | null;
 *     turns: Record<string, unknown>[];
 *     limit: number;
 *     offset: number;
 *     effectiveOffset: number;
 *     totalTurns: number;
 * }}
 */
export function readTerminalDbHistoryProjection({ hubSessionId = null, limit = 20, offset = 0 }) {
    if (!hubSessionId) {
        return {
            available: false,
            reason: 'no-hub-session',
            turns: [],
            limit,
            offset,
            effectiveOffset: 0,
            totalTurns: 0,
        };
    }

    const window = readLatestTerminalHubTurnsWindow(hubSessionId, limit, offset);
    return {
        available: true,
        reason: null,
        turns: window.turns,
        limit,
        offset,
        effectiveOffset: window.effectiveOffset,
        totalTurns: window.totalTurns,
    };
}
