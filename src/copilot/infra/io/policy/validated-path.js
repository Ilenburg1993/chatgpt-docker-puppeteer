// @ts-check
/**
 * Opaque read-only workspace-path capability.
 *
 * The capability is issued only after the canonical async path policy has already resolved symlinks and verified
 * containment. Workspace-bound read/search/stat adapters can consume it without repeating the same realpath walk. Plain
 * objects cannot forge the module-private brand. Mutable modes never accept this capability.
 *
 * @module copilot/infra/io/policy/validated-path
 */

import { IO_PATH_POLICY_VERSION } from '#copilot/core';
import path from 'node:path';

const VALIDATED_READ_PATH_BRAND = Symbol('copilot.validated-read-workspace-path');
const VALIDATED_MUTABLE_PATH_BRAND = Symbol('copilot.validated-mutable-workspace-path');
const READ_ONLY_MODES = new Set(['read', 'search', 'stat', 'scan']);
// Initial mutable fast path is intentionally narrower than the current core write-policy equivalence class.
// Pair/destructive operations keep full policy evaluation until their additional invariants are migrated explicitly.
const VALIDATED_MUTABLE_MODES = new Set(['write', 'patch', 'metadata']);

const readStats = {
    issued: 0,
    accepted: 0,
    rejectedUnbranded: 0,
    rejectedWorkspace: 0,
    rejectedMode: 0,
};

const mutableStats = {
    issued: 0,
    accepted: 0,
    rejectedUnbranded: 0,
    rejectedWorkspace: 0,
    rejectedMode: 0,
};

/**
 * @typedef {{
 *     readonly realPath: string;
 *     readonly workspaceRoot: string;
 *     readonly policyVersion: string;
 *     readonly access: 'read-only';
 * }} ValidatedReadWorkspacePathPublic
 *
 *
 * @typedef {ValidatedReadWorkspacePathPublic & { readonly [VALIDATED_READ_PATH_BRAND]: true }} ValidatedReadWorkspacePath
 *
 *
 * @typedef {{
 *     readonly realPath: string;
 *     readonly workspaceRoot: string;
 *     readonly policyVersion: string;
 *     readonly access: 'mutable';
 *     readonly policyClass: 'write';
 * }} ValidatedMutableWorkspacePathPublic
 *
 *
 * @typedef {ValidatedMutableWorkspacePathPublic & { readonly [VALIDATED_MUTABLE_PATH_BRAND]: true }} ValidatedMutableWorkspacePath
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
        [VALIDATED_READ_PATH_BRAND]: /** @type {const} */ (true),
        realPath: path.resolve(input.realPath),
        workspaceRoot: path.resolve(input.workspaceRoot),
        policyVersion: IO_PATH_POLICY_VERSION,
        access: /** @type {const} */ ('read-only'),
    };
    readStats.issued += 1;
    return Object.freeze(capability);
}

/**
 * Issue a mutable capability only after canonical async `write` policy validation has resolved the target. The initial
 * consumer set is intentionally limited to single-target write/patch operations.
 *
 * @param {{ realPath: string; workspaceRoot: string }} input
 * @returns {ValidatedMutableWorkspacePath}
 */
