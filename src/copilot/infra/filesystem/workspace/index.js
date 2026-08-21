// @ts-check
/** @module copilot/infra/filesystem/workspace */

/** @typedef {import('./boundary/index.js').WorkspaceIoContext} WorkspaceIoContext */
/** @typedef {import('./authority/index.js').ValidatedReadWorkspacePath} ValidatedReadWorkspacePath */
/** @typedef {import('./authority/index.js').ValidatedMutableWorkspacePath} ValidatedMutableWorkspacePath */
/** @typedef {import('./authority/index.js').WorkspacePathAuthority} WorkspacePathAuthority */
/** @typedef {import('./authority/index.js').WorkspacePathAuthorityContext} WorkspacePathAuthorityContext */

export {
    createWorkspacePathAuthority,
    getValidatedMutableWorkspacePathStats,
    getValidatedReadWorkspacePathStats,
    resolveValidatedMutableWorkspacePath,
    resolveValidatedReadWorkspacePath,
    resolveWorkspacePathAuthority,
} from './authority/index.js';
export { assertWorkspaceIoContext, requireValidatedWorkspaceReadPath, resolveWorkspacePath } from './boundary/index.js';
export { createWorkspaceIo } from './io.js';
export { createWorkspaceMutationIo } from './mutation-io/index.js';
export { createWorkspaceReadIo } from './read-io/index.js';
