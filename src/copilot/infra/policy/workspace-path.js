// @ts-check
/**
 * Pure lexical workspace path policy.
 *
 * This module intentionally performs no filesystem I/O and owns no mutable process state. Physical canonicalization,
 * symlink resolution and cache lifecycle belong to filesystem/workspace/path-policy.
 *
 * @module copilot/infra/policy/workspace-path
 */

import path from 'node:path';

export const IO_PATH_POLICY_VERSION = '2026-08-18.r4.repo-text-scripts.v1';

/** @type {ReadonlyArray<RegExp>} */
export const DEFAULT_BLOCKED_READ_PATH_PATTERNS = Object.freeze([
    /\.env$/i,
    /\.env\./i,
    /\.pem$/i,
    /\.key$/i,
    /secret/i,
    /\.passwd$/i,
    /credentials/i,
    /\.pfx$/i,
    /\.p12$/i,
    /id_rsa/i,
    /id_ed25519/i,
    /\.npmrc$/i,
    /\.netrc$/i,
]);

/** @type {ReadonlyArray<RegExp>} */
export const DEFAULT_BLOCKED_WRITE_PATH_PATTERNS = Object.freeze([
    ...DEFAULT_BLOCKED_READ_PATH_PATTERNS,
    /\.exe$/i,
    /\.msi$/i,
    /\.dll$/i,
    /\.so$/i,
    /\.dylib$/i,
]);

/** @type {readonly string[]} */
export const DEFAULT_BLOCKED_PATH_SEGMENTS = Object.freeze([
    '.git',
    '.env',
    '.ssh',
    '.aws',
    '.pem',
    'id_rsa',
    'id_ed25519',
    'node_modules',
]);

/**
 * @typedef {object} WorkspacePathPolicySuccess
 * @property {true} ok
 * @property {string} absolutePath
 * @property {string} relativePath
 * @property {string} workspaceRoot
 * @property {string} policyVersion
 * @property {readonly string[]} blockedSegments
 * @property {string} realPath
 * @property {boolean} symlinkResolved
 *
 * @typedef {object} WorkspacePathPolicyFailure
 * @property {false} ok
 * @property {string} reason
 * @property {string} code
 * @property {string} policyVersion
 *
 * @typedef {WorkspacePathPolicySuccess | WorkspacePathPolicyFailure} WorkspacePathPolicyResult
 */

/**
 * @param {string} inputPath
 * @param {{
 *   workspaceRoot:string;
 *   blockedSegments?:readonly string[];
 *   blockedPatterns?:readonly RegExp[];
 *   allowOutsideWorkspace?:boolean;
 *   preserveFinalSymlink?:boolean;
 *   mode?:'read'|'write'|'append'|'scan'|'search'|'fetch'|'copy'|'move'|'delete'|'patch'|'mkdir'|'metadata'|'stat';
 * }} options
 * @returns {WorkspacePathPolicyResult}
 */
