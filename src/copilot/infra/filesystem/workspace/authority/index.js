// @ts-check
/** @module copilot/infra/filesystem/workspace/authority */
/** @typedef {import('./service.js').ValidatedReadWorkspacePath} ValidatedReadWorkspacePath */
/** @typedef {import('./service.js').ValidatedMutableWorkspacePath} ValidatedMutableWorkspacePath */
/** @typedef {import('./service.js').WorkspacePathAuthority} WorkspacePathAuthority */
/** @typedef {import('./service.js').WorkspacePathAuthorityContext} WorkspacePathAuthorityContext */
export {
    createWorkspacePathAuthority,
    getValidatedMutableWorkspacePathStats,
    getValidatedReadWorkspacePathStats,
    getWorkspacePathAuthorityStats,
    resolveValidatedMutableWorkspacePath,
    resolveValidatedReadWorkspacePath,
    resolveWorkspacePathAuthority,
} from './service.js';
