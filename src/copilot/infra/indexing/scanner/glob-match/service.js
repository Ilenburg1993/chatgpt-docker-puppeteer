// @ts-check
/**
 * Política glob canônica usada por scan, prefetch e pós-filtro do índice.
 *
 * @module copilot/infra/indexing/scanner/glob-match/service
 */

import { minimatch } from 'minimatch';
import { basename, relative, resolve } from 'node:path';

export const IO_GLOB_ENGINE = 'minimatch-v10';

const MINIMATCH_OPTIONS = Object.freeze({
    dot: true,
    nocomment: true,
    nonegate: true,
    windowsPathsNoEscape: true,
});

/**
 * @param {string} value
 */
function normalizeGlobPath(value) {
    return String(value).replace(/\\/gu, '/').replace(/^\.\//u, '');
}

/**
 * Padrões sem metacaracteres também podem nomear diretórios/segmentos. Assim, `node_modules` exclui toda a subtree e
 * `src/copilot` inclui seus descendentes, preservando a UX histórica dos callers.
 *
 * @param {string} target
 * @param {string} pattern
 */
export function matchesPlainPathPattern(target, pattern) {
    const normalizedTarget = normalizeGlobPath(target);
    const normalizedPattern = normalizeGlobPath(pattern).replace(/\/+$/u, '');
    if (!normalizedPattern || /[*?[\]{}()!+@]/u.test(normalizedPattern)) return false;
    if (normalizedTarget === normalizedPattern || normalizedTarget.startsWith(`${normalizedPattern}/`)) return true;
    if (normalizedPattern.includes('/')) return false;
    return normalizedTarget.split('/').includes(normalizedPattern);
}

/**
 * @param {string} target
 * @param {string} pattern
 * @returns {boolean}
 */
export function matchesGlobPattern(target, pattern) {
    const normalizedTarget = normalizeGlobPath(target);
    const normalizedPattern = normalizeGlobPath(pattern);
    if (!normalizedPattern) return false;
    return (
        minimatch(normalizedTarget, normalizedPattern, {
            ...MINIMATCH_OPTIONS,
            matchBase: !normalizedPattern.includes('/'),
        }) || matchesPlainPathPattern(normalizedTarget, normalizedPattern)
    );
}

/**
 * @param {string} name
 * @param {string | undefined} filter
 * @returns {boolean}
 */
export function matchesFilter(name, filter) {
    if (!filter) return true;
    return matchesGlobPattern(basename(name), filter);
}

/**
 * @param {string} pattern
 * @returns {RegExp}
 */
export function simpleGlobToRegExp(pattern) {
    const normalizedPattern = normalizeGlobPath(pattern);
    const compiled = minimatch.makeRe(normalizedPattern, {
        ...MINIMATCH_OPTIONS,
        matchBase: !normalizedPattern.includes('/'),
    });
    return compiled || /$a/u;
}

/**
 * @param {string} absolutePath
 * @param {string} workspaceRoot
 * @param {readonly string[]} patterns
 * @returns {boolean}
 */
export function matchesAnyPattern(absolutePath, workspaceRoot, patterns) {
    if (!patterns.length) return false;
    const normalizedAbsolute = resolve(absolutePath).replace(/\\/g, '/');
    const normalizedRelative = relative(workspaceRoot, absolutePath).replace(/\\/g, '/');
    return patterns.some(
        (pattern) => matchesGlobPattern(normalizedRelative, pattern) || matchesGlobPattern(normalizedAbsolute, pattern),
    );
}
