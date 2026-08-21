// @ts-check
/**
 * Metadata-only filesystem mutations with explicit durability semantics.
 *
 * Unlike atomic content replacement, chmod mutates the currently referenced inode in place. Once `FileHandle.chmod()`
 * succeeds the mutation is physically applied; any later sync/hook/close failure therefore has to carry
 * `mutationApplied=true` so callers inspect state before retrying.
 *
 * @module copilot/infra/filesystem/write/metadata/unlocked
 */

import { emitMutationPhase, runFileHandleOperation } from '#copilot/infra/internal/filesystem/transaction';
import {
    assertSuccessfulSync,
    normalizeIoDurability,
    shouldFlushFile,
    syncFileHandleBestEffort,
} from '#copilot/infra/internal/platform/node/filesystem';
import { open } from 'node:fs/promises';

/** @typedef {import('#copilot/infra/internal/platform/node/filesystem').IoDurabilityMode} IoDurabilityMode */

/**
 * @param {number} mode
 * @returns {number}
 */
function normalizeFileMode(mode) {
    if (!Number.isInteger(mode) || mode < 0 || mode > 0o7777) {
        throw new RangeError(`Invalid file mode: ${mode}`);
    }
    return mode;
}

/**
 * Change the mode of one existing regular file through the same open descriptor used for the durability barrier.
 * Directory fsync is intentionally unnecessary: chmod changes inode metadata but does not alter a directory entry.
 *
 * @param {string} filePath
 * @param {number} mode
 * @param {{
 *     durability?: IoDurabilityMode;
 *     onPhase?: (phase: string, details: Record<string, unknown>) => void | Promise<void>;
 *     syncFile?: typeof syncFileHandleBestEffort;
 * }} [options]
 * @returns {Promise<{
 *     path: string;
 *     changed: boolean;
 *     previousMode: number;
 *     mode: number;
 *     durability: {
 *         durability: IoDurabilityMode;
 *         fileSync: Awaited<ReturnType<typeof syncFileHandleBestEffort>> | null;
 *     };
 * }>}
 */
export async function chmodFileUnlocked(filePath, mode, options = {}) {
    const targetMode = normalizeFileMode(mode);
    const durability = normalizeIoDurability(options.durability);
    const handle = await open(filePath, 'r');
    let mutationApplied = false;
    return runFileHandleOperation(
        handle,
        async () => {
            const stats = await handle.stat();
            if (!stats.isFile()) {
                const error = new Error(`chmod supports only regular files: ${filePath}`);
                /** @type {{ code?: string }} */ (error).code = 'ECHMODNOTFILE';
                throw error;
            }
            const previousMode = stats.mode & 0o7777;
            if (previousMode === targetMode) {
                return {
                    path: filePath,
                    changed: false,
                    previousMode,
                    mode: targetMode,
                    durability: { durability, fileSync: null },
                };
            }

            await emitMutationPhase(options, 'before-mode-apply', { filePath, previousMode, targetMode });
            await handle.chmod(targetMode);
            mutationApplied = true;
            await emitMutationPhase(options, 'after-mode-apply', { filePath, previousMode, targetMode });

            /** @type {Awaited<ReturnType<typeof syncFileHandleBestEffort>> | null} */
            let fileSync = null;
            if (shouldFlushFile(durability)) {
                await emitMutationPhase(options, 'before-file-sync', { filePath, previousMode, targetMode });
                fileSync = await (options.syncFile ?? syncFileHandleBestEffort)(handle);
                await emitMutationPhase(options, 'after-file-sync', {
                    filePath,
                    previousMode,
                    targetMode,
                    ...fileSync,
                });
                assertSuccessfulSync(fileSync, {
                    code: 'EFILESYNC',
                    message: `Failed to synchronize file metadata after chmod: ${filePath}`,
                });
            }

            return {
                path: filePath,
                changed: true,
                previousMode,
                mode: targetMode,
                durability: { durability, fileSync },
            };
        },
        {
            mutationApplied: () => mutationApplied,
            operationPhase: 'chmod-confirmation',
            closePhase: 'chmod-close',
            paths: [filePath],
        },
    );
}
