// @ts-check
/**
 * Escrita atômica baixa, sem locks, cache ou observabilidade.
 *
 * @module copilot/infra/io/fs/write-atomic
 */

import * as fs from 'node:fs/promises';
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
import { createSiblingTempPath } from './temp-path.js';

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
 * }>}
 */
export async function writeAtomicFileUnlocked(filePath, payload, options = {}) {
    const tmpPath = createSiblingTempPath(filePath, 'write');
    const writePayload = toOwnedBuffer(payload);
    const durability = normalizeIoDurability(options.durability);
    const fileFlushRequested = shouldFlushFile(durability);
    const capacityPreflight = await (options.capacityPreflight ?? preflightIoCapacity)(filePath, writePayload.byteLength);
    /** @type {Awaited<ReturnType<typeof syncParentDirectoryBestEffort>> | null} */
    let directorySync = null;
    let tmpCreated = false;
    try {
        if (options.exclusive && typeof fs.link !== 'function') {
            await fs.writeFile(
                filePath,
                writePayload,
                {
                    flag: 'wx',
                    ...(options.mode === undefined ? {} : { mode: options.mode }),
                    ...(fileFlushRequested ? { flush: true } : {}),
                },
            );
            if (shouldSyncDirectory(durability)) directorySync = await syncWriteDirectory(options, filePath);
            return { durability, tempPath: null, fileFlushRequested, directorySync, capacityPreflight };
        }

        await fs.writeFile(tmpPath, writePayload, {
            flag: 'wx',
            ...(options.mode === undefined ? {} : { mode: options.mode }),
            ...(fileFlushRequested ? { flush: true } : {}),
        });
        tmpCreated = true;
        await emitMutationPhase(options, 'temp-written', { filePath, tmpPath, bytes: writePayload.byteLength });

        if (options.exclusive) {
            await emitMutationPhase(options, 'before-publish', { filePath, tmpPath, exclusive: true });
            await fs.link(tmpPath, filePath);
            await emitMutationPhase(options, 'after-publish', { filePath, tmpPath, exclusive: true });
            await fs.unlink(tmpPath);
            tmpCreated = false;
            if (shouldSyncDirectory(durability)) directorySync = await syncWriteDirectory(options, filePath);
            return { durability, tempPath: tmpPath, fileFlushRequested, directorySync, capacityPreflight };
        }

        await emitMutationPhase(options, 'before-publish', { filePath, tmpPath, exclusive: false });
        await fs.rename(tmpPath, filePath);
        tmpCreated = false;
        await emitMutationPhase(options, 'after-publish', { filePath, tmpPath, exclusive: false });
        if (shouldSyncDirectory(durability)) directorySync = await syncWriteDirectory(options, filePath);
        return { durability, tempPath: tmpPath, fileFlushRequested, directorySync, capacityPreflight };
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
