// @ts-check
/**
 * Bus síncrono e best-effort para invalidações derivadas de mutações de I/O.
 *
 * @module copilot/infra/io/invalidation/bus
 */

import { invalidateIoPathPolicyCache } from '#copilot/core';
import {
    getCrossProcessInvalidationStats,
    publishCrossProcessInvalidation,
    resetCrossProcessInvalidationRuntimeForTest,
    startCrossProcessInvalidationConsumer,
} from './cross-process-journal.js';
import { normalizeIoInvalidationEvent } from './events.js';

/**
 * @typedef {import('./events.js').IoInvalidationEvent} IoInvalidationEvent
 */

/** @type {((filePath: string, event: ReturnType<typeof normalizeIoInvalidationEvent>) => void)[]} */
const _hooks = [];

const isTestRuntime =
    process.env['VITEST'] === 'true' || process.env['NODE_ENV'] === 'test' || process.env['NODE_ENV'] === 'testing';
const INVALIDATION_DEBOUNCE_MS = Number(process.env['IO_INVALIDATION_DEBOUNCE_MS'] ?? (isTestRuntime ? 0 : 50));

/** @type {Map<string, ReturnType<typeof normalizeIoInvalidationEvent>>} */
const _pendingInvalidations = new Map();
/** @type {Map<string, { source: string; atMs: number }>} */
const _recentInvalidations = new Map();
const MAX_RECENT_INVALIDATIONS = 2048;
const _stats = {
    localDispatches: 0,
    replicationQueued: 0,
    replicationCoalesced: 0,
    replicationFlushes: 0,
    replicationPublished: 0,
};

/** @type {NodeJS.Timeout | null} */
let _debounceTimer = null;
let _shutdownHookInstalled = false;
let _crossProcessConsumerStarted = false;

/**
 * @param {ReturnType<typeof normalizeIoInvalidationEvent> | undefined} previous
 * @param {ReturnType<typeof normalizeIoInvalidationEvent>} next
 * @returns {ReturnType<typeof normalizeIoInvalidationEvent>}
 */
function mergeInvalidationEvent(previous, next) {
    if (!previous) return next;
    return {
        ...next,
        recursive: Boolean(previous.recursive || next.recursive),
    };
}

/**
 * Despacha coerência no processo atual imediatamente. O journal cross-process é deliberadamente separado deste plano:
 * consumidores locais (parser, scopes, line offsets, índice) não devem observar uma janela stale depois que uma mutação
 * canônica já retornou, enquanto a replicação SQLite pode ser coalescida fora do caminho crítico.
 *
 * @param {string} filePath
 * @param {ReturnType<typeof normalizeIoInvalidationEvent>} normalized
 */
function dispatchLocalInvalidation(filePath, normalized) {
    _stats.localDispatches += 1;
    try {
        invalidateIoPathPolicyCache(filePath, { recursive: normalized.recursive });
    } catch {
        /* policy-cache invalidation também é best-effort */
    }
    _recentInvalidations.delete(filePath);
    _recentInvalidations.set(filePath, { source: normalized.source, atMs: Date.now() });
    while (_recentInvalidations.size > MAX_RECENT_INVALIDATIONS) {
        const oldest = _recentInvalidations.keys().next().value;
        if (typeof oldest !== 'string') break;
        _recentInvalidations.delete(oldest);
    }
    for (const hook of [..._hooks]) {
        try {
            hook(filePath, normalized);
        } catch {
            /* hooks de invalidação não devem derrubar a mutação canônica */
        }
    }
}

/**
 * @param {string} filePath
 * @param {ReturnType<typeof normalizeIoInvalidationEvent>} normalized
 */
function publishReplication(filePath, normalized) {
    if (publishCrossProcessInvalidation(filePath, normalized)) _stats.replicationPublished += 1;
}

