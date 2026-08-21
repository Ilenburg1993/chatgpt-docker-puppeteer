// @ts-check
/**
 * Append baixo de filesystem com durability explícita.
 *
 * @module copilot/infra/filesystem/write/append/unlocked
 */

import { emitMutationPhase, runFileHandleOperation } from '#copilot/infra/internal/filesystem/transaction';
import {
    assertSuccessfulSync,
    shouldFlushFile,
    shouldSyncDirectory,
    syncFileHandleBestEffort,
    syncParentDirectoryBestEffort,
} from '#copilot/infra/internal/platform/node/filesystem';
import { markMutationAppliedError } from '#copilot/infra/internal/policy';
import * as fs from 'node:fs/promises';

/** @typedef {import('#copilot/infra/internal/platform/node/filesystem').IoDurabilityMode} IoDurabilityMode */

/**
 * @param {string} filePath
 * @param {string | Buffer} payload
 * @param {{
 *     mode?: number;
 *     durability?: IoDurabilityMode;
 *     onPhase?: (phase: string, details: Record<string, unknown>) => void | Promise<void>;
 *     syncDirectory?: typeof syncParentDirectoryBestEffort;
 * }} [options]
 * @returns {Promise<{
 *     durability: IoDurabilityMode;
 *     fileFlushRequested: boolean;
 *     fileSync: Awaited<ReturnType<typeof syncFileHandleBestEffort>> | null;
 *     directorySync: Awaited<ReturnType<typeof syncParentDirectoryBestEffort>> | null;
 * }>}
 */
export async function appendFileUnlocked(filePath, payload, options = {}) {
    const durability = options.durability ?? 'none';
    const fileFlushRequested = shouldFlushFile(durability);
    /** @type {Awaited<ReturnType<typeof syncFileHandleBestEffort>> | null} */
    let fileSync = null;
    /** @type {Awaited<ReturnType<typeof syncParentDirectoryBestEffort>> | null} */
    let directorySync = null;
    let writeApplied = false;
    const handle = await fs.open(filePath, 'a', options.mode);
    const operationResult = await runFileHandleOperation(
        handle,
        async () => {
            await emitMutationPhase(options, 'before-append-write', { filePath });
            await handle.writeFile(payload);
            writeApplied = true;
            await emitMutationPhase(options, 'after-append-write', { filePath });

            if (fileFlushRequested) {
                await emitMutationPhase(options, 'before-file-sync', { filePath });
                fileSync = await syncFileHandleBestEffort(handle);
                await emitMutationPhase(options, 'after-file-sync', { filePath, ...fileSync });
                assertSuccessfulSync(fileSync, {
                    code: 'EFILESYNC',
                    message: `Falha ao sincronizar append: ${filePath}`,
                });
            }
            return { fileSync };
        },
        {
            mutationApplied: () => writeApplied,
            operationPhase: 'append-or-file-sync',
            closePhase: 'file-close',
            paths: [filePath],
        },
    );
    fileSync = operationResult.fileSync;

    if (shouldSyncDirectory(durability)) {
        try {
            await emitMutationPhase(options, 'before-destination-directory-sync', { filePath, target: filePath });
            directorySync = await (options.syncDirectory ?? syncParentDirectoryBestEffort)(filePath);
            await emitMutationPhase(options, 'after-destination-directory-sync', {
                filePath,
                target: filePath,
                ...directorySync,
            });
            assertSuccessfulSync(directorySync, {
                code: 'EDIRECTORYSYNC',
                message: `Falha ao sincronizar diretório do append: ${filePath}`,
            });
        } catch (error) {
            throw markMutationAppliedError(error, { phase: 'directory-sync', paths: [filePath] });
        }
    }

    return {
        durability,
        fileFlushRequested,
        fileSync,
        directorySync,
    };
}
