// @ts-check
/**
 * Remoção baixa de filesystem com durability explícita do namespace.
 *
 * @module copilot/infra/io/fs/remove
 */

import { rm, unlink } from 'node:fs/promises';
import {
    assertSuccessfulSync,
    normalizeIoDurability,
    shouldSyncDirectory,
    syncParentDirectoryBestEffort,
} from './durability.js';
import { emitMutationPhase } from './mutation-phase.js';
import { markMutationAppliedError } from './mutation-state.js';

/** @typedef {import('./durability.js').IoDurabilityMode} IoDurabilityMode */

/**
 * @param {string} filePath
 * @param {{ recursive?: boolean; recursiveConfirmation?: string }} options
 */
export function assertRecursiveRemovalConfirmed(filePath, options) {
    if (!options.recursive) return;
    if (options.recursiveConfirmation === filePath) return;
    const error = /** @type {Error & { code?: string }} */ (
        new Error('Recursive removal requires recursiveConfirmation to exactly match the resolved target path.')
    );
    error.code = 'ERECURSIVEREMOVECONFIRMATION';
    throw error;
}

/**
 * @param {string} filePath
 * @param {{
 *     durability?: IoDurabilityMode;
 *     onPhase?: (phase: string, details: Record<string, unknown>) => void | Promise<void>;
 *     syncDirectory?: typeof syncParentDirectoryBestEffort;
 * }} options
 */
async function syncRemovalParent(filePath, options) {
    const durability = normalizeIoDurability(options.durability);
    if (!shouldSyncDirectory(durability)) return { durability, directorySync: null };
    try {
        await emitMutationPhase(options, 'before-parent-directory-sync', { filePath, target: filePath });
        const directorySync = await (options.syncDirectory ?? syncParentDirectoryBestEffort)(filePath);
        await emitMutationPhase(options, 'after-parent-directory-sync', {
            filePath,
            target: filePath,
            ...directorySync,
        });
        assertSuccessfulSync(directorySync, {
            code: 'EDIRECTORYSYNC',
            message: `Falha ao sincronizar diretório após remoção: ${filePath}`,
        });
        return { durability, directorySync };
    } catch (error) {
        throw markMutationAppliedError(error, { phase: 'parent-directory-sync', paths: [filePath] });
    }
}

/**
 * @param {string} filePath
 * @param {{
 *     durability?: IoDurabilityMode;
 *     onPhase?: (phase: string, details: Record<string, unknown>) => void | Promise<void>;
 *     syncDirectory?: typeof syncParentDirectoryBestEffort;
 * }} [options]
 * @returns {Promise<{
 *     durability: IoDurabilityMode;
 *     directorySync: Awaited<ReturnType<typeof syncParentDirectoryBestEffort>> | null;
 * }>}
 */
export async function deleteFileUnlocked(filePath, options = {}) {
    await emitMutationPhase(options, 'before-unlink', { filePath });
    await unlink(filePath);
    try {
        await emitMutationPhase(options, 'after-unlink', { filePath });
    } catch (error) {
        throw markMutationAppliedError(error, { phase: 'after-unlink', paths: [filePath] });
    }
    return syncRemovalParent(filePath, options);
}

/**
 * @param {string} filePath
 * @param {{
 *     recursive?: boolean;
 *     force?: boolean;
 *     recursiveConfirmation?: string;
 *     durability?: IoDurabilityMode;
 *     onPhase?: (phase: string, details: Record<string, unknown>) => void | Promise<void>;
 *     syncDirectory?: typeof syncParentDirectoryBestEffort;
 * }} [options]
 * @returns {Promise<{
 *     durability: IoDurabilityMode;
 *     directorySync: Awaited<ReturnType<typeof syncParentDirectoryBestEffort>> | null;
 * }>}
 */
export async function removePathUnlocked(filePath, options = {}) {
    assertRecursiveRemovalConfirmed(filePath, options);
    await emitMutationPhase(options, 'before-remove', {
        filePath,
        recursive: Boolean(options.recursive),
        force: Boolean(options.force),
    });
    await rm(filePath, { recursive: Boolean(options.recursive), force: Boolean(options.force) });
    try {
        await emitMutationPhase(options, 'after-remove', {
            filePath,
            recursive: Boolean(options.recursive),
            force: Boolean(options.force),
        });
    } catch (error) {
        throw markMutationAppliedError(error, { phase: 'after-remove', paths: [filePath] });
    }
    return syncRemovalParent(filePath, options);
}
