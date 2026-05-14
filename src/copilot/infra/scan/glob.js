// @ts-check
/**
 * Matching glob simples usado por scan/prefetch.
 *
 * @module copilot/infra/scan/glob
 */

import { basename, relative, resolve } from 'node:path';

/**
 * @param {string} name
 * @param {string | undefined} filter
 * @returns {boolean}
 */
export function matchesFilter(name, filter) {
    if (!filter) return true;
    if (filter.startsWith('*.')) return name.endsWith(filter.slice(1));
    return name === filter;
}

/**
 * @param {string} pattern
 * @returns {RegExp}
 */
export function simpleGlobToRegExp(pattern) {
    const normalized = pattern.replace(/\\/g, '/');
    let out = '^';
    for (let i = 0; i < normalized.length; i++) {
        const ch = normalized[i];
        if (ch === '*') {
            const next = normalized[i + 1];
            if (next === '*') {
                out += '.*';
                i += 1;
            } else {
                out += '[^/]*';
            }
        } else if (ch === '?') {
            out += '[^/]';
        } else {
            out += ch?.replace(/[|\\{}()[\]^$+?.]/g, '\\$&') ?? '';
        }
    }
    out += '$';
    return new RegExp(out, 'u');
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
    const name = basename(absolutePath);
    return patterns.some((pattern) => {
        const re = simpleGlobToRegExp(pattern);
        return re.test(normalizedRelative) || re.test(normalizedAbsolute) || re.test(name);
    });
}
