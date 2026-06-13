// @ts-check
/**
 * Move baixo de filesystem com fallback cross-device.
 *
 * @module copilot/infra/io/fs/move
 */

import { randomBytes } from 'node:crypto';
import { copyFile, link, readFile, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { sha256 } from '../../shared/hash.js';
import { assertSuccessfulSync, syncFileBestEffort, syncParentDirectoryBestEffort } from './durability.js';
import { emitMutationPhase } from './mutation-phase.js';

/**
 * @param {string} filePath
 * @returns {Promise<{ contentHash: string; bytes: number }>}
 */
async function readFileIntegrity(filePath) {
    const [stats, content] = await Promise.all([stat(filePath), readFile(filePath)]);
    return { contentHash: sha256(content), bytes: stats.size };
}

/**
 * @param {string} source
 * @param {string} destination
 * @param {{
 *     overwrite?: boolean;
 *     expectedSourceHash?: string;
 *     expectedSourceBytes?: number;
 *     onPhase?: (phase: string, details: Record<string, unknown>) => void | Promise<void>;
 *     syncFile?: typeof syncFileBestEffort;
 *     syncDirectory?: typeof syncParentDirectoryBestEffort;
 * }} [options]
 * @returns {Promise<{
 *     crossDevice: boolean;
 *     duplicatedAfterCrossDeviceMove: boolean;
 *     sourceUnlinkErrorCode: string | null;
 *     destinationHash: string | null;
 *     destinationBytes: number | null;
 * }>}
 */
export async function moveFileUnlocked(source, destination, options = {}) {
    if (!options.overwrite) {
        try {
            await emitMutationPhase(options, 'before-publish', { source, destination, exclusive: true });
            await link(source, destination);
            await emitMutationPhase(options, 'after-publish', { source, destination, exclusive: true });
            try {
                await syncMoveDirectory(options, destination, 'destination', { source, destination, crossDevice: false });
            } catch (syncError) {
                return duplicatedMoveResult(options, syncError, false);
            }
            try {
                await emitMutationPhase(options, 'before-source-unlink', { source, destination, crossDevice: false });
                await unlink(source);
            } catch (unlinkError) {
                return duplicatedMoveResult(options, unlinkError, false);
            }
            await emitMutationPhase(options, 'after-source-unlink', { source, destination, crossDevice: false });
            await syncMoveDirectory(options, source, 'source', { source, destination, crossDevice: false });
            return {
                crossDevice: false,
                duplicatedAfterCrossDeviceMove: false,
                sourceUnlinkErrorCode: null,
                destinationHash: options.expectedSourceHash ?? null,
                destinationBytes: options.expectedSourceBytes ?? null,
            };
        } catch (error) {
            const errCode = /** @type {{ code?: unknown }} */ (error)?.code;
            if (errCode !== 'EXDEV') throw error;
            return moveFileAcrossDevices(source, destination, options);
        }
    }

    try {
        await emitMutationPhase(options, 'before-publish', { source, destination, exclusive: false });
        await rename(source, destination);
        await emitMutationPhase(options, 'after-publish', { source, destination, exclusive: false });
        await syncMoveDirectory(options, destination, 'destination', { source, destination, crossDevice: false });
        if (path.dirname(source) !== path.dirname(destination)) {
            await syncMoveDirectory(options, source, 'source', { source, destination, crossDevice: false });
        }
        return {
            crossDevice: false,
            duplicatedAfterCrossDeviceMove: false,
            sourceUnlinkErrorCode: null,
            destinationHash: options.expectedSourceHash ?? null,
            destinationBytes: options.expectedSourceBytes ?? null,
        };
    } catch (error) {
        const errCode = /** @type {{ code?: unknown }} */ (error)?.code;
        if (errCode !== 'EXDEV') throw error;
        return moveFileAcrossDevices(source, destination, options);
    }
}

/**
 * @param {string} source
 * @param {string} destination
 * @param {{
 *     overwrite?: boolean;
 *     expectedSourceHash?: string;
 *     expectedSourceBytes?: number;
 *     onPhase?: (phase: string, details: Record<string, unknown>) => void | Promise<void>;
 *     syncFile?: typeof syncFileBestEffort;
 *     syncDirectory?: typeof syncParentDirectoryBestEffort;
 * }} options
 * @returns {ReturnType<typeof moveFileUnlocked>}
 */
async function moveFileAcrossDevices(source, destination, options) {
    const destinationDir = path.dirname(destination);
    const tmpDestination = path.join(
        destinationDir,
        `.${path.basename(destination)}.${randomBytes(12).toString('hex')}.move-tmp`,
    );
    let tmpCreated = false;
    try {
        const sourceBefore =
            options.expectedSourceHash && typeof options.expectedSourceBytes === 'number'
                ? { contentHash: options.expectedSourceHash, bytes: options.expectedSourceBytes }
                : await readFileIntegrity(source);
        await copyFile(source, tmpDestination);
        tmpCreated = true;
        await emitMutationPhase(options, 'temp-written', { source, destination, tmpDestination, crossDevice: true });
        const [sourceAfter, tempAfter] = await Promise.all([readFileIntegrity(source), readFileIntegrity(tmpDestination)]);
        if (sourceAfter.contentHash !== sourceBefore.contentHash || sourceAfter.bytes !== sourceBefore.bytes) {
            const err = new Error(`Origem mudou durante move cross-device: ${source}`);
            /** @type {{ code?: string }} */ (err).code = 'ESOURCECHANGED';
            throw err;
        }
        if (tempAfter.contentHash !== sourceBefore.contentHash || tempAfter.bytes !== sourceBefore.bytes) {
            const err = new Error(`Cópia cross-device divergente: ${source} -> ${destination}`);
            /** @type {{ code?: string }} */ (err).code = 'ECOPYMISMATCH';
            throw err;
        }
        await emitMutationPhase(options, 'before-file-sync', { source, destination, target: tmpDestination });
        const syncResult = await (options.syncFile ?? syncFileBestEffort)(tmpDestination);
        await emitMutationPhase(options, 'after-file-sync', { source, destination, target: tmpDestination, ...syncResult });
        assertSuccessfulSync(syncResult, {
            code: 'EFILESYNC',
            message: `Falha ao sincronizar move cross-device: ${tmpDestination}`,
        });
        if (options.overwrite) {
            await emitMutationPhase(options, 'before-publish', { source, destination, tmpDestination, exclusive: false });
            await rename(tmpDestination, destination);
            await emitMutationPhase(options, 'after-publish', { source, destination, tmpDestination, exclusive: false });
        } else {
            await emitMutationPhase(options, 'before-publish', { source, destination, tmpDestination, exclusive: true });
            await link(tmpDestination, destination);
            await emitMutationPhase(options, 'after-publish', { source, destination, tmpDestination, exclusive: true });
            await unlink(tmpDestination);
        }
        tmpCreated = false;
        try {
            await syncMoveDirectory(options, destination, 'destination', { source, destination, crossDevice: true });
        } catch (syncError) {
            return duplicatedMoveResult(options, syncError, true, tempAfter);
        }
        try {
            await emitMutationPhase(options, 'before-source-unlink', { source, destination, crossDevice: true });
            await unlink(source);
        } catch (unlinkError) {
            return duplicatedMoveResult(options, unlinkError, true, tempAfter);
        }
        await emitMutationPhase(options, 'after-source-unlink', { source, destination, crossDevice: true });
        await syncMoveDirectory(options, source, 'source', { source, destination, crossDevice: true });
        return {
            crossDevice: true,
            duplicatedAfterCrossDeviceMove: false,
            sourceUnlinkErrorCode: null,
            destinationHash: tempAfter.contentHash,
            destinationBytes: tempAfter.bytes,
        };
    } catch (error) {
        if (tmpCreated) {
            await unlink(tmpDestination).catch(() => undefined);
        }
        throw error;
    }
}

/**
 * @param {NonNullable<Parameters<typeof moveFileUnlocked>[2]>} options
 * @param {string} target
 * @param {'source' | 'destination'} role
 * @param {Record<string, unknown>} details
 */
async function syncMoveDirectory(options, target, role, details) {
    await emitMutationPhase(options, `before-${role}-directory-sync`, { ...details, target });
    const result = await (options.syncDirectory ?? syncParentDirectoryBestEffort)(target);
    await emitMutationPhase(options, `after-${role}-directory-sync`, { ...details, target, ...result });
    assertSuccessfulSync(result, {
        code: 'EDIRECTORYSYNC',
        message: `Falha ao sincronizar diretório ${role} do move: ${target}`,
    });
}

/**
 * @param {NonNullable<Parameters<typeof moveFileUnlocked>[2]>} options
 * @param {unknown} error
 * @param {boolean} crossDevice
 * @param {{ contentHash: string; bytes: number }} [integrity]
 */
function duplicatedMoveResult(options, error, crossDevice, integrity) {
    return {
        crossDevice,
        duplicatedAfterCrossDeviceMove: true,
        sourceUnlinkErrorCode: String(/** @type {{ code?: unknown }} */ (error)?.code ?? 'UNKNOWN'),
        destinationHash: integrity?.contentHash ?? options.expectedSourceHash ?? null,
        destinationBytes: integrity?.bytes ?? options.expectedSourceBytes ?? null,
    };
}
