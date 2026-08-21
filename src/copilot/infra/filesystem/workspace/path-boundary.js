// @ts-check
/**
 * Canonical workspace path authorization boundary shared by workspace-scoped capabilities.
 *
 * This module owns policy evaluation and opaque validated-read capability consumption. It deliberately does not perform
 * filesystem or indexing operations; higher capabilities compose their own operations on top of these resolved paths.
 *
 * @module copilot/infra/filesystem/workspace/path-boundary
 */

import { evaluateIoPathPolicyAsync } from '#copilot/core';
import { resolveValidatedReadWorkspacePath } from './validated-path.js';

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
    const result = await evaluateIoPathPolicyAsync(filePath, {
        workspaceRoot: context.workspaceRoot,
        ...(context.blockedSegments ? { blockedSegments: context.blockedSegments } : {}),
        mode,
    });
    if (result.ok) return result.realPath;

    const error = /** @type {Error & { code?: string; policyVersion?: string }} */ (
        new Error(`Workspace IO denied: ${result.reason}`)
    );
    error.code = result.code;
    error.policyVersion = result.policyVersion;
    throw error;
}

/**
 * Resolve an opaque validated read capability or reject plain/untrusted values with the same contract used by the
 * workspace filesystem facade.
 *
 * @param {unknown} capability
 * @param {'read' | 'search' | 'stat' | 'scan'} mode
 * @param {WorkspaceIoContext} context
 * @returns {string}
 */
export function requireValidatedWorkspaceReadPath(capability, mode, context) {
    assertWorkspaceIoContext(context);
    const resolvedPath = resolveValidatedReadWorkspacePath(capability, {
        workspaceRoot: context.workspaceRoot,
        mode,
    });
    if (resolvedPath) return resolvedPath;

    const error = /** @type {Error & { code?: string }} */ (
        new Error('Validated workspace read method requires an opaque validated-path capability.')
    );
    error.code = 'EVALIDATEDPATHREQUIRED';
    throw error;
}
