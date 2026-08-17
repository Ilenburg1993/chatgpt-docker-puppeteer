// @ts-check
/**
 * Bus síncrono e best-effort para invalidações derivadas de mutações de I/O.
 *
 * @module copilot/infra/io/invalidation/bus
 */

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
 * @param {string} filePath
 * @param {ReturnType<typeof normalizeIoInvalidationEvent>} normalized
 * @param {{ replicate?: boolean }} [options]
 */
function dispatchInvalidation(filePath, normalized, options = {}) {
    for (const hook of [..._hooks]) {
        try {
            hook(filePath, normalized);
        } catch {
            /* hooks de invalidação não devem derrubar a mutação canônica */
        }
    }
    if (options.replicate === true) {
        publishCrossProcessInvalidation(filePath, normalized);
    }
}

function ensureCrossProcessConsumer() {
    if (_crossProcessConsumerStarted) return;
    _crossProcessConsumerStarted = true;
    startCrossProcessInvalidationConsumer((filePath, event) => {
        dispatchInvalidation(filePath, normalizeIoInvalidationEvent(event), { replicate: false });
    });
}

/**
 * Força flush da fila de invalidação em memória.
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
    for (const [filePath, normalized] of batch) {
        dispatchInvalidation(filePath, normalized, { replicate: true });
    }
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
    if (!(INVALIDATION_DEBOUNCE_MS > 0)) {
        dispatchInvalidation(filePath, normalized, { replicate: true });
        return;
    }

    const previous = _pendingInvalidations.get(filePath);
    _pendingInvalidations.set(filePath, mergeInvalidationEvent(previous, normalized));

    if (_debounceTimer) return;
    _debounceTimer = setTimeout(() => {
        flushIoInvalidationQueue();
    }, INVALIDATION_DEBOUNCE_MS);
    _debounceTimer.unref?.();
}

/**
 * Snapshot compacto da fila local e do journal cross-process.
 */
export function getIoInvalidationBusStats() {
    return {
        hooks: _hooks.length,
        pending: _pendingInvalidations.size,
        debounceMs: INVALIDATION_DEBOUNCE_MS,
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
    if (_debounceTimer) {
        clearTimeout(_debounceTimer);
        _debounceTimer = null;
    }
    resetCrossProcessInvalidationRuntimeForTest();
    _crossProcessConsumerStarted = false;
}
