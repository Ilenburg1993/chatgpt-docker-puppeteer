// @ts-check
/**
 * Physical workspace path-policy resolver.
 *
 * Owns filesystem canonicalization and composes it with the pure lexical policy. This is deliberately internal: raw
 * path evaluation does not cross the Infra public membrane; external consumers use WorkspacePathAuthority instead.
 *
 * @module copilot/infra/filesystem/workspace/path-policy/service
 */

import {
    IO_PATH_POLICY_VERSION,
    evaluateWorkspacePathContainment,
    evaluateWorkspacePathPolicy,
    findWorkspaceBlockedPathPattern,
    normalizeWorkspaceBlockedPatterns,
    normalizeWorkspaceBlockedSegments,
    normalizeWorkspacePathPolicyMode,
    splitWorkspacePathSegments,
    workspacePathPolicyFailure,
} from '#copilot/infra/internal/policy/workspace-path';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import {
    getWorkspacePathPolicyCacheConfig,
    readWorkspacePathPolicyCacheEntry,
    recordWorkspacePathPolicyCacheBypass,
    rememberWorkspacePathPolicyCacheEntry,
} from './cache.js';

/**
 * Resolve symlinks/nearest existing ancestor and enforce the canonical workspace path policy.
 *
 * @param {string} inputPath
 * @param {{
 *   workspaceRoot:string;
 *   blockedSegments?:readonly string[];
 *   blockedPatterns?:readonly RegExp[];
 *   allowOutsideWorkspace?:boolean;
 *   preserveFinalSymlink?:boolean;
 *   mode?:'read'|'write'|'append'|'scan'|'search'|'fetch'|'copy'|'move'|'delete'|'patch'|'mkdir'|'metadata'|'stat';
 * }} options
 * @returns {Promise<import('#copilot/infra/internal/policy/workspace-path').WorkspacePathPolicyResult>}
 */
export async function evaluateWorkspacePathPolicyAsync(inputPath, options) {
    const base = evaluateWorkspacePathPolicy(inputPath, options);
    if (!base.ok) return base;

    const allowOutsideWorkspace = options.allowOutsideWorkspace === true;
    const preserveFinalSymlink = options.preserveFinalSymlink === true && base.absolutePath !== base.workspaceRoot;
    const mode = normalizeWorkspacePathPolicyMode(options.mode);
    const blockedSegments = normalizeWorkspaceBlockedSegments(options.blockedSegments);
    const blockedPatterns = normalizeWorkspaceBlockedPatterns(options.blockedPatterns, mode);
    const cacheConfig = getWorkspacePathPolicyCacheConfig();
    const cacheKey =
        mode === 'read' && !allowOutsideWorkspace && !preserveFinalSymlink && cacheConfig.ttlMs > 0
            ? buildWorkspacePathPolicyCacheKey(base, blockedSegments, blockedPatterns)
            : null;
    if (cacheKey) {
        const cached = readWorkspacePathPolicyCacheEntry(cacheKey, cacheConfig.ttlMs);
        if (cached) return cached;
    } else {
        recordWorkspacePathPolicyCacheBypass();
    }

    const resolutionPath = preserveFinalSymlink ? path.dirname(base.absolutePath) : base.absolutePath;
    const resolvedTarget = await resolveRealTargetForWorkspacePolicy(resolutionPath);
    const normalizedTargetPath = preserveFinalSymlink
        ? path.join(resolvedTarget.realPath, path.basename(base.absolutePath))
        : resolvedTarget.realPath;
    const containment = evaluateWorkspacePathContainment(base.workspaceRoot, normalizedTargetPath);

    if (!allowOutsideWorkspace && containment.outsideWorkspace) {
        return workspacePathPolicyFailure(
            'Path resolves outside workspace after symlink normalization',
            'PATH_SYMLINK_OUTSIDE',
        );
    }

    const blockedHit = splitWorkspacePathSegments(containment.relativePath || normalizedTargetPath).find((segment) =>
        blockedSegments.includes(segment.toLowerCase()),
    );
    if (blockedHit) {
        return workspacePathPolicyFailure(
            `Access to protected real path segment "${blockedHit}" is blocked`,
            'PATH_BLOCKED',
        );
    }
    if (findWorkspaceBlockedPathPattern(normalizedTargetPath, blockedPatterns)) {
        return workspacePathPolicyFailure(
            `Access to protected real path basename "${path.basename(normalizedTargetPath)}" is blocked`,
            'PATH_BLOCKED',
        );
    }

    const result = /** @type {import('#copilot/infra/internal/policy/workspace-path').WorkspacePathPolicySuccess} */ ({
        ...base,
        relativePath: containment.relativePath,
        realPath: normalizedTargetPath,
        symlinkResolved: normalizedTargetPath !== base.absolutePath,
    });
    if (cacheKey) rememberWorkspacePathPolicyCacheEntry(cacheKey, result, cacheConfig.maxEntries);
    return result;
}

/** @param {string} absolutePath @returns {Promise<{realPath:string}>} */
async function resolveRealTargetForWorkspacePolicy(absolutePath) {
    const unresolvedSegments = [];
    let candidate = absolutePath;
    while (true) {
        try {
            const realAncestor = await realpath(candidate);
            return {
                realPath:
                    unresolvedSegments.length === 0
                        ? realAncestor
                        : path.join(realAncestor, ...unresolvedSegments.reverse()),
            };
        } catch (error) {
            const code = String(/** @type {{code?:unknown}} */ (error)?.code ?? '');
            if (code !== 'ENOENT' && code !== 'ENOTDIR') return { realPath: absolutePath };
            const parent = path.dirname(candidate);
            if (parent === candidate) return { realPath: absolutePath };
            unresolvedSegments.push(path.basename(candidate));
            candidate = parent;
        }
    }
}

/** @param {import('#copilot/infra/internal/policy/workspace-path').WorkspacePathPolicySuccess} base @param {readonly string[]} blockedSegments @param {readonly RegExp[]} blockedPatterns */
function buildWorkspacePathPolicyCacheKey(base, blockedSegments, blockedPatterns) {
    return JSON.stringify([
        IO_PATH_POLICY_VERSION,
        base.workspaceRoot,
        base.absolutePath,
        blockedSegments,
        blockedPatterns.map((pattern) => [pattern.source, pattern.flags]),
    ]);
}
