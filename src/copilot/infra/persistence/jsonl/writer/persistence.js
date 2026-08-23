// @ts-check
/** Locked JSONL rotate/append/durability protocol, independent from queue/backpressure state. */
import { withIoResourceLock } from '#copilot/infra/internal/concurrency/locks';
import { mkdirPathUnlocked } from '#copilot/infra/internal/filesystem/transaction';
import { appendFileUnlocked } from '#copilot/infra/internal/filesystem/write';
import { utf8ByteLength } from '#copilot/infra/internal/platform/buffer';
import { assertSuccessfulSync } from '#copilot/infra/internal/platform/node/filesystem';
import { markMutationAppliedError } from '#copilot/infra/internal/policy';
import { rename } from 'node:fs/promises';
import path from 'node:path';
/** @typedef {import('./types.js').JsonlFileWriterOptions} JsonlFileWriterOptions */

/**
 * @param {{
 *   maxBytes: number | null;
 *   durability: import('#copilot/infra/internal/platform/node/filesystem').IoDurabilityMode;
 *   resolveRotatedPath: (filePath:string)=>string;
 *   syncDirectory: typeof import('#copilot/infra/internal/platform/node/filesystem').syncParentDirectoryBestEffort;
 *   onPhase?: JsonlFileWriterOptions['onPhase'];
 *   sizeTracker: ReturnType<typeof import('../size-tracker/index.js').createJsonlSizeTracker>;
 * }} options
 */
export function createJsonlBatchPersistence(options) {
    let rotations = 0;

    /** @param {string} targetPath @param {string} role */
    async function syncRotationDirectory(targetPath, role) {
        await options.onPhase?.(`before-${role}-directory-sync`, { targetPath, role });
        const result = await options.syncDirectory(targetPath);
        await options.onPhase?.(`after-${role}-directory-sync`, { targetPath, role, ...result });
        assertSuccessfulSync(result, {
            code: 'EDIRECTORYSYNC',
            message: `Falha ao sincronizar diretório da rotação JSONL: ${targetPath}`,
        });
    }

    /** @param {string} filePath @param {string} data */
    async function persist(filePath, data) {
        const dataBytes = utf8ByteLength(data, 'jsonl batch');
        await withIoResourceLock(
            filePath,
            async () => {
                await mkdirPathUnlocked(path.dirname(filePath), { recursive: true, durability: options.durability });
                let currentSize = await options.sizeTracker.resolve(filePath);
                /** @type {string | null} */
                let rotatedPath = null;
                try {
                    if (options.maxBytes !== null && currentSize > 0 && currentSize + dataBytes >= options.maxBytes) {
                        rotatedPath = path.resolve(options.resolveRotatedPath(filePath));
                        await mkdirPathUnlocked(path.dirname(rotatedPath), {
                            recursive: true,
                            durability: options.durability,
                        });
                        await options.onPhase?.('before-rotate', { filePath, rotatedPath, currentSize, dataBytes });
                        await rename(filePath, rotatedPath);
                        options.sizeTracker.discard(filePath);
                        currentSize = 0;
                        rotations += 1;
                        await options.onPhase?.('after-rotate', { filePath, rotatedPath, dataBytes });
                        if (options.durability === 'file-and-directory') {
                            await syncRotationDirectory(filePath, 'active');
                            if (path.dirname(rotatedPath) !== path.dirname(filePath)) {
                                await syncRotationDirectory(rotatedPath, 'rotated');
                            }
                        }
                    }
                    await options.onPhase?.('before-append', { filePath, dataBytes });
                    await appendFileUnlocked(filePath, data, {
                        durability: options.durability,
                        syncDirectory: options.syncDirectory,
                    });
                    options.sizeTracker.set(filePath, currentSize + dataBytes);
                    try {
                        await options.onPhase?.('after-append', { filePath, dataBytes, rotatedPath });
                    } catch (error) {
                        throw markMutationAppliedError(error, { phase: 'jsonl-after-append', paths: [filePath] });
                    }
                } catch (error) {
                    options.sizeTracker.discard(filePath);
                    throw error;
                }
            },
            { operation: 'jsonl-append', target: filePath, riskClass: 'medium' },
        );
        return { dataBytes };
    }

    return Object.freeze({
        persist,
        reset: () => {
            rotations = 0;
        },
        stats: () => ({ rotations }),
    });
}
