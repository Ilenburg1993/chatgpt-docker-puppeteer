// @ts-check
/**
 * Cópia baixa de filesystem.
 *
 * @module copilot/infra/io/fs/copy
 */

import { randomBytes } from 'node:crypto';
import * as nodeFs from 'node:fs';
import { copyFile, link, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { syncFileBestEffort, syncParentDirectoryBestEffort } from './durability.js';
import { emitMutationPhase } from './mutation-phase.js';
import { readBinaryMutationSnapshot } from './snapshot.js';

/**
 * @param {string} source
 * @param {string} destination
 * @param {{
 *     exclusive?: boolean;
 *     expectedSourceHash?: string;
 *     expectedSourceBytes?: number;
 *     onPhase?: (phase: string, details: Record<string, unknown>) => void | Promise<void>;
 * }} [options]
 * @returns {Promise<{ destinationHash: string; destinationBytes: number; staged: true }>}
 */
export async function copyFileUnlocked(source, destination, options = {}) {
    const tmpDestination = path.join(
        path.dirname(destination),
        `.${path.basename(destination)}.${randomBytes(12).toString('hex')}.copy-tmp`,
    );
    let tmpCreated = false;
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
        const syncResult = await syncFileBestEffort(tmpDestination);
        if (syncResult.attempted && !syncResult.ok && !syncResult.skippedReason) {
            const error = new Error(`Falha ao sincronizar cópia staged: ${tmpDestination}`);
            /** @type {{ code?: string; cause?: unknown }} */ (error).code = 'EFILESYNC';
            /** @type {{ code?: string; cause?: unknown }} */ (error).cause = syncResult.errorCode;
            throw error;
        }
        if (options.exclusive) {
            await emitMutationPhase(options, 'before-publish', { source, destination, tmpDestination, exclusive: true });
            await link(tmpDestination, destination);
            await emitMutationPhase(options, 'after-publish', { source, destination, tmpDestination, exclusive: true });
            await unlink(tmpDestination);
        } else {
            await emitMutationPhase(options, 'before-publish', { source, destination, tmpDestination, exclusive: false });
            await rename(tmpDestination, destination);
            await emitMutationPhase(options, 'after-publish', { source, destination, tmpDestination, exclusive: false });
        }
        tmpCreated = false;
        await syncParentDirectoryBestEffort(destination);
        return { destinationHash: tempHash, destinationBytes: tempAfter.bytesRead, staged: true };
    } catch (error) {
        if (tmpCreated) await unlink(tmpDestination).catch(() => undefined);
        throw error;
    }
}
