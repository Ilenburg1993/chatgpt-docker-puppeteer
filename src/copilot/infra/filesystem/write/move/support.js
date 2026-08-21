// @ts-check
/** Integrity and durability helpers shared by same-device and cross-device move protocols. */
import { emitMutationPhase, readBinaryMutationSnapshot } from '#copilot/infra/internal/filesystem/transaction';
import { assertSuccessfulSync, syncParentDirectoryBestEffort } from '#copilot/infra/internal/platform/node/filesystem';
/** @typedef {import('./types.js').MoveFileOptions} MoveFileOptions */

/** @param {string} filePath */
export async function readMoveFileIntegrity(filePath) {
    const snapshot = await readBinaryMutationSnapshot(filePath, { snapshotMaxBytes: 0 });
    return { contentHash: snapshot.contentHash, bytes: snapshot.bytesRead };
}
/** @param {MoveFileOptions} options @param {string} target @param {'source'|'destination'} role @param {Record<string,unknown>} details */
export async function syncMoveDirectory(options, target, role, details) {
    await emitMutationPhase(options, `before-${role}-directory-sync`, { ...details, target });
    const result = await (options.syncDirectory ?? syncParentDirectoryBestEffort)(target);
    await emitMutationPhase(options, `after-${role}-directory-sync`, { ...details, target, ...result });
    assertSuccessfulSync(result, {
        code: 'EDIRECTORYSYNC',
        message: `Falha ao sincronizar diretório ${role} do move: ${target}`,
    });
    return result;
}
/** @param {unknown} error */
export function moveSyncResultFromError(error) {
    return (
        /** @type {{syncResult?:Awaited<ReturnType<typeof syncParentDirectoryBestEffort>>}} */ (error)?.syncResult ??
        null
    );
}
/**
 * @param {MoveFileOptions} options @param {unknown} error @param {boolean} crossDevice
 * @param {{contentHash:string;bytes:number}} [integrity]
 * @param {{fileSync?:Awaited<ReturnType<typeof import('#copilot/infra/internal/platform/node/filesystem').syncFileBestEffort>>|null;destinationDirectorySync?:Awaited<ReturnType<typeof syncParentDirectoryBestEffort>>|null;sourceDirectorySync?:Awaited<ReturnType<typeof syncParentDirectoryBestEffort>>|null;capacityPreflight?:Awaited<ReturnType<typeof import('#copilot/infra/internal/filesystem/transaction').preflightIoCapacity>>|null}} [syncs]
 */
export function duplicatedMoveResult(options, error, crossDevice, integrity, syncs = {}) {
    return {
        crossDevice,
        duplicatedAfterCrossDeviceMove: true,
        sourceUnlinkErrorCode: String(/** @type {{code?:unknown}} */ (error)?.code ?? 'UNKNOWN'),
        destinationHash: integrity?.contentHash ?? options.expectedSourceHash ?? null,
        destinationBytes: integrity?.bytes ?? options.expectedSourceBytes ?? null,
        fileSync: syncs.fileSync ?? null,
        destinationDirectorySync: syncs.destinationDirectorySync ?? null,
        sourceDirectorySync: syncs.sourceDirectorySync ?? null,
        capacityPreflight: syncs.capacityPreflight ?? null,
    };
}
