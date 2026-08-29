// @ts-check
/**
 * Structural workspace-tree enumeration built on the canonical governed read walker.
 *
 * @module copilot/infra/filesystem/read/tree
 */

import { walkWorkspaceEntriesFresh } from './walk.js';

/**
 * @param {string} rootPath
 * @param {{workspaceRoot?:string;recursive?:boolean;depth?:number;showHidden?:boolean;includeSymlinks?:boolean;includePattern?:string;excludePattern?:string;hardMaxEntries?:number;signal?:AbortSignal}} [options]
 */
export async function listWorkspaceTreeEntriesFresh(rootPath, options = {}) {
    return walkWorkspaceEntriesFresh(rootPath, options);
}
