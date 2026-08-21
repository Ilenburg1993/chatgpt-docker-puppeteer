// @ts-check
/** @module copilot/infra/filesystem/workspace */

/** @typedef {import('./path-boundary.js').WorkspaceIoContext} WorkspaceIoContext */
/** @typedef {import('./validated-path.js').ValidatedReadWorkspacePath} ValidatedReadWorkspacePath */
/** @typedef {import('./validated-path.js').ValidatedMutableWorkspacePath} ValidatedMutableWorkspacePath */

export { createWorkspaceIo } from './io.js';
export { assertWorkspaceIoContext, requireValidatedWorkspaceReadPath, resolveWorkspacePath } from './path-boundary.js';
export {
    createValidatedMutableWorkspacePath,
    createValidatedReadWorkspacePath,
    getValidatedMutableWorkspacePathStats,
    getValidatedReadWorkspacePathStats,
    resolveValidatedMutableWorkspacePath,
    resolveValidatedReadWorkspacePath,
} from './validated-path.js';
