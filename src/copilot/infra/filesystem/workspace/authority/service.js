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

import { IO_PATH_POLICY_VERSION } from '#copilot/infra/internal/policy/workspace-path';
import path from 'node:path';
import { evaluateWorkspacePathPolicyAsync } from '../path-policy/index.js';

const VALIDATED_READ_PATH_BRAND = Symbol('copilot.validated-read-workspace-path');
const VALIDATED_MUTABLE_PATH_BRAND = Symbol('copilot.validated-mutable-workspace-path');
const AUTHORITY_TOKEN = Symbol('copilot.workspace-path-authority-token');
const authorityInternals = new WeakMap();
const READ_ONLY_MODES = new Set(['read', 'search', 'stat', 'scan']);
const MUTABLE_AUTHORIZATION_MODES = new Set(['write', 'patch', 'metadata']);
// Consumption intentionally remains narrower than the core write-policy equivalence class.
const VALIDATED_MUTABLE_MODES = new Set(['write', 'patch', 'metadata']);

/** @typedef {{issued:number;accepted:number;rejectedUnbranded:number;rejectedAuthority:number;rejectedWorkspace:number;rejectedMode:number}} CapabilityStats */
/** @typedef {keyof CapabilityStats} CapabilityStatKey */

/** @returns {CapabilityStats} */
function createCapabilityStats() {
    return {
        issued: 0,
        accepted: 0,
        rejectedUnbranded: 0,
        rejectedAuthority: 0,
        rejectedWorkspace: 0,
        rejectedMode: 0,
    };
}

const aggregateReadStats = createCapabilityStats();
const aggregateMutableStats = createCapabilityStats();

/** @param {CapabilityStats} aggregate @param {CapabilityStats} local @param {CapabilityStatKey} key */
function recordCapabilityStat(aggregate, local, key) {
    aggregate[key] += 1;
    local[key] += 1;
}

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
 *     stats: { read: CapabilityStats; mutable: CapabilityStats };
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
    const authorityStats = { read: createCapabilityStats(), mutable: createCapabilityStats() };

    /**
     * @param {string} filePath
     * @param {'append'|'copy'|'delete'|'fetch'|'metadata'|'mkdir'|'move'|'patch'|'read'|'scan'|'search'|'stat'|'write'} mode
     */
    async function evaluate(filePath, mode) {
        const result = await evaluateWorkspacePathPolicyAsync(filePath, {
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
            return issueReadCapability(await evaluate(filePath, mode), authorityId, authorityStats.read);
        },
        async authorizeMutation(filePath, mode = 'write') {
            if (!MUTABLE_AUTHORIZATION_MODES.has(mode)) {
                throw capabilityError(
                    `Workspace mutable authority cannot authorize mode ${mode}.`,
                    'EVALIDATEDMUTABLEPATHMODE',
                );
            }
            return issueMutableCapability(await evaluate(filePath, mode), authorityId, authorityStats.mutable);
        },
    });

    authorityInternals.set(authority, { authorityId, context: authorityContext, stats: authorityStats });
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
        recordCapabilityStat(aggregateReadStats, internals.stats.read, 'rejectedUnbranded');
        throw capabilityError('Workspace IO received an unbranded validated-path object.', 'EINVALIDVALIDATEDPATH');
    }
    const capability = /** @type {ValidatedReadWorkspacePath} */ (value);
    if (!READ_ONLY_MODES.has(mode)) {
        recordCapabilityStat(aggregateReadStats, internals.stats.read, 'rejectedMode');
        throw capabilityError(
            `Validated read capability cannot be used for workspace mode ${mode}.`,
            'EVALIDATEDPATHMODE',
        );
    }
    if (capability[AUTHORITY_TOKEN] !== internals.authorityId) {
        recordCapabilityStat(aggregateReadStats, internals.stats.read, 'rejectedAuthority');
        throw capabilityError(
            'Validated read capability belongs to a different workspace authority.',
            'EVALIDATEDPATHAUTHORITY',
        );
    }
    if (capability.workspaceRoot !== internals.context.workspaceRoot) {
        recordCapabilityStat(aggregateReadStats, internals.stats.read, 'rejectedWorkspace');
        throw capabilityError('Validated read capability belongs to a different workspace.', 'EVALIDATEDPATHWORKSPACE');
    }
    if (capability.policyVersion !== IO_PATH_POLICY_VERSION || capability.access !== 'read-only') {
        recordCapabilityStat(aggregateReadStats, internals.stats.read, 'rejectedUnbranded');
        throw capabilityError(
            'Validated read capability policy version/access is stale or invalid.',
            'EINVALIDVALIDATEDPATH',
        );
    }
    recordCapabilityStat(aggregateReadStats, internals.stats.read, 'accepted');
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
        recordCapabilityStat(aggregateMutableStats, internals.stats.mutable, 'rejectedUnbranded');
        throw capabilityError(
            'Workspace IO received an unbranded mutable validated-path object.',
            'EINVALIDVALIDATEDMUTABLEPATH',
        );
    }
    const capability = /** @type {ValidatedMutableWorkspacePath} */ (value);
    if (!VALIDATED_MUTABLE_MODES.has(mode)) {
        recordCapabilityStat(aggregateMutableStats, internals.stats.mutable, 'rejectedMode');
        throw capabilityError(
            `Validated mutable capability cannot be used for workspace mode ${mode}.`,
            'EVALIDATEDMUTABLEPATHMODE',
        );
    }
    if (capability[AUTHORITY_TOKEN] !== internals.authorityId) {
        recordCapabilityStat(aggregateMutableStats, internals.stats.mutable, 'rejectedAuthority');
        throw capabilityError(
            'Validated mutable capability belongs to a different workspace authority.',
            'EVALIDATEDMUTABLEPATHAUTHORITY',
        );
    }
    if (capability.workspaceRoot !== internals.context.workspaceRoot) {
        recordCapabilityStat(aggregateMutableStats, internals.stats.mutable, 'rejectedWorkspace');
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
        recordCapabilityStat(aggregateMutableStats, internals.stats.mutable, 'rejectedUnbranded');
        throw capabilityError(
            'Validated mutable capability policy version/access/class is stale or invalid.',
            'EINVALIDVALIDATEDMUTABLEPATH',
        );
    }
    recordCapabilityStat(aggregateMutableStats, internals.stats.mutable, 'accepted');
    return capability.realPath;
}

