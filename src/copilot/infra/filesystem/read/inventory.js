// @ts-check
/**
 * Regular-file inventory projection built on the canonical governed workspace walker.
 *
 * The physical traversal, path policy, hidden-path handling and symlink non-traversal live in walk.js. This owner only
 * narrows that structural result to regular files for inventory consumers.
 *
 * @module copilot/infra/filesystem/read/inventory
 */

import { walkWorkspaceEntriesFresh } from './walk.js';

/**
 * @typedef {{
 *   workspaceRoot?: string;
 *   signal?: AbortSignal;
 *   hardMaxEntries?: number;
 * }} RegularFileInventoryOptions
 */

/**
 * @param {string} rootPath
 * @param {RegularFileInventoryOptions} [options]
 */
export async function listRegularFilesFresh(rootPath, options = {}) {
    const structural = await walkWorkspaceEntriesFresh(rootPath, {
        ...(options.workspaceRoot ? { workspaceRoot: options.workspaceRoot } : {}),
        recursive: true,
        showHidden: false,
        includeSymlinks: false,
        ...(options.hardMaxEntries === undefined ? {} : { hardMaxEntries: options.hardMaxEntries }),
        ...(options.signal ? { signal: options.signal } : {}),
    });
    const files = Object.freeze(
        structural.entries.filter((entry) => entry.type === 'file').map((entry) => entry.path),
    );
    return Object.freeze({
        files,
        fileCount: files.length,
        enumeratedEntries: structural.visitedEntries,
        protectedBranchesPruned: structural.protectedEntriesPruned,
        hiddenEntriesPruned: structural.hiddenEntriesPruned,
        symlinksPruned: structural.symlinksObserved,
        engine: structural.engine,
        traversal: structural.traversal,
        pathProjection: structural.pathProjection,
    });
}
