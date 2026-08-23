// @ts-check
/** Low-level atomic publish protocol; caller owns locking/cache/observability. */
import {
    emitMutationPhase,
    preflightIoCapacity,
    prepareSiblingTempPath,
    readBinaryMutationSnapshot,
} from '#copilot/infra/internal/filesystem/transaction';
import { toOwnedBuffer } from '#copilot/infra/internal/platform/buffer';
import {
    normalizeIoDurability,
    shouldFlushFile,
    shouldSyncDirectory,
} from '#copilot/infra/internal/platform/node/filesystem';
import { assertExpectedSha256Digest, markMutationAppliedError } from '#copilot/infra/internal/policy';
import * as fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import {
    assertReplacementTargetExists,
    resolveAtomicWriteMode,
    syncWriteDirectory,
    writeNewFileThroughHandle,
} from './stage.js';
/** @typedef {import('./types.js').AtomicWriteOptions} AtomicWriteOptions */
/** @typedef {import('./types.js').AtomicWriteResult} AtomicWriteResult */

/**
 * Safe low-level entrypoint. Binary inputs are copied once so caller mutation cannot alter an in-flight staged write.
 * Callers that already own a private immutable Buffer can use `writeAtomicOwnedBufferUnlocked` to avoid a second copy.
 *
 * @param {string} filePath
 * @param {string | Buffer | Uint8Array | ArrayBuffer | SharedArrayBuffer | DataView} payload
 * @param {AtomicWriteOptions} [options]
 * @returns {Promise<AtomicWriteResult>}
 */
export async function writeAtomicFileUnlocked(filePath, payload, options = {}) {
    return writeAtomicOwnedBufferUnlocked(filePath, toOwnedBuffer(payload), options);
}

/**
 * Escrita atômica sem lock para Buffer já-owned. O caller deve segurar o lock correto quando necessário e não pode
 * expor/mutar `writePayload` até a conclusão. Esta variante existe para evitar a cópia duplicada do wrapper canônico,
 * que já materializa um Buffer privado antes de adquirir o lock.
 *
 * @param {string} filePath
 * @param {Buffer} writePayload
 * @param {AtomicWriteOptions} [options]
 * @returns {Promise<AtomicWriteResult>}
 */
