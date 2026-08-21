// @ts-check
/**
 * Adapter de argumentos para grep fallback.
 *
 * @module copilot/infra/indexing/search/text/grep
 */

/**
 * Sanitiza padrões de include/exclude para evitar injeção de flags extras no grep.
 *
 * @param {string | undefined} pattern
 * @returns {string | null}
 */
function sanitizeGrepPattern(pattern) {
    if (typeof pattern !== 'string') return null;
    const value = pattern.trim();
    if (value.length === 0) return null;
    if (/\s/u.test(value)) return null;
    if (value.startsWith('-')) return null;
    return value;
}

/**
 * @param {{
 *     pattern: string;
 *     resolved: string;
 *     isRegex?: boolean;
 *     caseSensitive?: boolean;
 *     includePattern?: string;
 *     excludePattern?: string;
 *     contextLines?: number;
 * }} opts
 * @returns {string[]}
 */
export function buildGrepArgs(opts) {
    const includePattern = sanitizeGrepPattern(opts.includePattern);
    const excludePattern = sanitizeGrepPattern(opts.excludePattern);

    return [
        '-R',
        '-n',
        ...(opts.isRegex ? ['-E'] : ['-F']),
        ...(opts.caseSensitive ? [] : ['-i']),
        ...(opts.contextLines ? ['-C', String(opts.contextLines)] : []),
        '--exclude-dir=.git',
        '--exclude-dir=node_modules',
        '--exclude-dir=dist',
        ...(includePattern ? [`--include=${includePattern}`] : []),
        ...(excludePattern ? [`--exclude=${excludePattern}`] : []),
        opts.pattern,
        opts.resolved,
    ];
}
