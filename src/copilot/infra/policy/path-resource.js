// @ts-check
/**
 * Policies puras para paths e chaves de recurso.
 *
 * @module copilot/infra/policy/path-resource
 */

import { isAbsolute, normalize, relative, resolve } from 'node:path';

/**
 * @param {string} resourceKey
 * @returns {string}
 */
export function normalizePathResourceKey(resourceKey) {
    const raw = String(resourceKey || '<unknown>');
    if (raw.startsWith('<') && raw.endsWith('>')) return raw;
    return normalize(resolve(raw));
}

/**
 * @param {string} workspaceRoot
 * @returns {string}
 */
export function normalizeWorkspaceRoot(workspaceRoot) {
    return normalize(resolve(workspaceRoot));
}

/**
 * @param {string} candidate
 * @param {string} workspaceRoot
 * @returns {string}
 */
export function resolveWorkspaceCandidate(candidate, workspaceRoot) {
    const root = normalizeWorkspaceRoot(workspaceRoot);
    return normalize(isAbsolute(candidate) ? resolve(candidate) : resolve(root, candidate));
}

/**
 * @param {string} candidate
 * @param {string} workspaceRoot
 * @returns {boolean}
 */
export function isPathInsideWorkspace(candidate, workspaceRoot) {
    const root = normalizeWorkspaceRoot(workspaceRoot);
    const target = resolveWorkspaceCandidate(candidate, root);
    const rel = relative(root, target);
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * @param {string} candidate
 * @returns {boolean}
 */
export function hasNullByte(candidate) {
    return candidate.includes('\u0000');
}
