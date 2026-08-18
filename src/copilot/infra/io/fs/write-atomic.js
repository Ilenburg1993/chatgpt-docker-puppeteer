// @ts-check
/**
 * Escrita atômica baixa, sem locks, cache ou observabilidade.
 *
 * @module copilot/infra/io/fs/write-atomic
 */

import * as fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { assertExpectedSha256Digest } from '../../policy/preconditions.js';
import { toOwnedBuffer } from '../../shared/buffer.js';
import {
    assertSuccessfulSync,
    normalizeIoDurability,
    shouldFlushFile,
    shouldSyncDirectory,
    syncParentDirectoryBestEffort,
} from './durability.js';
import { emitMutationPhase } from './mutation-phase.js';
import { preflightIoCapacity } from './capacity-preflight.js';
import { prepareSiblingTempPath } from './temp-path.js';
import { readBinaryMutationSnapshot } from './snapshot.js';

/**
 * @param {string | Buffer | Uint8Array | ArrayBuffer | SharedArrayBuffer | DataView} content
 * @param {BufferEncoding} [encoding]
 * @returns {Buffer}
 */
export function toWriteBuffer(content, encoding = 'utf8') {
    return toOwnedBuffer(content, encoding);
}

/**
 * @param {string} filePath
 * @param {string | Buffer | Uint8Array | ArrayBuffer | SharedArrayBuffer | DataView} content
 * @param {BufferEncoding} encoding
 * @returns {{ payload: Buffer; bytes: number }}
 */
export function normalizeWritePayload(filePath, content, encoding) {
    void filePath;
    const buf = toWriteBuffer(content, encoding);
    return {
        payload: buf,
        bytes: buf.byteLength,
    };
}

/**
 * Escrita atômica sem lock. O caller deve segurar o lock correto quando necessário.
 *
 * @param {string} filePath
 * @param {string | Buffer | Uint8Array | ArrayBuffer | SharedArrayBuffer | DataView} payload
 * @param {{
 *     mode?: number;
 *     exclusive?: boolean;
 *     expectedHash?: string;
 *     durability?: import('./durability.js').IoDurabilityMode;
 *     onPhase?: (phase: string, details: Record<string, unknown>) => void | Promise<void>;
 *     syncDirectory?: typeof syncParentDirectoryBestEffort;
 *     capacityPreflight?: typeof preflightIoCapacity;
 * }} [options]
 * @returns {Promise<{
 *     durability: import('./durability.js').IoDurabilityMode;
 *     tempPath: string | null;
 *     fileFlushRequested: boolean;
 *     directorySync: Awaited<ReturnType<typeof syncParentDirectoryBestEffort>> | null;
 *     capacityPreflight: Awaited<ReturnType<typeof preflightIoCapacity>>;
 *     phaseTimings: {
 *         tempPathMs: number;
 *         capacityPreflightMs: number;
 *         tempWriteMs: number;
 *         prePublishCheckMs: number;
 *         publishMs: number;
 *         directorySyncMs: number;
 *         totalMs: number;
 *     };
 * }>}
 */