export async function writeAtomicOwnedBufferUnlocked(filePath, writePayload, options = {}) {
    if (!Buffer.isBuffer(writePayload)) {
        throw new TypeError('writeAtomicOwnedBufferUnlocked requer Buffer privado/owned.');
    }
    const totalStartedAt = performance.now();
    const tempPathStartedAt = performance.now();
    const tmpPath = await prepareSiblingTempPath(filePath, 'write');
    const durability = normalizeIoDurability(options.durability);
    const fileFlushRequested = shouldFlushFile(durability);
    const phaseTimings = {
        tempPathMs: Math.max(0, performance.now() - tempPathStartedAt),
        capacityPreflightMs: 0,
        tempWriteMs: 0,
        modeApplyMs: 0,
        fileSyncMs: 0,
        prePublishCheckMs: 0,
        publishMs: 0,
        directorySyncMs: 0,
        totalMs: 0,
    };
    const capacityStartedAt = performance.now();
    const capacityPreflight = await (options.capacityPreflight ?? preflightIoCapacity)(
        filePath,
        writePayload.byteLength,
    );
    phaseTimings.capacityPreflightMs = Math.max(0, performance.now() - capacityStartedAt);
    const resolvedMode = await resolveAtomicWriteMode(filePath, options);
    /** @type {Awaited<ReturnType<typeof import('#copilot/infra/internal/platform/node/filesystem').syncFileHandleBestEffort>> | null} */
    let fileSync = null;
    /** @type {Awaited<ReturnType<typeof import('#copilot/infra/internal/platform/node/filesystem').syncParentDirectoryBestEffort>> | null} */
    let directorySync = null;
    let tmpCreated = false;
    let published = false;
    const finish = () => {
        phaseTimings.fileSyncMs = Number(fileSync?.durationMs ?? phaseTimings.fileSyncMs);
        phaseTimings.directorySyncMs = Number(directorySync?.durationMs ?? phaseTimings.directorySyncMs);
        phaseTimings.totalMs = Math.max(0, performance.now() - totalStartedAt);
        return { ...phaseTimings };
    };
    try {
        if (options.exclusive && typeof fs.link !== 'function') {
            const staged = await writeNewFileThroughHandle(
                filePath,
                writePayload,
                resolvedMode,
                fileFlushRequested,
                options,
            );
            published = true;
            phaseTimings.tempWriteMs = staged.tempWriteMs;
            phaseTimings.modeApplyMs = staged.modeApplyMs;
            fileSync = staged.fileSync;
            phaseTimings.fileSyncMs = staged.fileSyncMs;
            if (shouldSyncDirectory(durability)) directorySync = await syncWriteDirectory(options, filePath);
            return {
                durability,
                tempPath: null,
                effectiveMode: resolvedMode.mode,
                modeSource: resolvedMode.source,
                fileFlushRequested,
                fileSync,
                directorySync,
                capacityPreflight,
                phaseTimings: finish(),
            };
        }

        const staged = await writeNewFileThroughHandle(
            tmpPath,
            writePayload,
            resolvedMode,
            fileFlushRequested,
            options,
        );
        phaseTimings.tempWriteMs = staged.tempWriteMs;
        phaseTimings.modeApplyMs = staged.modeApplyMs;
        fileSync = staged.fileSync;
        phaseTimings.fileSyncMs = staged.fileSyncMs;
        tmpCreated = true;
        await emitMutationPhase(options, 'temp-written', {
            filePath,
            tmpPath,
            bytes: writePayload.byteLength,
            effectiveMode: resolvedMode.mode,
            modeSource: resolvedMode.source,
            fileSync,
        });

        if (options.exclusive) {
            const publishStartedAt = performance.now();
            await emitMutationPhase(options, 'before-publish', { filePath, tmpPath, exclusive: true });
            await fs.link(tmpPath, filePath);
            published = true;
            await emitMutationPhase(options, 'after-publish', { filePath, tmpPath, exclusive: true });
            await fs.unlink(tmpPath);
            phaseTimings.publishMs = Math.max(0, performance.now() - publishStartedAt);
            tmpCreated = false;
            if (shouldSyncDirectory(durability)) directorySync = await syncWriteDirectory(options, filePath);
            return {
                durability,
                tempPath: tmpPath,
                effectiveMode: resolvedMode.mode,
                modeSource: resolvedMode.source,
                fileFlushRequested,
                fileSync,
                directorySync,
                capacityPreflight,
                phaseTimings: finish(),
            };
        }

        await emitMutationPhase(options, 'before-publish', { filePath, tmpPath, exclusive: false });
        if (options.expectedHash || options.requireExists) {
            const prePublishCheckStartedAt = performance.now();
            if (options.expectedHash) {
                const current = await readBinaryMutationSnapshot(filePath, { snapshotMaxBytes: 0 });
                assertExpectedSha256Digest(current.contentHash, options.expectedHash);
            } else {
                await assertReplacementTargetExists(filePath);
            }
            phaseTimings.prePublishCheckMs = Math.max(0, performance.now() - prePublishCheckStartedAt);
        }
        const publishStartedAt = performance.now();
        await fs.rename(tmpPath, filePath);
        published = true;
        phaseTimings.publishMs = Math.max(0, performance.now() - publishStartedAt);
        tmpCreated = false;
        await emitMutationPhase(options, 'after-publish', { filePath, tmpPath, exclusive: false });
        if (shouldSyncDirectory(durability)) directorySync = await syncWriteDirectory(options, filePath);
        return {
            durability,
            tempPath: tmpPath,
            effectiveMode: resolvedMode.mode,
            modeSource: resolvedMode.source,
            fileFlushRequested,
            fileSync,
            directorySync,
            capacityPreflight,
            phaseTimings: finish(),
        };
    } catch (error) {
        if (tmpCreated) await fs.unlink(tmpPath).catch(() => undefined);
        if (published) {
            throw markMutationAppliedError(error, { phase: 'post-publish', paths: [filePath] });
        }
        throw error;
    }
}
