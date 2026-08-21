// @ts-check
/**
 * Workspace path authority and opaque validated-path capabilities.
 *
 * Capability issuance is deliberately closed over the canonical asynchronous path policy. There is no exported raw
 * constructor that accepts `{ realPath, workspaceRoot }`: callers can only obtain a token after this authority has
 * successfully evaluated the requested path. Tokens are also bound to the exact authority instance that issued them,
 * so a token minted for one WorkspaceAuthority cannot be replayed against another workspace/runtime instance even when
 * both instances happen to point at the same filesystem root.
 *
 * @module copilot/infra/filesystem/workspace/authority/service
 */

import { IO_PATH_POLICY_VERSION, evaluateIoPathPolicyAsync } from '#copilot/core';
import path from 'node:path';

const VALIDATED_READ_PATH_BRAND = Symbol('copilot.validated-read-workspace-path');
const VALIDATED_MUTABLE_PATH_BRAND = Symbol('copilot.validated-mutable-workspace-path');
const AUTHORITY_TOKEN = Symbol('copilot.workspace-path-authority-token');
const authorityInternals = new WeakMap();
const READ_ONLY_MODES = new Set(['read', 'search', 'stat', 'scan']);
const MUTABLE_AUTHORIZATION_MODES = new Set(['write', 'patch', 'metadata']);
// Consumption intentionally remains narrower than the core write-policy equivalence class.
const VALIDATED_MUTABLE_MODES = new Set(['write', 'patch', 'metadata']);

const readStats = {
    issued: 0,
    accepted: 0,
    rejectedUnbranded: 0,
    rejectedAuthority: 0,
    rejectedWorkspace: 0,
    rejectedMode: 0,
};