export async function writeAtomicFileUnlocked(filePath, payload, options = {}) {
    const totalStartedAt = performance.now();
    const tempPathStartedAt = performance.now();
    const tmpPath = await prepareSiblingTempPath(filePath, 'write');
    const writePayload = toOwnedBuffer(payload);
    const durability = normalizeIoDurability(options.durability);
    const fileFlushRequested = shouldFlushFile(durability);
    const phaseTimings = {
        tempPathMs: Math.max(0, performance.now() - tempPathStartedAt),
        capacityPreflightMs: 0,
        tempWriteMs: 0,
        prePublishCheckMs: 0,
        publishMs: 0,
        directorySyncMs: 0,
        totalMs: 0,
    };
    const capacityStartedAt = performance.now();
    const capacityPreflight = await (options.capacityPreflight ?? preflightIoCapacity)(filePath, writePayload.byteLength);
    phaseTimings.capacityPreflightMs = Math.max(0, performance.now() - capacityStartedAt);
    /** @type {Awaited<ReturnType<typeof syncParentDirectoryBestEffort>> | null} */
    let directorySync = null;
    let tmpCreated = false;
    const finish = () => {
        phaseTimings.directorySyncMs = Number(directorySync?.durationMs ?? phaseTimings.directorySyncMs);
        phaseTimings.totalMs = Math.max(0, performance.now() - totalStartedAt);
        return { ...phaseTimings };
    };
    try {
        if (options.exclusive && typeof fs.link !== 'function') {
            const directWriteStartedAt = performance.now();
            await fs.writeFile(
                filePath,
                writePayload,
                {
                    flag: 'wx',
                    ...(options.mode === undefined ? {} : { mode: options.mode }),
                    ...(fileFlushRequested ? { flush: true } : {}),
                },
            );
            phaseTimings.tempWriteMs = Math.max(0, performance.now() - directWriteStartedAt);
            if (shouldSyncDirectory(durability)) directorySync = await syncWriteDirectory(options, filePath);
            return { durability, tempPath: null, fileFlushRequested, directorySync, capacityPreflight, phaseTimings: finish() };
        }

        const tempWriteStartedAt = performance.now();
        await fs.writeFile(tmpPath, writePayload, {
            flag: 'wx',
            ...(options.mode === undefined ? {} : { mode: options.mode }),
            ...(fileFlushRequested ? { flush: true } : {}),
        });
        phaseTimings.tempWriteMs = Math.max(0, performance.now() - tempWriteStartedAt);
        tmpCreated = true;
        await emitMutationPhase(options, 'temp-written', { filePath, tmpPath, bytes: writePayload.byteLength });

        if (options.exclusive) {
            const publishStartedAt = performance.now();
            await emitMutationPhase(options, 'before-publish', { filePath, tmpPath, exclusive: true });
            await fs.link(tmpPath, filePath);
            await emitMutationPhase(options, 'after-publish', { filePath, tmpPath, exclusive: true });
            await fs.unlink(tmpPath);
            phaseTimings.publishMs = Math.max(0, performance.now() - publishStartedAt);
            tmpCreated = false;
            if (shouldSyncDirectory(durability)) directorySync = await syncWriteDirectory(options, filePath);
            return { durability, tempPath: tmpPath, fileFlushRequested, directorySync, capacityPreflight, phaseTimings: finish() };
        }

        await emitMutationPhase(options, 'before-publish', { filePath, tmpPath, exclusive: false });
        if (options.expectedHash) {
            const prePublishCheckStartedAt = performance.now();
            const current = await readBinaryMutationSnapshot(filePath, { snapshotMaxBytes: 0 });
            assertExpectedSha256Digest(current.contentHash, options.expectedHash);
            phaseTimings.prePublishCheckMs = Math.max(0, performance.now() - prePublishCheckStartedAt);
        }
        const publishStartedAt = performance.now();
        await fs.rename(tmpPath, filePath);
        phaseTimings.publishMs = Math.max(0, performance.now() - publishStartedAt);
        tmpCreated = false;
        await emitMutationPhase(options, 'after-publish', { filePath, tmpPath, exclusive: false });
        if (shouldSyncDirectory(durability)) directorySync = await syncWriteDirectory(options, filePath);
        return { durability, tempPath: tmpPath, fileFlushRequested, directorySync, capacityPreflight, phaseTimings: finish() };
    } catch (error) {
        if (tmpCreated) {
            try {
                await fs.unlink(tmpPath);
            } catch {
                // best-effort cleanup
            }
        }
        throw error;
    }
}

/**
 * @param {NonNullable<Parameters<typeof writeAtomicFileUnlocked>[2]>} options
 * @param {string} filePath
 */
async function syncWriteDirectory(options, filePath) {
    await emitMutationPhase(options, 'before-destination-directory-sync', { filePath, target: filePath });
    const result = await (options.syncDirectory ?? syncParentDirectoryBestEffort)(filePath);
    await emitMutationPhase(options, 'after-destination-directory-sync', { filePath, target: filePath, ...result });
    assertSuccessfulSync(result, {
        code: 'EDIRECTORYSYNC',
        message: `Falha ao sincronizar diretório da escrita atômica: ${filePath}`,
    });
    return result;
}
