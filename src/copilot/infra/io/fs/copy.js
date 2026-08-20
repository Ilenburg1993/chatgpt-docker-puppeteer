// @ts-check
/**
 * Cópia baixa de filesystem.
 *
 * @module copilot/infra/io/fs/copy
 */

import * as nodeFs from 'node:fs';
import { copyFile, link, rename, stat, unlink } from 'node:fs/promises';
import { preflightIoCapacity } from './capacity-preflight.js';
import { assertSuccessfulSync, syncFileBestEffort, syncParentDirectoryBestEffort } from './durability.js';
import { emitMutationPhase } from './mutation-phase.js';
import { markMutationAppliedError } from './mutation-state.js';
import { readBinaryMutationSnapshot } from './snapshot.js';
import { prepareSiblingTempPath } from './temp-path.js';

/**
 * @param {string} source
 * @param {string} destination
 * @param {{
 *     exclusive?: boolean;
 *     expectedSourceHash?: string;
 *     expectedSourceBytes?: number;
 *     onPhase?: (phase: string, details: Record<string, unknown>) => void | Promise<void>;
 *     syncFile?: typeof syncFileBestEffort;
 *     syncDirectory?: typeof syncParentDirectoryBestEffort;
 *     capacityPreflight?: typeof preflightIoCapacity;
 * }} [options]
 * @returns {Promise<{
 *     destinationHash: string;
 *     destinationBytes: number;
 *     staged: true;
 *     fileSync: Awaited<ReturnType<typeof syncFileBestEffort>>;
 *     destinationDirectorySync: Awaited<ReturnType<typeof syncParentDirectoryBestEffort>>;
 *     capacityPreflight: Awaited<ReturnType<typeof preflightIoCapacity>>;
 * }>}
 */
export async function copyFileUnlocked(source, destination, options = {}) {
    const tmpDestination = await prepareSiblingTempPath(destination, 'copy');
    let tmpCreated = false;
    let published = false;
    const sourceBytes = options.expectedSourceBytes ?? (await stat(source)).size;
    const capacityPreflight = await (options.capacityPreflight ?? preflightIoCapacity)(destination, sourceBytes);
    try {
        await copyFile(source, tmpDestination, nodeFs.constants.COPYFILE_EXCL);
        tmpCreated = true;
        await emitMutationPhase(options, 'temp-written', { source, destination, tmpDestination });
        const [sourceAfter, tempAfter] = await Promise.all([
            readBinaryMutationSnapshot(source, { snapshotMaxBytes: 0 }),
            readBinaryMutationSnapshot(tmpDestination, { snapshotMaxBytes: 0 }),
        ]);
        const sourceHash = sourceAfter.contentHash;
        const tempHash = tempAfter.contentHash;
        const expectedHash = options.expectedSourceHash ?? sourceHash;
        const expectedBytes = options.expectedSourceBytes ?? sourceAfter.bytesRead;
        if (sourceHash !== expectedHash || sourceAfter.bytesRead !== expectedBytes) {
            const error = new Error(`Origem mudou durante copy staged: ${source}`);
            /** @type {{ code?: string }} */ (error).code = 'ESOURCECHANGED';
            throw error;
        }
        if (tempHash !== expectedHash || tempAfter.bytesRead !== expectedBytes) {
            const error = new Error(`Cópia staged divergente: ${source} -> ${destination}`);
            /** @type {{ code?: string }} */ (error).code = 'ECOPYMISMATCH';
            throw error;
        }
        await emitMutationPhase(options, 'before-file-sync', { source, destination, target: tmpDestination });
        const syncResult = await (options.syncFile ?? syncFileBestEffort)(tmpDestination);
        await emitMutationPhase(options, 'after-file-sync', {
            source,
            destination,
            target: tmpDestination,
            ...syncResult,
        });
        assertSuccessfulSync(syncResult, {
            code: 'EFILESYNC',
            message: `Falha ao sincronizar cópia staged: ${tmpDestination}`,
        });
        if (options.exclusive) {
            await emitMutationPhase(options, 'before-publish', {
                source,
                destination,
                tmpDestination,
                exclusive: true,
            });
            await link(tmpDestination, destination);
            published = true;
            await emitMutationPhase(options, 'after-publish', { source, destination, tmpDestination, exclusive: true });
            await unlink(tmpDestination);
        } else {
            await emitMutationPhase(options, 'before-publish', {
                source,
                destination,
                tmpDestination,
                exclusive: false,
            });
            await rename(tmpDestination, destination);
            published = true;
            await emitMutationPhase(options, 'after-publish', {
                source,
                destination,
                tmpDestination,
                exclusive: false,
            });
        }
        tmpCreated = false;
        await emitMutationPhase(options, 'before-destination-directory-sync', { source, destination });
        const directorySync = await (options.syncDirectory ?? syncParentDirectoryBestEffort)(destination);
        await emitMutationPhase(options, 'after-destination-directory-sync', { source, destination, ...directorySync });
        assertSuccessfulSync(directorySync, {
            code: 'EDIRECTORYSYNC',
            message: `Falha ao sincronizar diretório da cópia staged: ${destination}`,
        });
        return {
            destinationHash: tempHash,
            destinationBytes: tempAfter.bytesRead,
            staged: true,
            fileSync: syncResult,
            destinationDirectorySync: directorySync,
            capacityPreflight,
        };
    } catch (error) {
        if (tmpCreated) await unlink(tmpDestination).catch(() => undefined);
        if (published) {
            throw markMutationAppliedError(error, { phase: 'post-publish', paths: [destination] });
        }
        throw error;
    }
}
