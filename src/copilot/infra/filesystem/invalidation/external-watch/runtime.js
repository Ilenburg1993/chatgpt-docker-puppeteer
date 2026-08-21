// @ts-check
/**
 * Best-effort external filesystem coherence plane.
 *
 * The watcher only emits invalidation hints for edits performed outside canonical Copilot writers (editor, Git,
 * auxiliary processes). Correctness never depends on fs.watch: rich fingerprints and the cross-process journal remain
 * authoritative fallbacks.
 *
 * @module copilot/infra/filesystem/invalidation/external-watch/runtime
 */

import { resolve } from 'node:path';
import { getRecentIoInvalidation, publishIoInvalidation } from '../bus/index.js';
import { watchPath } from '../watch/index.js';
import { readIoExternalWatchConfig, resolveIoExternalWatchRuntimeConfig } from './config.js';
import { resolveExternalWatchCandidate } from './filter.js';

/** @type {import('node:fs').FSWatcher | null} */
let externalWatcher = null;
/** @type {NodeJS.Timeout | null} */
let flushTimer = null;
/** @type {string | null} */
let watchedRoot = null;
/** @type {Map<string, number>} */
const pendingPaths = new Map();
/** @type {((filePath: string, event: { recursive: boolean; source: string }) => void) | null} */
let invalidateCallback = null;
/** @type {{ debounceMs: number; maxBatch: number; maxPending: number } | null} */
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

/**
 * @param {string} rootPath
 * @param {{
 *     enabled?: boolean;
 *     debounceMs?: number;
 *     maxBatch?: number;
 *     maxPending?: number;
 *     onInvalidate?: (filePath: string, event: { recursive: boolean; source: string }) => void;
 * }} [options]
 */
export function startIoExternalWatch(rootPath, options = {}) {
    const resolvedRoot = resolve(rootPath);
    const config = resolveIoExternalWatchRuntimeConfig(options);
    if (!config.enabled) return { started: false, reused: false, reason: 'disabled' };
    if (externalWatcher && watchedRoot === resolvedRoot) {
        stats.reuses += 1;
        return { started: true, reused: true, reason: 'already-watching' };
    }
    stopIoExternalWatch();
    watchedRoot = resolvedRoot;
    activeConfig = {
        debounceMs: config.debounceMs,
        maxBatch: config.maxBatch,
        maxPending: config.maxPending,
    };
    invalidateCallback = options.onInvalidate ?? ((filePath, event) => publishIoInvalidation(filePath, event));
    try {
        const watcher = watchPath(
            resolvedRoot,
            { recursive: true, persistent: false, encoding: 'utf8' },
            (_eventType, filename) => {
                handleExternalWatchEvent(filename);
            },
        );
        watcher.on('error', (error) => {
            stats.errors += 1;
            stats.lastError = error.message;
            if (externalWatcher === watcher) {
                externalWatcher = null;
                try {
                    watcher.close();
                } catch {
                    // Best-effort close only.
                }
            }
        });
        externalWatcher = watcher;
        stats.starts += 1;
        return { started: true, reused: false, reason: 'watching' };
    } catch (error) {
        externalWatcher = null;
        stats.errors += 1;
        stats.lastError = error instanceof Error ? error.message : String(error);
        return { started: false, reused: false, reason: 'watch-unavailable', error: stats.lastError };
    }
}

/**
 * @param {string | Buffer | null} filename
 */
function handleExternalWatchEvent(filename) {
    stats.events += 1;
    stats.lastEventAtMs = Date.now();
    if (!filename || !watchedRoot || !activeConfig) {
        stats.nullFilename += 1;
        return;
    }
    const candidate = resolveExternalWatchCandidate(watchedRoot, String(filename));
    if (!candidate) {
        stats.filtered += 1;
        return;
    }
    if (pendingPaths.has(candidate)) {
        stats.coalesced += 1;
        pendingPaths.set(candidate, Date.now());
    } else {
        if (pendingPaths.size >= activeConfig.maxPending) {
            stats.dropped += 1;
            return;
        }
        pendingPaths.set(candidate, Date.now());
        stats.queued += 1;
        stats.highWater = Math.max(stats.highWater, pendingPaths.size);
    }
    armFlush(activeConfig.debounceMs);
}

/** @param {number} delayMs */
function armFlush(delayMs) {
    if (flushTimer || pendingPaths.size === 0) return;
    flushTimer = setTimeout(
        () => {
            flushTimer = null;
            flushIoExternalWatchHints();
        },
        Math.max(0, delayMs),
    );
    flushTimer.unref?.();
}

/**
 * Flush watcher hints into the canonical invalidation bus.
 *
 * @returns {number}
 */
export function flushIoExternalWatchHints() {
    if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
    }
    if (!activeConfig || pendingPaths.size === 0) return 0;
    const batch = [...pendingPaths.entries()].slice(0, activeConfig.maxBatch);
    for (const [filePath] of batch) pendingPaths.delete(filePath);
    for (const [filePath, eventAtMs] of batch) {
        const recent = getRecentIoInvalidation(filePath);
        if (
            recent &&
            recent.source !== 'external-watch' &&
            eventAtMs <= recent.atMs + 25 &&
            Date.now() - recent.atMs <= 500
        ) {
            stats.canonicalSuppressed += 1;
            continue;
        }
        try {
            invalidateCallback?.(filePath, { recursive: false, source: 'external-watch' });
            stats.invalidated += 1;
        } catch (error) {
            stats.errors += 1;
            stats.lastError = error instanceof Error ? error.message : String(error);
        }
    }
    stats.flushes += 1;
    stats.lastFlushAtMs = Date.now();
    if (pendingPaths.size > 0) armFlush(0);
    return batch.length;
}

export function stopIoExternalWatch() {
    if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
    }
    pendingPaths.clear();
    if (externalWatcher) {
        try {
            externalWatcher.close();
        } catch {
            // Best-effort close only.
        }
        externalWatcher = null;
        stats.stops += 1;
    }
    watchedRoot = null;
    activeConfig = null;
    invalidateCallback = null;
}

export function getIoExternalWatchStats() {
    const config = readIoExternalWatchConfig();
    return {
        ...stats,
        enabled: config.enabled,
        watching: Boolean(externalWatcher),
        rootKnown: Boolean(watchedRoot),
        pending: pendingPaths.size,
        debounceMs: activeConfig?.debounceMs ?? config.debounceMs,
        maxBatch: activeConfig?.maxBatch ?? config.maxBatch,
        maxPending: activeConfig?.maxPending ?? config.maxPending,
    };
}

export function resetIoExternalWatchForTest() {
    stopIoExternalWatch();
    Object.assign(stats, {
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
        lastEventAtMs: null,
        lastFlushAtMs: null,
        lastError: null,
    });
}
