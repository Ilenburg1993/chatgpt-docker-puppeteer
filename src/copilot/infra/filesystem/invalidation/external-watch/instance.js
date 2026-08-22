// @ts-check
/**
 * Root-bound external filesystem watcher. All operational state is instance-local.
 *
 * @module copilot/infra/filesystem/invalidation/external-watch/instance
 */

import { resolve } from 'node:path';
import { watchPath } from '../watch/index.js';
import { readIoExternalWatchConfig, resolveIoExternalWatchRuntimeConfig } from './config.js';
import { resolveExternalWatchCandidate } from './filter.js';

/**
 * @param {string} rootPath
 * @param {{ invalidationBus?: ReturnType<typeof import('../bus/index.js').createIoInvalidationBusRuntime>; config?:ReturnType<typeof readIoExternalWatchConfig> }} [runtimeOptions]
 */
export function createIoExternalWatcher(rootPath, runtimeOptions = {}) {
    const root = resolve(rootPath);
    const baseConfig = runtimeOptions.config ?? readIoExternalWatchConfig({});
    /** @type {import('node:fs').FSWatcher | null} */
    let watcher = null;
    /** @type {NodeJS.Timeout | null} */
    let flushTimer = null;
    /** @type {Map<string, number>} */
    const pendingPaths = new Map();
    /** @type {((filePath:string,event:{recursive:boolean;source:string})=>void) | null} */
    let invalidateCallback = null;
    /** @type {{ debounceMs:number; maxBatch:number; maxPending:number } | null} */
    let activeConfig = null;
    const stats = {
        starts: 0,
        reuses: 0,
        stops: 0,
        events: 0,
        queued: 0,
        coalesced: 0,
        canonicalSuppressed: 0,
        filtered: 0,
        nullFilename: 0,
        dropped: 0,
        invalidated: 0,
        errors: 0,
        flushes: 0,
        highWater: 0,
        lastEventAtMs: /** @type {number | null} */ (null),
        lastFlushAtMs: /** @type {number | null} */ (null),
        lastError: /** @type {string | null} */ (null),
    };

    /** @param {keyof typeof stats} field @param {number | string | null} [value] */
    function record(field, value = 1) {
        if (field === 'lastEventAtMs' || field === 'lastFlushAtMs') {
            const numeric = typeof value === 'number' ? value : Date.now();
            stats[field] = numeric;
            return;
        }
        if (field === 'lastError') {
            const message = typeof value === 'string' ? value : null;
            stats.lastError = message;
            return;
        }
        if (field === 'highWater') {
            const numeric = Number(value) || 0;
            stats.highWater = Math.max(stats.highWater, numeric);
            return;
        }
        const numericStats = /** @type {Record<string, number>} */ (/** @type {unknown} */ (stats));
        numericStats[field] = (numericStats[field] ?? 0) + (Number(value) || 0);
    }

    /** @param {number} delayMs */
    function armFlush(delayMs) {
        if (flushTimer || pendingPaths.size === 0) return;
        flushTimer = setTimeout(
            () => {
                flushTimer = null;
                flush();
            },
            Math.max(0, delayMs),
        );
        flushTimer.unref?.();
    }

    /** @param {string | Buffer | null} filename */
    function handleEvent(filename) {
        record('events');
        record('lastEventAtMs', Date.now());
        if (!filename || !activeConfig) {
            record('nullFilename');
            return;
        }
        const candidate = resolveExternalWatchCandidate(root, String(filename));
        if (!candidate) {
            record('filtered');
            return;
        }
        if (pendingPaths.has(candidate)) {
            record('coalesced');
            pendingPaths.set(candidate, Date.now());
        } else {
            if (pendingPaths.size >= activeConfig.maxPending) {
                record('dropped');
                return;
            }
            pendingPaths.set(candidate, Date.now());
            record('queued');
            record('highWater', pendingPaths.size);
        }
        armFlush(activeConfig.debounceMs);
    }

    /** @returns {number} */
    function flush() {
        if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = null;
        }
        if (!activeConfig || pendingPaths.size === 0) return 0;
        const batch = [...pendingPaths.entries()].slice(0, activeConfig.maxBatch);
        for (const [filePath] of batch) pendingPaths.delete(filePath);
        for (const [filePath, eventAtMs] of batch) {
            const recent = runtimeOptions.invalidationBus?.recent(filePath) ?? null;
            if (
                recent &&
                recent.source !== 'external-watch' &&
                eventAtMs <= recent.atMs + 25 &&
                Date.now() - recent.atMs <= 500
            ) {
                record('canonicalSuppressed');
                continue;
            }
            try {
                invalidateCallback?.(filePath, { recursive: false, source: 'external-watch' });
                record('invalidated');
            } catch (error) {
                record('errors');
                record('lastError', error instanceof Error ? error.message : String(error));
            }
        }
        record('flushes');
        record('lastFlushAtMs', Date.now());
        if (pendingPaths.size > 0) armFlush(0);
        return batch.length;
    }

    function stop() {
        if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = null;
        }
        pendingPaths.clear();
        const wasWatching = Boolean(watcher);
        if (watcher) {
            try {
                watcher.close();
            } catch {
                // Best-effort close only.
            }
            watcher = null;
        }
        if (wasWatching) record('stops');
        activeConfig = null;
        invalidateCallback = null;
    }

    /**
     * @param {{ enabled?:boolean; debounceMs?:number; maxBatch?:number; maxPending?:number; onInvalidate?:(filePath:string,event:{recursive:boolean;source:string})=>void }} [options]
     */
    function start(options = {}) {
        const config = resolveIoExternalWatchRuntimeConfig(options, baseConfig);
        if (!config.enabled) return { started: false, reused: false, reason: 'disabled' };
        if (watcher) {
            record('reuses');
            return { started: true, reused: true, reason: 'already-watching' };
        }
        activeConfig = { debounceMs: config.debounceMs, maxBatch: config.maxBatch, maxPending: config.maxPending };
        if (!options.onInvalidate && !runtimeOptions.invalidationBus) {
            throw new TypeError('External watch requires an explicit invalidationBus or onInvalidate callback.');
        }
        invalidateCallback =
            options.onInvalidate ?? ((filePath, event) => runtimeOptions.invalidationBus?.publish(filePath, event));
        try {
            const created = watchPath(
                root,
                { recursive: true, persistent: false, encoding: 'utf8' },
                (_eventType, filename) => handleEvent(filename),
            );
            created.on('error', (error) => {
                record('errors');
                record('lastError', error.message);
                if (watcher === created) {
                    watcher = null;
                    try {
                        created.close();
                    } catch {
                        // Best effort.
                    }
                }
            });
            watcher = created;
            record('starts');
            return { started: true, reused: false, reason: 'watching' };
        } catch (error) {
            watcher = null;
            activeConfig = null;
            invalidateCallback = null;
            record('errors');
            record('lastError', error instanceof Error ? error.message : String(error));
            return { started: false, reused: false, reason: 'watch-unavailable', error: stats.lastError };
        }
    }

    function getStats() {
        const config = baseConfig;
        return Object.freeze({
            ...stats,
            root,
            enabled: activeConfig ? true : config.enabled,
            watching: Boolean(watcher),
            rootKnown: true,
            pending: pendingPaths.size,
            debounceMs: activeConfig?.debounceMs ?? config.debounceMs,
            maxBatch: activeConfig?.maxBatch ?? config.maxBatch,
            maxPending: activeConfig?.maxPending ?? config.maxPending,
        });
    }

    const api = Object.freeze({ root, start, flush, stop, getStats });
    return api;
}
