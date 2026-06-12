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
import { syncFileBestEffort, syncParentDirectoryBestEffort } from './durability.js';

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
    try {
        await rename(source, destination);
        return {
            crossDevice: false,
            duplicatedAfterCrossDeviceMove: false,
            sourceUnlinkErrorCode: null,
            destinationHash: null,
            destinationBytes: null,
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
 * @param {{ overwrite?: boolean; expectedSourceHash?: string; expectedSourceBytes?: number }} options
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
        await syncFileBestEffort(tmpDestination);
        if (options.overwrite) {
            await rename(tmpDestination, destination);
        } else {
            await link(tmpDestination, destination);
            await unlink(tmpDestination);
        }
        tmpCreated = false;
        await syncParentDirectoryBestEffort(destination);
        try {
            await unlink(source);
            await syncParentDirectoryBestEffort(source);
        } catch (unlinkError) {
            return {
                crossDevice: true,
                duplicatedAfterCrossDeviceMove: true,
                sourceUnlinkErrorCode: String(/** @type {{ code?: unknown }} */ (unlinkError)?.code ?? 'UNKNOWN'),
                destinationHash: tempAfter.contentHash,
                destinationBytes: tempAfter.bytes,
            };
        }
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