export function getValidatedReadWorkspacePathStats() {
    return { ...aggregateReadStats, compatibleModes: [...READ_ONLY_MODES], policyVersion: IO_PATH_POLICY_VERSION };
}

export function getValidatedMutableWorkspacePathStats() {
    return {
        ...aggregateMutableStats,
        compatibleModes: [...VALIDATED_MUTABLE_MODES],
        policyVersion: IO_PATH_POLICY_VERSION,
    };
}

/** @param {WorkspacePathAuthority} authority */
export function getWorkspacePathAuthorityStats(authority) {
    const internals = requireAuthorityInternals(authority);
    return Object.freeze({
        read: Object.freeze({
            ...internals.stats.read,
            compatibleModes: Object.freeze([...READ_ONLY_MODES]),
            policyVersion: IO_PATH_POLICY_VERSION,
        }),
        mutable: Object.freeze({
            ...internals.stats.mutable,
            compatibleModes: Object.freeze([...VALIDATED_MUTABLE_MODES]),
            policyVersion: IO_PATH_POLICY_VERSION,
        }),
    });
}

export function resetValidatedReadWorkspacePathStatsForTest() {
    for (const key of Object.keys(aggregateReadStats)) aggregateReadStats[/** @type {CapabilityStatKey} */ (key)] = 0;
}

export function resetValidatedMutableWorkspacePathStatsForTest() {
    for (const key of Object.keys(aggregateMutableStats))
        aggregateMutableStats[/** @type {CapabilityStatKey} */ (key)] = 0;
}

/**
 * @param {import('#copilot/infra/internal/policy').WorkspacePathPolicySuccess} result
 * @param {symbol} authorityId
 * @param {CapabilityStats} localStats
 * @returns {ValidatedReadWorkspacePath}
 */
function issueReadCapability(result, authorityId, localStats) {
    /** @type {ValidatedReadWorkspacePath} */
    const capability = {
        [VALIDATED_READ_PATH_BRAND]: /** @type {const} */ (true),
        [AUTHORITY_TOKEN]: authorityId,
        realPath: path.resolve(result.realPath),
        workspaceRoot: path.resolve(result.workspaceRoot),
        policyVersion: result.policyVersion,
        access: /** @type {const} */ ('read-only'),
    };
    recordCapabilityStat(aggregateReadStats, localStats, 'issued');
    return Object.freeze(capability);
}

/**
 * @param {import('#copilot/infra/internal/policy').WorkspacePathPolicySuccess} result
 * @param {symbol} authorityId
 * @param {CapabilityStats} localStats
 * @returns {ValidatedMutableWorkspacePath}
 */
function issueMutableCapability(result, authorityId, localStats) {
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
    recordCapabilityStat(aggregateMutableStats, localStats, 'issued');
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
