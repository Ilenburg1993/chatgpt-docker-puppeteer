// @ts-check
/** Shared rollback/snapshot protocol for locked filesystem mutations. */

import { persistRollbackSidecar, readBinaryMutationSnapshot } from '#copilot/infra/internal/filesystem/transaction';
import * as fs from 'node:fs/promises';

const ROLLBACK_SNAPSHOT_MAX_BYTES = 256 * 1024;

/**
 * @param {string} filePath
 * @returns {Promise<{
 *     contentHash: string;
 *     bytesRead: number;
 *     snapshotBase64: string | null;
 *     snapshotTruncated: boolean;
 *     rollbackSidecar: import('#copilot/infra/internal/filesystem/transaction').IoRollbackSidecar | null;
 * }>}
 */
export async function readMutationSnapshot(filePath, captureRollback = false) {
    const snapshot = await readBinaryMutationSnapshot(filePath, {
        snapshotMaxBytes: captureRollback ? ROLLBACK_SNAPSHOT_MAX_BYTES : 0,
        rollbackSidecar: captureRollback,
    });
    return captureRollback
        ? snapshot
        : {
              ...snapshot,
              snapshotBase64: null,
              snapshotTruncated: false,
              rollbackSidecar: null,
          };
}

/**
 * @param {string} filePath
 * @returns {Promise<{
 *     contentHash: string;
 *     bytesRead: number;
 *     snapshotBase64: string | null;
 *     snapshotTruncated: boolean;
 *     rollbackSidecar: import('#copilot/infra/internal/filesystem/transaction').IoRollbackSidecar | null;
 * } | null>}
 */
export async function readOptionalMutationSnapshot(filePath, captureRollback = false) {
    try {
        return await readMutationSnapshot(filePath, captureRollback);
    } catch (error) {
        const code = /** @type {{ code?: unknown }} */ (error)?.code;
        if (code === 'ENOENT' || code === 'ENOTDIR') return null;
        throw error;
    }
}

/**
 * @param {string} destination
 * @param {boolean | undefined} overwrite
 * @returns {Promise<void>}
 */
export async function assertDestinationWritable(destination, overwrite) {
    if (overwrite) return;
    try {
        await fs.access(destination);
    } catch (error) {
        const err = /** @type {{ code?: unknown; message?: unknown }} */ (error);
        if (err.code === 'ENOENT' || err.code === 'ENOTDIR' || String(err.message ?? '').includes('ENOENT')) return;
        throw error;
    }
    const error = new Error(`Destino já existe: ${destination}`);
    /** @type {{ code?: string }} */ (error).code = 'EEXIST';
    throw error;
}

/**
 * @param {Buffer} content
 * @param {{ persistLarge?: boolean; contentHash?: string }} [options]
 * @returns {Promise<{
 *     snapshotBase64: string | null;
 *     snapshotTruncated: boolean;
 *     rollbackSidecar: import('#copilot/infra/internal/filesystem/transaction').IoRollbackSidecar | null;
 * }>}
 */
export async function buildRollbackSnapshot(content, options = {}) {
    if (content.byteLength <= ROLLBACK_SNAPSHOT_MAX_BYTES) {
        return { snapshotBase64: content.toString('base64'), snapshotTruncated: false, rollbackSidecar: null };
    }
    const rollbackSidecar = options.persistLarge
        ? await persistRollbackSidecar(content, {
              ...(options.contentHash === undefined ? {} : { contentHash: options.contentHash }),
          })
        : null;
    return { snapshotBase64: null, snapshotTruncated: true, rollbackSidecar };
}

/**
 * @param {unknown} error
 */
export function isUnpublishedSnapshotConflict(error) {
    const code = /** @type {{ code?: unknown }} */ (error)?.code;
    return code === 'EEXPECTEDHASH' || code === 'ESTALESNAPSHOT';
}

/**
 * @param {import('#copilot/infra/internal/filesystem/transaction').IoRollbackSidecar | null} sidecar
 */
export async function discardRollbackSidecar(sidecar) {
    if (!sidecar) return;
    await fs.unlink(sidecar.path).catch(() => undefined);
}
