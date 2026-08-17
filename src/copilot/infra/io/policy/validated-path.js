// @ts-check
/**
 * Opaque read-only workspace-path capability.
 *
 * The capability is issued only after the canonical async path policy has already resolved symlinks and verified
 * containment. Workspace-bound read/search/stat adapters can consume it without repeating the same realpath walk.
 * Plain objects cannot forge the module-private brand. Mutable modes never accept this capability.
 *
 * @module copilot/infra/io/policy/validated-path
 */

import { IO_POLICY_VERSION } from '#copilot/core';
import path from 'node:path';

const VALIDATED_PATH_BRAND = Symbol('copilot.validated-read-workspace-path');
const READ_ONLY_MODES = new Set(['read', 'search', 'stat']);

const stats = {
    issued: 0,
    accepted: 0,
    rejectedUnbranded: 0,
    rejectedWorkspace: 0,
    rejectedMode: 0,
};

/**
 * @typedef {{
 *   readonly realPath: string;
 *   readonly workspaceRoot: string;
 *   readonly policyVersion: string;
 *   readonly access: 'read-only';
 * }} ValidatedReadWorkspacePathPublic
 *
 * @typedef {ValidatedReadWorkspacePathPublic & { readonly [VALIDATED_PATH_BRAND]: true }} ValidatedReadWorkspacePath
 */

/**
 * Issue a read-only capability after the caller has completed canonical async path validation.
 *
 * @param {{ realPath: string; workspaceRoot: string }} input
 * @returns {ValidatedReadWorkspacePath}
 */
export function createValidatedReadWorkspacePath(input) {
    /** @type {ValidatedReadWorkspacePath} */
    const capability = {
        [VALIDATED_PATH_BRAND]: /** @type {const} */ (true),
        realPath: path.resolve(input.realPath),
        workspaceRoot: path.resolve(input.workspaceRoot),
        policyVersion: IO_POLICY_VERSION,
        access: /** @type {const} */ ('read-only'),
    };
    stats.issued += 1;
    return Object.freeze(capability);
}

/**
 * Resolve a branded capability for a compatible workspace read-only operation.
 *
 * Returns null for normal strings so callers can fall back to the full canonical policy. Throws for object-shaped
 * inputs that are not valid capabilities, preventing accidental trust of user-provided lookalikes.
 *
 * @param {unknown} value
 * @param {{ workspaceRoot: string; mode: string }} context
 * @returns {string | null}
 */
export function resolveValidatedReadWorkspacePath(value, context) {
    if (typeof value === 'string') return null;
    const candidate = value && typeof value === 'object' ? /** @type {Record<PropertyKey, unknown>} */ (value) : null;
    if (!candidate || candidate[VALIDATED_PATH_BRAND] !== true) {
        stats.rejectedUnbranded += 1;
        throw capabilityError('Workspace IO received an unbranded validated-path object.', 'EINVALIDVALIDATEDPATH');
    }
    const capability = /** @type {ValidatedReadWorkspacePath} */ (value);
    if (!READ_ONLY_MODES.has(context.mode)) {
        stats.rejectedMode += 1;
        throw capabilityError(
            `Validated read capability cannot be used for workspace mode ${context.mode}.`,
            'EVALIDATEDPATHMODE',
        );
    }
    if (path.resolve(context.workspaceRoot) !== capability.workspaceRoot) {
        stats.rejectedWorkspace += 1;
        throw capabilityError('Validated read capability belongs to a different workspace.', 'EVALIDATEDPATHWORKSPACE');
    }
    if (capability.policyVersion !== IO_POLICY_VERSION || capability.access !== 'read-only') {
        stats.rejectedUnbranded += 1;
        throw capabilityError('Validated read capability policy version/access is stale or invalid.', 'EINVALIDVALIDATEDPATH');
    }
    stats.accepted += 1;
    return capability.realPath;
}

export function getValidatedReadWorkspacePathStats() {
    return { ...stats, compatibleModes: [...READ_ONLY_MODES], policyVersion: IO_POLICY_VERSION };
}

export function resetValidatedReadWorkspacePathStatsForTest() {
    for (const key of Object.keys(stats)) stats[/** @type {keyof typeof stats} */ (key)] = 0;
}

/** @param {string} message @param {string} code */
function capabilityError(message, code) {
    const error = /** @type {Error & { code?: string }} */ (new Error(message));
    error.code = code;
    return error;
}