export function createValidatedMutableWorkspacePath(input) {
    /** @type {ValidatedMutableWorkspacePath} */
    const capability = {
        [VALIDATED_MUTABLE_PATH_BRAND]: /** @type {const} */ (true),
        realPath: path.resolve(input.realPath),
        workspaceRoot: path.resolve(input.workspaceRoot),
        policyVersion: IO_PATH_POLICY_VERSION,
        access: /** @type {const} */ ('mutable'),
        policyClass: /** @type {const} */ ('write'),
    };
    mutableStats.issued += 1;
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
    if (!candidate || candidate[VALIDATED_READ_PATH_BRAND] !== true) {
        readStats.rejectedUnbranded += 1;
        throw capabilityError('Workspace IO received an unbranded validated-path object.', 'EINVALIDVALIDATEDPATH');
    }
    const capability = /** @type {ValidatedReadWorkspacePath} */ (value);
    if (!READ_ONLY_MODES.has(context.mode)) {
        readStats.rejectedMode += 1;
        throw capabilityError(
            `Validated read capability cannot be used for workspace mode ${context.mode}.`,
            'EVALIDATEDPATHMODE',
        );
    }
    if (path.resolve(context.workspaceRoot) !== capability.workspaceRoot) {
        readStats.rejectedWorkspace += 1;
        throw capabilityError('Validated read capability belongs to a different workspace.', 'EVALIDATEDPATHWORKSPACE');
    }
    if (capability.policyVersion !== IO_PATH_POLICY_VERSION || capability.access !== 'read-only') {
        readStats.rejectedUnbranded += 1;
        throw capabilityError(
            'Validated read capability policy version/access is stale or invalid.',
            'EINVALIDVALIDATEDPATH',
        );
    }
    readStats.accepted += 1;
    return capability.realPath;
}

/**
 * Resolve a branded mutable capability for a compatible single-target mutation. Strings return null so legacy callers
 * can continue through the full canonical policy path.
 *
 * @param {unknown} value
 * @param {{ workspaceRoot: string; mode: string }} context
 * @returns {string | null}
 */
export function resolveValidatedMutableWorkspacePath(value, context) {
    if (typeof value === 'string') return null;
    const candidate = value && typeof value === 'object' ? /** @type {Record<PropertyKey, unknown>} */ (value) : null;
    if (!candidate || candidate[VALIDATED_MUTABLE_PATH_BRAND] !== true) {
        mutableStats.rejectedUnbranded += 1;
        throw capabilityError(
            'Workspace IO received an unbranded mutable validated-path object.',
            'EINVALIDVALIDATEDMUTABLEPATH',
        );
    }
    const capability = /** @type {ValidatedMutableWorkspacePath} */ (value);
    if (!VALIDATED_MUTABLE_MODES.has(context.mode)) {
        mutableStats.rejectedMode += 1;
        throw capabilityError(
            `Validated mutable capability cannot be used for workspace mode ${context.mode}.`,
            'EVALIDATEDMUTABLEPATHMODE',
        );
    }
    if (path.resolve(context.workspaceRoot) !== capability.workspaceRoot) {
        mutableStats.rejectedWorkspace += 1;
        throw capabilityError(
            'Validated mutable capability belongs to a different workspace.',
            'EVALIDATEDMUTABLEPATHWORKSPACE',
        );
    }
    if (
        capability.policyVersion !== IO_PATH_POLICY_VERSION ||
        capability.access !== 'mutable' ||
        capability.policyClass !== 'write'
    ) {
        mutableStats.rejectedUnbranded += 1;
        throw capabilityError(
            'Validated mutable capability policy version/access/class is stale or invalid.',
            'EINVALIDVALIDATEDMUTABLEPATH',
        );
    }
    mutableStats.accepted += 1;
    return capability.realPath;
}

export function getValidatedReadWorkspacePathStats() {
    return { ...readStats, compatibleModes: [...READ_ONLY_MODES], policyVersion: IO_PATH_POLICY_VERSION };
}

export function getValidatedMutableWorkspacePathStats() {
    return { ...mutableStats, compatibleModes: [...VALIDATED_MUTABLE_MODES], policyVersion: IO_PATH_POLICY_VERSION };
}

export function resetValidatedReadWorkspacePathStatsForTest() {
    for (const key of Object.keys(readStats)) readStats[/** @type {keyof typeof readStats} */ (key)] = 0;
}

export function resetValidatedMutableWorkspacePathStatsForTest() {
    for (const key of Object.keys(mutableStats)) mutableStats[/** @type {keyof typeof mutableStats} */ (key)] = 0;
}

/** @param {string} message @param {string} code */
function capabilityError(message, code) {
    const error = /** @type {Error & { code?: string }} */ (new Error(message));
    error.code = code;
    return error;
}