function ensureCrossProcessConsumer() {
    if (_crossProcessConsumerStarted) return;
    _crossProcessConsumerStarted = true;
    startCrossProcessInvalidationConsumer((filePath, event) => {
        dispatchLocalInvalidation(filePath, normalizeIoInvalidationEvent(event));
    });
}

/**
 * Força flush apenas da fila de replicação cross-process. A invalidação local já ocorreu de forma síncrona em
 * `publishIoInvalidation`; portanto este flush nunca repete hooks nem reabre uma janela de trabalho derivado
 * duplicado.
 *
 * @returns {void}
 */
export function flushIoInvalidationQueue() {
    if (_debounceTimer) {
        clearTimeout(_debounceTimer);
        _debounceTimer = null;
    }
    if (_pendingInvalidations.size === 0) return;
    const batch = [..._pendingInvalidations.entries()];
    _pendingInvalidations.clear();
    _stats.replicationFlushes += 1;
    for (const [filePath, normalized] of batch) publishReplication(filePath, normalized);
}

function ensureShutdownFlushHook() {
    if (_shutdownHookInstalled) return;
    _shutdownHookInstalled = true;
    process.once('beforeExit', () => {
        flushIoInvalidationQueue();
    });
}

/**
 * @param {(filePath: string, event: ReturnType<typeof normalizeIoInvalidationEvent>) => void} hook
 * @returns {() => void}
 */
export function registerIoInvalidationHook(hook) {
    ensureCrossProcessConsumer();
    _hooks.push(hook);
    return () => {
        const index = _hooks.indexOf(hook);
        if (index !== -1) _hooks.splice(index, 1);
    };
}

/**
 * @param {string} filePath
 * @param {IoInvalidationEvent} [event]
 */
export function publishIoInvalidation(filePath, event = {}) {
    ensureShutdownFlushHook();
    ensureCrossProcessConsumer();
    const normalized = normalizeIoInvalidationEvent(event);

    // Local coherence is synchronous by design; only cross-process replication is debounced.
    dispatchLocalInvalidation(filePath, normalized);
    if (!(INVALIDATION_DEBOUNCE_MS > 0)) {
        publishReplication(filePath, normalized);
        return;
    }

    const previous = _pendingInvalidations.get(filePath);
    if (previous) _stats.replicationCoalesced += 1;
    else _stats.replicationQueued += 1;
    _pendingInvalidations.set(filePath, mergeInvalidationEvent(previous, normalized));

    if (_debounceTimer) return;
    _debounceTimer = setTimeout(() => {
        flushIoInvalidationQueue();
    }, INVALIDATION_DEBOUNCE_MS);
    _debounceTimer.unref?.();
}

/**
 * Última invalidation despachada para um path. Usado apenas para deduplicar hints best-effort de fs.watch; não é
 * evidence de freshness nem substitui fingerprint/journal.
 *
 * @param {string} filePath
 */
export function getRecentIoInvalidation(filePath) {
    return _recentInvalidations.get(filePath) ?? null;
}

/**
 * Snapshot compacto da fila local e do journal cross-process.
 */
export function getIoInvalidationBusStats() {
    return {
        hooks: _hooks.length,
        pending: _pendingInvalidations.size,
        pendingReplications: _pendingInvalidations.size,
        debounceMs: INVALIDATION_DEBOUNCE_MS,
        ..._stats,
        crossProcess: getCrossProcessInvalidationStats(),
    };
}

/**
 * Reset utilitário para testes.
 *
 * @returns {void}
 */
export function resetIoInvalidationBusForTest() {
    _hooks.length = 0;
    _pendingInvalidations.clear();
    _recentInvalidations.clear();
    Object.assign(_stats, {
        localDispatches: 0,
        replicationQueued: 0,
        replicationCoalesced: 0,
        replicationFlushes: 0,
        replicationPublished: 0,
    });
    if (_debounceTimer) {
        clearTimeout(_debounceTimer);
        _debounceTimer = null;
    }
    resetCrossProcessInvalidationRuntimeForTest();
    _crossProcessConsumerStarted = false;
}
