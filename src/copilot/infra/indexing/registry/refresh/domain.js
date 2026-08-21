// @ts-check
/** Semantic domain policy for explicit and automatic index refresh. */

import { loadGitignoreMatcher, matchesAnyPattern } from '#copilot/infra/internal/indexing/scanner';
import { readEnvNonNegativeInt, readEnvPositiveInt } from '#copilot/infra/internal/platform';
import { extname, relative, resolve } from 'node:path';
import { DEFAULT_INDEX_EXTENSIONS } from '../sqlite/index.js';

/** @typedef {{
 *     scopeRoot: string;
 *     workspaceRoot: string;
 *     extensions: Set<string>;
 *     respectGitignore: boolean;
 *     include: string[];
 *     exclude: string[];
 * }} IndexAutoRefreshDomain */

/** Runtime configuration for the derived-state refresh scheduler. */
export function readIoIndexAutoRefreshConfig() {
    const enabledRaw = String(process.env['IO_INDEX_AUTO_REFRESH_ENABLED'] ?? '1')
        .trim()
        .toLowerCase();
    return {
        enabled: !['0', 'false', 'off'].includes(enabledRaw),
        debounceMs: readEnvNonNegativeInt('IO_INDEX_AUTO_REFRESH_DEBOUNCE_MS', 100),
        maxBatch: Math.min(512, readEnvPositiveInt('IO_INDEX_AUTO_REFRESH_MAX_BATCH', 64)),
    };
}

/**
 * @param {string} scopeRoot
 * @param {{
 *     workspaceRoot?: string;
 *     extensions?: readonly string[];
 *     respectGitignore?: boolean;
 *     include?: readonly string[];
 *     exclude?: readonly string[];
 * }} [options]
 * @returns {IndexAutoRefreshDomain}
 */
export function createIndexAutoRefreshDomain(scopeRoot, options = {}) {
    const workspaceRoot = resolve(options.workspaceRoot ?? scopeRoot);
    return {
        scopeRoot: resolve(scopeRoot),
        workspaceRoot,
        extensions: new Set(
            (options.extensions ?? DEFAULT_INDEX_EXTENSIONS).map((extension) => String(extension).toLowerCase()),
        ),
        respectGitignore: options.respectGitignore !== false,
        include: [...(options.include ?? [])].map(String),
        exclude: [...(options.exclude ?? [])].map(String),
    };
}

/** @param {string} filePath @param {IndexAutoRefreshDomain} domain */
export function isIndexRefreshDomainCandidate(filePath, domain) {
    const normalized = resolve(filePath);
    const relativeToScope = relative(domain.scopeRoot, normalized).replace(/\\/gu, '/');
    if (!relativeToScope || relativeToScope === '..' || relativeToScope.startsWith('../')) return false;
    if (relativeToScope.split('/').some((segment) => segment.startsWith('.') && segment.length > 1)) return false;
    if (!domain.extensions.has(extname(normalized).toLowerCase())) return false;
    if (domain.include.length > 0 && !matchesAnyPattern(normalized, domain.scopeRoot, domain.include)) return false;
    if (domain.exclude.length > 0 && matchesAnyPattern(normalized, domain.scopeRoot, domain.exclude)) return false;
    return true;
}

/**
 * Preflight explicit paths against the same semantic domain used by runtime auto-refresh, without mutating global
 * scheduler state. Intended for startup/checkpoint replay and other evidence-gathering callers.
 *
 * @param {readonly string[]} filePaths
 * @param {{
 *     scopeRoot: string;
 *     workspaceRoot?: string;
 *     extensions?: readonly string[];
 *     respectGitignore?: boolean;
 *     include?: readonly string[];
 *     exclude?: readonly string[];
 * }} options
 */
export async function filterIoIndexRefreshDomainPaths(filePaths, options) {
    const domain = createIndexAutoRefreshDomain(options.scopeRoot, options);
    const unique = [...new Set(filePaths.map((value) => resolve(value)))];
    const candidates = [];
    let domainSkipped = 0;
    for (const filePath of unique) {
        if (!isIndexRefreshDomainCandidate(filePath, domain)) {
            domainSkipped += 1;
            continue;
        }
        candidates.push(filePath);
    }
    if (!domain.respectGitignore || candidates.length === 0) {
        return { paths: candidates, requested: unique.length, domainSkipped, gitignoredSkipped: 0 };
    }
    const matcher = await loadGitignoreMatcher(domain.workspaceRoot);
    const paths = [];
    let gitignoredSkipped = 0;
    for (const filePath of candidates) {
        const relativePath = relative(domain.workspaceRoot, filePath).replace(/\\/gu, '/');
        if (relativePath && matcher.ignores(relativePath)) {
            gitignoredSkipped += 1;
            continue;
        }
        paths.push(filePath);
    }
    return { paths, requested: unique.length, domainSkipped, gitignoredSkipped };
}
