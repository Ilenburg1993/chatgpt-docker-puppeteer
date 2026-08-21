// @ts-check
/**
 * Combined workspace IO facade for consumers that genuinely need both read and mutation capabilities.
 * Read-only and mutation-only consumers should use the narrower factories so their static closures remain bounded.
 *
 * @module copilot/infra/filesystem/workspace/io
 */

import { resolveWorkspacePathAuthority } from './authority/index.js';
import { createWorkspaceMutationIo } from './mutation-io/index.js';
import { createWorkspaceReadIo } from './read-io/index.js';

/** @typedef {import('./boundary/index.js').WorkspaceIoContext} WorkspaceIoContext */
/** @typedef {import('./authority/index.js').WorkspacePathAuthority} WorkspacePathAuthority */

/** @param {WorkspaceIoContext | WorkspacePathAuthority} input @param {Parameters<typeof createWorkspaceReadIo>[1] & Parameters<typeof createWorkspaceMutationIo>[1]} [options] */
export function createWorkspaceIo(input, options = {}) {
    const authority = resolveWorkspacePathAuthority(input);
    return Object.freeze({
        ...createWorkspaceReadIo(authority, options),
        ...createWorkspaceMutationIo(authority, options),
    });
}
