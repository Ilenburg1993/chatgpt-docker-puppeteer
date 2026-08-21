// @ts-check
/** Staged copy/verify/fsync/publish/unlink protocol for EXDEV file moves. */
import {
    emitMutationPhase,
    preflightIoCapacity,
    prepareSiblingTempPath,
} from '#copilot/infra/internal/filesystem/transaction';
import { assertSuccessfulSync, syncFileBestEffort } from '#copilot/infra/internal/platform/node/filesystem';
import { markMutationAppliedError } from '#copilot/infra/internal/policy';
import * as nodeFs from 'node:fs';
import { copyFile, link, rename, unlink } from 'node:fs/promises';
import { duplicatedMoveResult, moveSyncResultFromError, readMoveFileIntegrity, syncMoveDirectory } from './support.js';
/** @typedef {import('./types.js').MoveFileOptions} MoveFileOptions */
/** @typedef {import('./types.js').MoveFileResult} MoveFileResult */

/** @param {string} source @param {string} destination @param {MoveFileOptions} options @returns {Promise<MoveFileResult>} */
export async function moveFileAcrossDevices(source, destination, options) {
    const tmpDestination = options.tempPathFactory
        ? options.tempPathFactory(destination, 'move')
        : await prepareSiblingTempPath(destination, 'move');
    let tmpCreated = false;
    let destinationPublished = false;
    let sourceRemoved = false;
    try {
        const sourceBefore =
            options.expectedSourceHash && typeof options.expectedSourceBytes === 'number'
                ? { contentHash: options.expectedSourceHash, bytes: options.expectedSourceBytes }
                : await readMoveFileIntegrity(source);
        const capacityPreflight = await (options.capacityPreflight ?? preflightIoCapacity)(
            destination,
            sourceBefore.bytes,
        );
        await copyFile(source, tmpDestination, nodeFs.constants.COPYFILE_EXCL);
        tmpCreated = true;
        await emitMutationPhase(options, 'temp-written', { source, destination, tmpDestination, crossDevice: true });
        const [sourceAfter, tempAfter] = await Promise.all([
            readMoveFileIntegrity(source),
            readMoveFileIntegrity(tmpDestination),
        ]);
        if (sourceAfter.contentHash !== sourceBefore.contentHash || sourceAfter.bytes !== sourceBefore.bytes) {
            const err = new Error(`Origem mudou durante move cross-device: ${source}`);
            /** @type {{code?:string}} */ (err).code = 'ESOURCECHANGED';
            throw err;
        }
        if (tempAfter.contentHash !== sourceBefore.contentHash || tempAfter.bytes !== sourceBefore.bytes) {
            const err = new Error(`Cópia cross-device divergente: ${source} -> ${destination}`);
            /** @type {{code?:string}} */ (err).code = 'ECOPYMISMATCH';
            throw err;
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
            message: `Falha ao sincronizar move cross-device: ${tmpDestination}`,
        });
        await emitMutationPhase(options, 'before-publish', {
            source,
            destination,
            tmpDestination,
            exclusive: !options.overwrite,
        });
        if (options.overwrite) await rename(tmpDestination, destination);
        else {
            await link(tmpDestination, destination);
            await unlink(tmpDestination);
        }
        destinationPublished = true;
        tmpCreated = false;
        await emitMutationPhase(options, 'after-publish', {
            source,
            destination,
            tmpDestination,
            exclusive: !options.overwrite,
        });
        let destinationDirectorySync;
        try {
            destinationDirectorySync = await syncMoveDirectory(options, destination, 'destination', {
                source,
                destination,
                crossDevice: true,
            });
        } catch (syncError) {
            return duplicatedMoveResult(options, syncError, true, tempAfter, {
                fileSync: syncResult,
                destinationDirectorySync: moveSyncResultFromError(syncError),
                capacityPreflight,
            });
        }
        try {
            await emitMutationPhase(options, 'before-source-unlink', { source, destination, crossDevice: true });
            await unlink(source);
            sourceRemoved = true;
        } catch (unlinkError) {
            return duplicatedMoveResult(options, unlinkError, true, tempAfter, {
                fileSync: syncResult,
                destinationDirectorySync,
                capacityPreflight,
            });
        }
        await emitMutationPhase(options, 'after-source-unlink', { source, destination, crossDevice: true });
        const sourceDirectorySync = await syncMoveDirectory(options, source, 'source', {
            source,
            destination,
            crossDevice: true,
        });
        return {
            crossDevice: true,
            duplicatedAfterCrossDeviceMove: false,
            sourceUnlinkErrorCode: null,
            destinationHash: tempAfter.contentHash,
            destinationBytes: tempAfter.bytes,
            fileSync: syncResult,
            destinationDirectorySync,
            sourceDirectorySync,
            capacityPreflight,
        };
    } catch (error) {
        if (tmpCreated) await unlink(tmpDestination).catch(() => undefined);
        if (destinationPublished)
            throw markMutationAppliedError(error, {
                phase: sourceRemoved ? 'source-removed' : 'destination-published',
                paths: [source, destination],
            });
        throw error;
    }
}