const mutableStats = {
    issued: 0,
    accepted: 0,
    rejectedUnbranded: 0,
    rejectedAuthority: 0,
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
 * @typedef {ValidatedReadWorkspacePathPublic & {
 *     readonly [VALIDATED_READ_PATH_BRAND]: true;
 *     readonly [AUTHORITY_TOKEN]: symbol;
 * }} ValidatedReadWorkspacePath
 *
 * @typedef {{
 *     readonly realPath: string;
 *     readonly workspaceRoot: string;
 *     readonly policyVersion: string;
 *     readonly access: 'mutable';
 *     readonly policyClass: 'write';
 * }} ValidatedMutableWorkspacePathPublic
 * @typedef {ValidatedMutableWorkspacePathPublic & {
 *     readonly [VALIDATED_MUTABLE_PATH_BRAND]: true;
 *     readonly [AUTHORITY_TOKEN]: symbol;
 * }} ValidatedMutableWorkspacePath
 *
 * @typedef {{ workspaceRoot: string; blockedSegments?: readonly string[] }} WorkspacePathAuthorityContext
 * @typedef {{
 *     readonly workspaceRoot: string;
 *     readonly blockedSegments: readonly string[];
 *     resolvePath(filePath: string, mode: 'append'|'copy'|'delete'|'fetch'|'metadata'|'mkdir'|'move'|'patch'|'read'|'scan'|'search'|'stat'|'write'): Promise<string>;
 *     authorizeRead(filePath: string, mode?: 'read' | 'search' | 'stat' | 'scan'): Promise<ValidatedReadWorkspacePath>;
 *     authorizeMutation(filePath: string, mode?: 'write' | 'patch' | 'metadata'): Promise<ValidatedMutableWorkspacePath>;
 * }} WorkspacePathAuthority
 * @typedef {{
 *     authorityId: symbol;
 *     context: Readonly<{ workspaceRoot: string; blockedSegments: readonly string[] }>;
 * }} WorkspacePathAuthorityInternals
 */

/**
 * Create one workspace-bound authorization authority.
 *
 * The returned object exposes policy-backed authorization only. Issuance and verification remain module-private, while
 * sibling/internal consumers obtain the verifier through `resolveValidated*` using the authority object itself.
 *
 * @param {WorkspacePathAuthorityContext} context
 * @returns {WorkspacePathAuthority}
 */
export function createWorkspacePathAuthority(context) {
    assertAuthorityContext(context);
    const workspaceRoot = path.resolve(context.workspaceRoot);
    const blockedSegments = Object.freeze([...(context.blockedSegments ?? [])]);
    const authorityId = Symbol(`copilot.workspace-path-authority:${workspaceRoot}`);
    const authorityContext = Object.freeze({ workspaceRoot, blockedSegments });

    /**
     * @param {string} filePath
     * @param {'append'|'copy'|'delete'|'fetch'|'metadata'|'mkdir'|'move'|'patch'|'read'|'scan'|'search'|'stat'|'write'} mode
     */
    async function evaluate(filePath, mode) {
        const result = await evaluateIoPathPolicyAsync(filePath, {
            workspaceRoot,
            ...(blockedSegments.length > 0 ? { blockedSegments } : {}),
            mode,
        });
        if (result.ok) return result;
        throw policyError(result.reason, result.code, result.policyVersion);
    }

    /** @type {WorkspacePathAuthority} */
    const authority = Object.freeze({
        workspaceRoot,
        blockedSegments,
        async resolvePath(filePath, mode) {
            const result = await evaluate(filePath, mode);
            return result.realPath;
        },
        async authorizeRead(filePath, mode = 'read') {
            if (!READ_ONLY_MODES.has(mode)) {
                throw capabilityError(`Workspace read authority cannot authorize mode ${mode}.`, 'EVALIDATEDPATHMODE');
            }
            return issueReadCapability(await evaluate(filePath, mode), authorityId);
        },
        async authorizeMutation(filePath, mode = 'write') {
            if (!MUTABLE_AUTHORIZATION_MODES.has(mode)) {
                throw capabilityError(
                    `Workspace mutable authority cannot authorize mode ${mode}.`,
                    'EVALIDATEDMUTABLEPATHMODE',
                );
            }
            return issueMutableCapability(await evaluate(filePath, mode), authorityId);
        },
    });

    authorityInternals.set(authority, { authorityId, context: authorityContext });
    return authority;
}

/**
 * Normalize either an already-created authority or a plain context into an authority. This helper is package-internal;
 * the public membrane exports only the safe authority factory itself.
 *
 * @param {WorkspacePathAuthority | WorkspacePathAuthorityContext} value
 * @returns {WorkspacePathAuthority}
 */
export function resolveWorkspacePathAuthority(value) {
    if (value && typeof value === 'object' && authorityInternals.has(/** @type {object} */ (value))) {
        return /** @type {WorkspacePathAuthority} */ (value);
    }
    return createWorkspacePathAuthority(/** @type {WorkspacePathAuthorityContext} */ (value));
}

/**
 * Resolve a branded capability for a compatible workspace read-only operation.
 *
 * @param {unknown} value
 * @param {WorkspacePathAuthority} authority
 * @param {string} mode
 * @returns {string | null}
 */
export function resolveValidatedReadWorkspacePath(value, authority, mode) {
    if (typeof value === 'string') return null;
    const internals = requireAuthorityInternals(authority);
    const candidate = value && typeof value === 'object' ? /** @type {Record<PropertyKey, unknown>} */ (value) : null;
    if (!candidate || candidate[VALIDATED_READ_PATH_BRAND] !== true) {
        readStats.rejectedUnbranded += 1;
        throw capabilityError('Workspace IO received an unbranded validated-path object.', 'EINVALIDVALIDATEDPATH');
    }
    const capability = /** @type {ValidatedReadWorkspacePath} */ (value);
    if (!READ_ONLY_MODES.has(mode)) {
        readStats.rejectedMode += 1;
        throw capabilityError(
            `Validated read capability cannot be used for workspace mode ${mode}.`,
            'EVALIDATEDPATHMODE',
        );
    }
    if (capability[AUTHORITY_TOKEN] !== internals.authorityId) {
        readStats.rejectedAuthority += 1;
        throw capabilityError(
            'Validated read capability belongs to a different workspace authority.',
            'EVALIDATEDPATHAUTHORITY',
        );
    }
    if (capability.workspaceRoot !== internals.context.workspaceRoot) {
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
 * Resolve a branded mutable capability for a compatible single-target mutation.
 *
 * @param {unknown} value
 * @param {WorkspacePathAuthority} authority
 * @param {string} mode
 * @returns {string | null}
 */
export function resolveValidatedMutableWorkspacePath(value, authority, mode) {
    if (typeof value === 'string') return null;
    const internals = requireAuthorityInternals(authority);
    const candidate = value && typeof value === 'object' ? /** @type {Record<PropertyKey, unknown>} */ (value) : null;
    if (!candidate || candidate[VALIDATED_MUTABLE_PATH_BRAND] !== true) {
        mutableStats.rejectedUnbranded += 1;
        throw capabilityError(
            'Workspace IO received an unbranded mutable validated-path object.',
            'EINVALIDVALIDATEDMUTABLEPATH',
        );
    }
    const capability = /** @type {ValidatedMutableWorkspacePath} */ (value);
    if (!VALIDATED_MUTABLE_MODES.has(mode)) {
        mutableStats.rejectedMode += 1;
        throw capabilityError(
            `Validated mutable capability cannot be used for workspace mode ${mode}.`,
            'EVALIDATEDMUTABLEPATHMODE',
        );
    }
    if (capability[AUTHORITY_TOKEN] !== internals.authorityId) {
        mutableStats.rejectedAuthority += 1;
        throw capabilityError(
            'Validated mutable capability belongs to a different workspace authority.',
            'EVALIDATEDMUTABLEPATHAUTHORITY',
        );
    }
    if (capability.workspaceRoot !== internals.context.workspaceRoot) {
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

/**
 * @param {import('#copilot/core/io-policy').IoPathPolicySuccess} result
 * @param {symbol} authorityId
 * @returns {ValidatedReadWorkspacePath}
 */
function issueReadCapability(result, authorityId) {
    /** @type {ValidatedReadWorkspacePath} */
    const capability = {
        [VALIDATED_READ_PATH_BRAND]: /** @type {const} */ (true),
        [AUTHORITY_TOKEN]: authorityId,
        realPath: path.resolve(result.realPath),
        workspaceRoot: path.resolve(result.workspaceRoot),
        policyVersion: result.policyVersion,
        access: /** @type {const} */ ('read-only'),
    };
    readStats.issued += 1;
    return Object.freeze(capability);
}

/**
 * @param {import('#copilot/core/io-policy').IoPathPolicySuccess} result
 * @param {symbol} authorityId
 * @returns {ValidatedMutableWorkspacePath}
 */
function issueMutableCapability(result, authorityId) {
    /** @type {ValidatedMutableWorkspacePath} */
    const capability = {
        [VALIDATED_MUTABLE_PATH_BRAND]: /** @type {const} */ (true),
        [AUTHORITY_TOKEN]: authorityId,
        realPath: path.resolve(result.realPath),
        workspaceRoot: path.resolve(result.workspaceRoot),
        policyVersion: result.policyVersion,
        access: /** @type {const} */ ('mutable'),
        policyClass: /** @type {const} */ ('write'),
    };
    mutableStats.issued += 1;
    return Object.freeze(capability);
}

/** @param {WorkspacePathAuthority} authority @returns {WorkspacePathAuthorityInternals} */
function requireAuthorityInternals(authority) {
    const internals = authority && typeof authority === 'object' ? authorityInternals.get(authority) : undefined;
    if (!internals) {
        throw capabilityError(
            'Workspace IO requires a genuine WorkspacePathAuthority instance.',
            'EWORKSPACEAUTHORITY',
        );
    }
    return internals;
}

/** @param {WorkspacePathAuthorityContext} context */
function assertAuthorityContext(context) {
    if (typeof context?.workspaceRoot !== 'string' || context.workspaceRoot.trim().length === 0) {
        throw new TypeError('Workspace capability requires a non-empty workspaceRoot');
    }
}

/** @param {string} reason @param {string} code @param {string} policyVersion */
function policyError(reason, code, policyVersion) {
    const error = /** @type {Error & { code?: string; policyVersion?: string; policyReason?: string }} */ (
        new Error(`Workspace IO denied: ${reason}`)
    );
    error.code = code;
    error.policyVersion = policyVersion;
    error.policyReason = reason;
    return error;
}

/** @param {string} message @param {string} code */
function capabilityError(message, code) {
    const error = /** @type {Error & { code?: string }} */ (new Error(message));
    error.code = code;
    return error;
}
