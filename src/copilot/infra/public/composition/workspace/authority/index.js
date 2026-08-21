// @ts-check
/**
 * Composition-only workspace path-authority issuer.
 * @module copilot/infra/public/composition/workspace/authority
 */

/** @typedef {import('../../../../filesystem/workspace/authority/index.js').ValidatedReadWorkspacePath} ValidatedReadWorkspacePath */
/** @typedef {import('../../../../filesystem/workspace/authority/index.js').ValidatedMutableWorkspacePath} ValidatedMutableWorkspacePath */
/** @typedef {import('../../../../filesystem/workspace/authority/index.js').WorkspacePathAuthority} WorkspacePathAuthority */
/** @typedef {import('../../../../filesystem/workspace/authority/index.js').WorkspacePathAuthorityContext} WorkspacePathAuthorityContext */

export { createWorkspacePathAuthority } from '../../../../filesystem/workspace/authority/index.js';
