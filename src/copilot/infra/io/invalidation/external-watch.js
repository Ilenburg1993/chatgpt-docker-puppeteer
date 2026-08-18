// @ts-check
/**
 * Best-effort external filesystem coherence plane.
 *
 * The watcher only emits invalidation hints for edits performed outside canonical Copilot writers (editor, Git,
 * auxiliary processes). Correctness never depends on fs.watch: rich fingerprints and the cross-process journal remain
 * authoritative fallbacks.
 *
 * @module copilot/infra/io/invalidation/external-watch
 */

import { DEFAULT_BLOCKED_PATH_SEGMENTS } from '#copilot/core';
import { watch } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { getRecentIoInvalidation, publishIoInvalidation } from './bus.js';
import { readEnvNonNegativeInt, readEnvPositiveInt } from '../../shared/env.js';

const DEFAULT_DEBOUNCE_MS = 125;
const DEFAULT_MAX_BATCH = 256;
const DEFAULT_MAX_PENDING = 4096;
const HARD_MAX_BATCH = 1024;
const HARD_MAX_PENDING = 20_000;
const BLOCKED_SEGMENTS = new Set(DEFAULT_BLOCKED_PATH_SEGMENTS.map((segment) => String(segment).toLowerCase()));

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
 * @param {NodeJS.ProcessEnv} [env]
 */
export function readIoExternalWatchConfig(env = process.env) {
    const testRuntime = env['VITEST'] === 'true' || env['NODE_ENV'] === 'test' || env['NODE_ENV'] === 'testing';
    const enabledRaw = String(env['IO_EXTERNAL_WATCH_ENABLED'] ?? (testRuntime ? '0' : '1'))
        .trim()
        .toLowerCase();
    return {
        enabled: !['0', 'false', 'off', 'no'].includes(enabledRaw),
        debounceMs: Math.min(2_000, readEnvNonNegativeInt('IO_EXTERNAL_WATCH_DEBOUNCE_MS', DEFAULT_DEBOUNCE_MS)),
        maxBatch: Math.min(HARD_MAX_BATCH, readEnvPositiveInt('IO_EXTERNAL_WATCH_MAX_BATCH', DEFAULT_MAX_BATCH)),
        maxPending: Math.min(HARD_MAX_PENDING, readEnvPositiveInt('IO_EXTERNAL_WATCH_MAX_PENDING', DEFAULT_MAX_PENDING)),
    };
}

/**
 * @param {string} rootPath
 * @param {{
 *   enabled?: boolean;
 *   debounceMs?: number;
 *   maxBatch?: number;
 *   maxPending?: number;
 *   onInvalidate?: (filePath: string, event: { recursive: boolean; source: string }) => void;
 * }} [options]
 */
export function startIoExternalWatch(rootPath, options = {}) {
    const resolvedRoot = resolve(rootPath);
    const base = readIoExternalWatchConfig();
    const config = {
        enabled: options.enabled ?? base.enabled,
        debounceMs: clampNonNegative(options.debounceMs, base.debounceMs, 2_000),
        maxBatch: clampPositive(options.maxBatch, base.maxBatch, HARD_MAX_BATCH),
        maxPending: clampPositive(options.maxPending, base.maxPending, HARD_MAX_PENDING),
    };
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
        const watcher = watch(resolvedRoot, { recursive: true, persistent: false }, (_eventType, filename) => {
            handleExternalWatchEvent(filename);
        });
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
    const candidate = resolveWatchCandidate(watchedRoot, String(filename));
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
    flushTimer = setTimeout(() => {
        flushTimer = null;
        flushIoExternalWatchHints();
    }, Math.max(0, delayMs));
    flushTimer.unref?.();
}

/**
 * Flush watcher hints into the canonical invalidation bus.
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

/**
 * @param {string} root
 * @param {string} filename
 */
function resolveWatchCandidate(root, filename) {
    const normalized = filename.replace(/\\/gu, '/').replace(/^\.\//u, '');
    if (!normalized || isAbsolute(normalized)) return null;
    const absolute = resolve(root, normalized);
    const rel = relative(root, absolute);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
    const segments = rel.replace(/\\/gu, '/').split('/').filter(Boolean);
    if (segments.some((segment) => segment.startsWith('.') || BLOCKED_SEGMENTS.has(segment.toLowerCase()))) return null;
    return absolute;
}

/** @param {unknown} value @param {number} fallback @param {number} maximum */
function clampPositive(value, fallback, maximum) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? Math.min(maximum, Math.floor(numeric)) : fallback;
}

/** @param {unknown} value @param {number} fallback @param {number} maximum */
function clampNonNegative(value, fallback, maximum) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? Math.min(maximum, Math.floor(numeric)) : fallback;
}
