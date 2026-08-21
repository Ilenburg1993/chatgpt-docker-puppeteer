// @ts-check
/**
 * mkdir baixo de filesystem com durability explícita do namespace criado.
 *
 * @module copilot/infra/filesystem/transaction/directory/mkdir
 */

import {
    assertSuccessfulSync,
    normalizeIoDurability,
    shouldSyncDirectory,
    syncParentDirectoryBestEffort,
} from '#copilot/infra/internal/platform/node/filesystem';
import { markMutationAppliedError } from '#copilot/infra/internal/policy';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { emitMutationPhase } from '../phases/index.js';

/** @typedef {import('#copilot/infra/internal/platform/node/filesystem').IoDurabilityMode} IoDurabilityMode */

/**
 * Node only returns the first directory it created when recursive=true. Expand that first path to every created child
 * so each parent directory whose namespace gained an entry can receive a durability barrier.
 *
 * @param {string} dirPath
 * @param {string | undefined} createdPath
 * @param {boolean} recursive
 * @returns {string[]}
 */
function createdDirectoryChain(dirPath, createdPath, recursive) {
    const target = path.resolve(dirPath);
    const first = recursive ? (createdPath === undefined ? null : path.resolve(createdPath)) : target;
    if (first === null) return [];
    const relative = path.relative(first, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        const error = new Error(`mkdir retornou createdPath fora do target: ${createdPath ?? ''}`);
        /** @type {{ code?: string }} */ (error).code = 'EMKDIRCREATEDPATH';
        throw error;
    }
    const chain = [first];
    let current = first;
    for (const segment of relative.split(path.sep).filter(Boolean)) {
        current = path.join(current, segment);
        chain.push(current);
    }
    return chain;
}

/**
 * @param {string} dirPath
 * @param {{
 *     recursive?: boolean;
 *     mode?: number;
 *     durability?: IoDurabilityMode;
 *     onPhase?: (phase: string, details: Record<string, unknown>) => void | Promise<void>;
 *     syncDirectory?: typeof syncParentDirectoryBestEffort;
 * }} [options]
 * @returns {Promise<{
 *     path: string;
 *     created: boolean;
 *     createdPath: string | undefined;
 *     durability: {
 *         durability: IoDurabilityMode;
 *         directorySyncs: Array<{
 *             target: string;
 *             result: Awaited<ReturnType<typeof syncParentDirectoryBestEffort>>;
 *         }>;
 *     };
 * }>}
 */
export async function mkdirPathUnlocked(dirPath, options = {}) {
    const recursive = Boolean(options.recursive);
    const durability = normalizeIoDurability(options.durability);
    const createdPath = await mkdir(
        dirPath,
        options.mode === undefined ? { recursive } : { recursive, mode: options.mode },
    );
    // With recursive=false Node resolves undefined on success; success itself proves creation because EEXIST would reject.
    const created = recursive ? createdPath !== undefined : true;
    const createdPaths = created ? createdDirectoryChain(dirPath, createdPath, recursive) : [];
    /** @type {Array<{ target: string; result: Awaited<ReturnType<typeof syncParentDirectoryBestEffort>> }>} */
    const directorySyncs = [];

    if (created && shouldSyncDirectory(durability)) {
        try {
            for (const target of createdPaths) {
                await emitMutationPhase(options, 'before-parent-directory-sync', { dirPath, target });
                const result = await (options.syncDirectory ?? syncParentDirectoryBestEffort)(target);
                await emitMutationPhase(options, 'after-parent-directory-sync', { dirPath, target, ...result });
                assertSuccessfulSync(result, {
                    code: 'EDIRECTORYSYNC',
                    message: `Falha ao sincronizar diretório após mkdir: ${target}`,
                });
                directorySyncs.push({ target, result });
            }
        } catch (error) {
            throw markMutationAppliedError(error, {
                phase: 'mkdir-directory-sync',
                paths: createdPaths.length > 0 ? createdPaths : [path.resolve(dirPath)],
            });
        }
    }

    return {
        path: dirPath,
        created,
        createdPath,
        durability: {
            durability,
            directorySyncs,
        },
    };
}
