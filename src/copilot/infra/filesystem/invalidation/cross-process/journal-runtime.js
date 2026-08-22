// @ts-check
/** Runtime-owned cross-process invalidation publisher/poll consumer. */
import { randomUUID } from 'node:crypto';
import { readCrossProcessInvalidationConfig } from './config.js';
import { createCrossProcessInvalidationJournal } from './store.js';
/** @typedef {import('./types.js').CrossProcessInvalidationEvent} CrossProcessInvalidationEvent */

/**
 * @param {{
 *   database:import('#copilot/infra/internal/database/port').InfraSqliteProviderReader;
 *   runtimeId?:string;
 *   processInstance?:string;
 *   config?:ReturnType<typeof readCrossProcessInvalidationConfig>;
 * }} options
 */
export function createCrossProcessInvalidationRuntime(options) {
    if (!options?.database) throw new TypeError('createCrossProcessInvalidationRuntime requires { database }.');
    const runtimeId = options.runtimeId ?? 'cross-process-runtime';
    const processInstance = options.processInstance ?? `${process.pid}-${runtimeId}-${randomUUID()}`;
    const config = options.config ?? readCrossProcessInvalidationConfig();
    /** @type {ReturnType<typeof createCrossProcessInvalidationJournal> | null} */ let journal = null;
    /** @type {NodeJS.Timeout | null} */ let pollTimer = null;
    /** @type {((filePath:string,event:{recursive:boolean;source:string;sequence:number;createdAtMs:number})=>void)|null} */
    let consumer = null;
    let activeDatabaseRevision = -1;
    let initializationErrors = 0;
    let writeErrors = 0;
    let readErrors = 0;
    let disposed = false;

    function releaseJournal() {
        journal = null;
        activeDatabaseRevision = -1;
    }
    function getJournal() {
        if (disposed || !config.enabled) return null;
        const status = options.database.status();
        if (!status.configured) {
            releaseJournal();
            return null;
        }
        if (journal && activeDatabaseRevision !== status.revision) releaseJournal();
        if (journal) return journal;
        try {
            journal = createCrossProcessInvalidationJournal({
                db: options.database.get(),
                processInstance,
                config,
            });
            activeDatabaseRevision = status.revision;
            return journal;
        } catch {
            initializationErrors += 1;
            return null;
        }
    }
    /** @param {string} filePath @param {CrossProcessInvalidationEvent} [event] */
    function publish(filePath, event = {}) {
        const active = getJournal();
        if (!active) return false;
        try {
            active.publish(filePath, event);
            return true;
        } catch {
            writeErrors += 1;
            return false;
        }
    }
    function stop() {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
        consumer = null;
    }
    /** @param {(filePath:string,event:{recursive:boolean;source:string;sequence:number;createdAtMs:number})=>void} onInvalidation */
    function start(onInvalidation) {
        if (disposed) return () => {};
        if (!config.enabled) return () => {};
        consumer = onInvalidation;
        const active = getJournal();
        if (!active || pollTimer) return stop;
        pollTimer = setInterval(() => {
            if (!consumer) return;
            try {
                active.poll(consumer);
            } catch {
                readErrors += 1;
            }
        }, config.pollMs);
        pollTimer.unref?.();
        return stop;
    }
    function stats() {
        const base = journal?.getStats() ?? {
            enabled: config.enabled,
            initialized: false,
            processPid: process.pid,
            pollMs: config.pollMs,
            batchMax: config.batchMax,
            maxRows: config.maxRows,
            retentionMs: config.retentionMs,
            published: 0,
            received: 0,
            ownRowsObserved: 0,
            polls: 0,
            emptyPolls: 0,
            gapDetections: 0,
            cleanupRuns: 0,
            cleanupDeleted: 0,
            lastPublishedSequence: null,
            lastSeenSequence: 0,
            lastReceivedAtMs: null,
            lastPropagationMs: null,
            maxPropagationMs: 0,
            publishDurationMsTotal: 0,
            maxPublishDurationMs: 0,
            pollDurationMsTotal: 0,
            maxPollDurationMs: 0,
            averagePublishDurationMs: null,
            averagePollDurationMs: null,
            writeErrors: 0,
            readErrors: 0,
        };
        return Object.freeze({
            ...base,
            runtimeId,
            initializationErrors,
            writeErrors: Number(base.writeErrors ?? 0) + writeErrors,
            readErrors: Number(base.readErrors ?? 0) + readErrors,
            fallbackFreshness: 'rich-filesystem-fingerprint',
            databaseRevision: activeDatabaseRevision,
            polling: pollTimer !== null,
        });
    }
    function reset() {
        stop();
        releaseJournal();
        initializationErrors = 0;
        writeErrors = 0;
        readErrors = 0;
    }
    return Object.freeze({
        runtimeId,
        publish,
        start,
        stop,
        stats,
        reset,
        dispose() {
            if (disposed) return;
            reset();
            disposed = true;
        },
    });
}
