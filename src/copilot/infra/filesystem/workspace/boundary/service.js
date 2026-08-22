// @ts-check
/**
 * Canonical workspace path authorization boundary shared by workspace-scoped capabilities.
 *
 * This module owns policy evaluation and opaque validated-read capability consumption. It deliberately does not perform
 * filesystem or indexing operations; higher capabilities compose their own operations on top of these resolved paths.
 *
 * @module copilot/infra/filesystem/workspace/boundary/service
 */

import { resolveValidatedReadWorkspacePath } from '../authority/index.js';
import { evaluateWorkspacePathPolicyAsync } from '../path-policy/index.js';

/**
 * @typedef {'append' | 'copy' | 'delete' | 'metadata' | 'mkdir' | 'move' | 'patch' | 'read' | 'scan' | 'search' | 'stat' | 'write'} WorkspaceIoMode
 * @typedef {{ workspaceRoot: string; blockedSegments?: readonly string[] }} WorkspaceIoContext
 */

/** @param {WorkspaceIoContext} context */
export function assertWorkspaceIoContext(context) {
    if (typeof context?.workspaceRoot !== 'string' || context.workspaceRoot.trim().length === 0) {
        throw new TypeError('Workspace capability requires a non-empty workspaceRoot');
    }
}

/**
 * Run the canonical asynchronous path policy and return the resolved real path.
 *
 * @param {string} filePath
 * @param {WorkspaceIoMode} mode
 * @param {WorkspaceIoContext} context
 * @returns {Promise<string>}
 */
export async function resolveWorkspacePath(filePath, mode, context) {
    assertWorkspaceIoContext(context);
    const result = await evaluateWorkspacePathPolicyAsync(filePath, {
        workspaceRoot: context.workspaceRoot,
        ...(context.blockedSegments?.length ? { blockedSegments: context.blockedSegments } : {}),
        mode,
    });
    if (result.ok) return result.realPath;
    throw workspacePolicyError(result);
}

/**
 * Authorize a metadata path while preserving the final filesystem entry for lstat-style inspection.
 * Ancestor symlinks are still canonicalized and must remain inside the workspace.
 *
 * @param {string} filePath
 * @param {WorkspaceIoContext} context
 * @returns {Promise<string>}
 */
export async function resolveWorkspaceLstatPath(filePath, context) {
    assertWorkspaceIoContext(context);
    const result = await evaluateWorkspacePathPolicyAsync(filePath, {
        workspaceRoot: context.workspaceRoot,
        ...(context.blockedSegments?.length ? { blockedSegments: context.blockedSegments } : {}),
        mode: 'stat',
        preserveFinalSymlink: true,
    });
    if (result.ok) return result.realPath;
    throw workspacePolicyError(result);
}

/** @param {import('#copilot/infra/internal/policy').WorkspacePathPolicyFailure} result */
function workspacePolicyError(result) {
    const error = /** @type {Error & { code?: string; policyVersion?: string }} */ (
        new Error(`Workspace IO denied: ${result.reason}`)
    );
    error.code = result.code;
    error.policyVersion = result.policyVersion;
    return error;
}

/**
 * Resolve an opaque validated read capability or reject plain/untrusted values with the same contract used by the
 * workspace filesystem facade.
 *
 * @param {unknown} capability
 * @param {'read' | 'search' | 'stat' | 'scan'} mode
 * @param {import('../authority/index.js').WorkspacePathAuthority} authority
 * @returns {string}
 */
export function requireValidatedWorkspaceReadPath(capability, mode, authority) {
    const resolvedPath = resolveValidatedReadWorkspacePath(capability, authority, mode);
    if (resolvedPath) return resolvedPath;

    const error = /** @type {Error & { code?: string }} */ (
        new Error('Validated workspace read method requires an opaque validated-path capability.')
    );
    error.code = 'EVALIDATEDPATHREQUIRED';
    throw error;
}
