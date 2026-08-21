// @ts-check
/** Same-device link/rename move protocol with EXDEV delegation. */
import { emitMutationPhase } from '#copilot/infra/internal/filesystem/transaction';
import { markMutationAppliedError } from '#copilot/infra/internal/policy';
import { link, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { moveFileAcrossDevices } from './cross-device.js';
import { duplicatedMoveResult, syncMoveDirectory, moveSyncResultFromError as syncResultFromError } from './support.js';
/** @typedef {import('./types.js').MoveFileOptions} MoveFileOptions */
/** @typedef {import('./types.js').MoveFileResult} MoveFileResult */

/** @param {string} source @param {string} destination @param {MoveFileOptions} [options] @returns {Promise<MoveFileResult>} */
export async function moveFileUnlocked(source, destination, options = {}) {
    let destinationPublished = false;
    let sourceRemoved = false;
    if (!options.overwrite) {
        try {
            await emitMutationPhase(options, 'before-publish', { source, destination, exclusive: true });
            await link(source, destination);
            destinationPublished = true;
            await emitMutationPhase(options, 'after-publish', { source, destination, exclusive: true });
            let destinationDirectorySync;
            try {
                destinationDirectorySync = await syncMoveDirectory(options, destination, 'destination', {
                    source,
                    destination,
                    crossDevice: false,
                });
            } catch (syncError) {
                return duplicatedMoveResult(options, syncError, false, undefined, {
                    destinationDirectorySync: syncResultFromError(syncError),
                });
            }
            try {
                await emitMutationPhase(options, 'before-source-unlink', { source, destination, crossDevice: false });
                await unlink(source);
                sourceRemoved = true;
            } catch (unlinkError) {
                return duplicatedMoveResult(options, unlinkError, false, undefined, { destinationDirectorySync });
            }
            await emitMutationPhase(options, 'after-source-unlink', { source, destination, crossDevice: false });
            const sourceDirectorySync = await syncMoveDirectory(options, source, 'source', {
                source,
                destination,
                crossDevice: false,
            });
            return {
                crossDevice: false,
                duplicatedAfterCrossDeviceMove: false,
                sourceUnlinkErrorCode: null,
                destinationHash: options.expectedSourceHash ?? null,
                destinationBytes: options.expectedSourceBytes ?? null,
                fileSync: null,
                destinationDirectorySync,
                sourceDirectorySync,
                capacityPreflight: null,
            };
        } catch (error) {
            const errCode = /** @type {{ code?: unknown }} */ (error)?.code;
            if (errCode === 'EXDEV' && !destinationPublished)
                return moveFileAcrossDevices(source, destination, options);
            if (destinationPublished) {
                throw markMutationAppliedError(error, {
                    phase: sourceRemoved ? 'source-removed' : 'destination-published',
                    paths: [source, destination],
                });
            }
            throw error;
        }
    }

    try {
        await emitMutationPhase(options, 'before-publish', { source, destination, exclusive: false });
        await rename(source, destination);
        destinationPublished = true;
        sourceRemoved = true;
        await emitMutationPhase(options, 'after-publish', { source, destination, exclusive: false });
        const destinationDirectorySync = await syncMoveDirectory(options, destination, 'destination', {
            source,
            destination,
            crossDevice: false,
        });
        let sourceDirectorySync = null;
        if (path.dirname(source) !== path.dirname(destination)) {
            sourceDirectorySync = await syncMoveDirectory(options, source, 'source', {
                source,
                destination,
                crossDevice: false,
            });
        }
        return {
            crossDevice: false,
            duplicatedAfterCrossDeviceMove: false,
            sourceUnlinkErrorCode: null,
            destinationHash: options.expectedSourceHash ?? null,
            destinationBytes: options.expectedSourceBytes ?? null,
            fileSync: null,
            destinationDirectorySync,
            sourceDirectorySync,
            capacityPreflight: null,
        };
    } catch (error) {
        const errCode = /** @type {{ code?: unknown }} */ (error)?.code;
        if (errCode === 'EXDEV' && !destinationPublished) return moveFileAcrossDevices(source, destination, options);
        if (destinationPublished) {
            throw markMutationAppliedError(error, {
                phase: sourceRemoved ? 'source-removed' : 'destination-published',
                paths: [source, destination],
            });
        }
        throw error;
    }
}
