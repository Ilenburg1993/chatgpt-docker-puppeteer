// @ts-check
/** Retryable runtime composition of provider-backed cross-process publisher and poll consumer. */

import { getInfraSqliteDatabase, getInfraSqliteProviderStatus } from '#copilot/infra/internal/database';
import { randomUUID } from 'node:crypto';
import { readCrossProcessInvalidationConfig } from './config.js';
import { createCrossProcessInvalidationJournal } from './store.js';

/** @typedef {import('./types.js').CrossProcessInvalidationEvent} CrossProcessInvalidationEvent */

/** @type {ReturnType<typeof createCrossProcessInvalidationJournal> | null} */
let runtimeJournal = null;
/** @type {NodeJS.Timeout | null} */
let runtimePollTimer = null;
/** @type {((
          filePath: string,
          event: { recursive: boolean; source: string; sequence: number; createdAtMs: number },
      ) => void)
    | null} */
let runtimeConsumer = null;
let runtimeInitializationErrors = 0;
let runtimeWriteErrors = 0;
let runtimeReadErrors = 0;

function getRuntimeJournal() {
    const config = readCrossProcessInvalidationConfig();
    if (!config.enabled) return null;
    if (runtimeJournal) return runtimeJournal;
    if (!getInfraSqliteProviderStatus().configured) return null;
    try {
        runtimeJournal = createCrossProcessInvalidationJournal({
            db: getInfraSqliteDatabase(),
            processInstance: `${process.pid}-${randomUUID()}`,
            config,
        });
        return runtimeJournal;
    } catch {
        runtimeInitializationErrors += 1;
        return null;
    }
}

/**
 * Best-effort publish. Errors never fail the canonical file mutation or local invalidation.
 *
 * @param {string} filePath
 * @param {CrossProcessInvalidationEvent} [event]
 * @returns {boolean}
 */
export function publishCrossProcessInvalidation(filePath, event = {}) {
    const journal = getRuntimeJournal();
    if (!journal) return false;
    try {
        journal.publish(filePath, event);
        return true;
    } catch {
        runtimeWriteErrors += 1;
        return false;
    }
}

/**
 * Start the singleton consumer. The timer is unref'ed so it never keeps a process alive.
 *
 * @param {(
 *     filePath: string,
 *     event: { recursive: boolean; source: string; sequence: number; createdAtMs: number },
 * ) => void} onInvalidation
 * @returns {() => void}
 */
export function startCrossProcessInvalidationConsumer(onInvalidation) {
    const config = readCrossProcessInvalidationConfig();
    if (!config.enabled) return () => {};
    runtimeConsumer = onInvalidation;
    const journal = getRuntimeJournal();
    if (!journal || runtimePollTimer) return stopCrossProcessInvalidationConsumer;
    runtimePollTimer = setInterval(() => {
        if (!runtimeConsumer) return;
        try {
            journal.poll(runtimeConsumer);
        } catch {
            runtimeReadErrors += 1;
        }
    }, config.pollMs);
    runtimePollTimer.unref?.();
    return stopCrossProcessInvalidationConsumer;
}

export function stopCrossProcessInvalidationConsumer() {
    if (runtimePollTimer) {
        clearInterval(runtimePollTimer);
        runtimePollTimer = null;
    }
    runtimeConsumer = null;
}

export function getCrossProcessInvalidationStats() {
    const config = readCrossProcessInvalidationConfig();
    const base = runtimeJournal?.getStats() ?? {
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
    return {
        ...base,
        initializationErrors: runtimeInitializationErrors,
        writeErrors: Number(base.writeErrors ?? 0) + runtimeWriteErrors,
        readErrors: Number(base.readErrors ?? 0) + runtimeReadErrors,
        fallbackFreshness: 'rich-filesystem-fingerprint',
    };
}

export function resetCrossProcessInvalidationRuntimeForTest() {
    stopCrossProcessInvalidationConsumer();
    runtimeJournal = null;
    runtimeInitializationErrors = 0;
    runtimeWriteErrors = 0;
    runtimeReadErrors = 0;
}
