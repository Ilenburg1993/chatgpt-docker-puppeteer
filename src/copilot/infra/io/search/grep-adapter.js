// @ts-check
/**
 * Adapter de argumentos para grep fallback.
 *
 * @module copilot/infra/io/search/grep-adapter
 */

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
    return [
        '-R',
        '-n',
        ...(opts.isRegex ? ['-E'] : ['-F']),
        ...(opts.caseSensitive ? [] : ['-i']),
        ...(opts.contextLines ? ['-C', String(opts.contextLines)] : []),
        '--exclude-dir=.git',
        '--exclude-dir=node_modules',
        '--exclude-dir=dist',
        ...(opts.includePattern ? [`--include=${opts.includePattern}`] : []),
        ...(opts.excludePattern ? [`--exclude=${opts.excludePattern}`] : []),
        opts.pattern,
        opts.resolved,
    ];
}