export function evaluateWorkspacePathPolicy(inputPath, options) {
    if (typeof inputPath !== 'string' || !inputPath.trim())
        return workspacePathPolicyFailure('Path is required', 'PATH_REQUIRED');
    if (inputPath.includes('\0')) return workspacePathPolicyFailure('Path contains null byte', 'PATH_NULL_BYTE');
    if (typeof options?.workspaceRoot !== 'string' || !options.workspaceRoot.trim()) {
        return workspacePathPolicyFailure('Workspace root is required', 'WORKSPACE_ROOT_REQUIRED');
    }

    const workspaceRoot = path.resolve(options.workspaceRoot);
    const blockedSegments = normalizeWorkspaceBlockedSegments(options.blockedSegments);
    const allowOutsideWorkspace = options.allowOutsideWorkspace === true;
    const mode = normalizeWorkspacePathPolicyMode(options.mode);
    const blockedPatterns = normalizeWorkspaceBlockedPatterns(options.blockedPatterns, mode);
    const normalizedInput = normalizeWorkspaceInputPath(inputPath.trim());
    const candidateAbsolutePath = path.resolve(workspaceRoot, normalizedInput);
    const containment = evaluateWorkspacePathContainment(workspaceRoot, candidateAbsolutePath);

    if (!allowOutsideWorkspace && containment.outsideWorkspace) {
        return workspacePathPolicyFailure('Path traversal attempt detected', 'PATH_TRAVERSAL');
    }
    const blockedHit = splitWorkspacePathSegments(containment.relativePath || normalizedInput).find((segment) =>
        blockedSegments.includes(segment.toLowerCase()),
    );
    if (blockedHit) {
        return workspacePathPolicyFailure(
            `Access to protected path segment "${blockedHit}" is blocked`,
            'PATH_BLOCKED',
        );
    }
    if (findWorkspaceBlockedPathPattern(candidateAbsolutePath, blockedPatterns)) {
        return workspacePathPolicyFailure(
            `Access to protected path basename "${path.basename(candidateAbsolutePath)}" is blocked`,
            'PATH_BLOCKED',
        );
    }

    return {
        ok: true,
        absolutePath: candidateAbsolutePath,
        relativePath: containment.relativePath,
        workspaceRoot,
        policyVersion: IO_PATH_POLICY_VERSION,
        blockedSegments,
        realPath: candidateAbsolutePath,
        symlinkResolved: false,
    };
}

/** @param {readonly string[] | undefined} blockedSegments */
export function normalizeWorkspaceBlockedSegments(blockedSegments) {
    if (!Array.isArray(blockedSegments) || blockedSegments.length === 0) return DEFAULT_BLOCKED_PATH_SEGMENTS;
    return Object.freeze(blockedSegments.map((segment) => `${segment || ''}`.trim().toLowerCase()).filter(Boolean));
}

/** @param {readonly RegExp[] | undefined} blockedPatterns @param {string} mode */
export function normalizeWorkspaceBlockedPatterns(blockedPatterns, mode) {
    if (Array.isArray(blockedPatterns) && blockedPatterns.length > 0) return blockedPatterns;
    return mode === 'write' || mode === 'append' || mode === 'delete' || mode === 'move' || mode === 'copy'
        ? DEFAULT_BLOCKED_WRITE_PATH_PATTERNS
        : DEFAULT_BLOCKED_READ_PATH_PATTERNS;
}

/** @param {string | undefined} mode */
export function normalizeWorkspacePathPolicyMode(mode) {
    const normalized = typeof mode === 'string' ? mode.trim().toLowerCase() : '';
    if (normalized === 'write' || normalized === 'append' || normalized === 'delete') return normalized;
    if (normalized === 'move' || normalized === 'copy' || normalized === 'patch') return 'write';
    if (normalized === 'mkdir' || normalized === 'metadata') return 'write';
    return 'read';
}

/** @param {string} workspaceRoot @param {string} candidateAbsolutePath */
export function evaluateWorkspacePathContainment(workspaceRoot, candidateAbsolutePath) {
    const relativePath = path.relative(workspaceRoot, candidateAbsolutePath);
    return {
        relativePath,
        outsideWorkspace: relativePath === '' ? false : relativePath.startsWith('..') || path.isAbsolute(relativePath),
    };
}

/** @param {string} filePath @param {readonly RegExp[]} blockedPatterns */
export function findWorkspaceBlockedPathPattern(filePath, blockedPatterns) {
    const basename = path.basename(filePath);
    return blockedPatterns.find((pattern) => {
        pattern.lastIndex = 0;
        return pattern.test(basename);
    });
}

/** @param {string} inputPath */
function normalizeWorkspaceInputPath(inputPath) {
    return inputPath.replace(/\\/gu, '/');
}

/** @param {string} value */
export function splitWorkspacePathSegments(value) {
    return value
        .split(/[\\/]/gu)
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => part.toLowerCase());
}

/** @param {string} reason @param {string} code @returns {WorkspacePathPolicyFailure} */
export function workspacePathPolicyFailure(reason, code) {
    return { ok: false, reason, code, policyVersion: IO_PATH_POLICY_VERSION };
}
