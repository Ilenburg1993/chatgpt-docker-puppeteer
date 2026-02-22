/**
 * Query normalization and expansion for better cache hits and semantic matching
 * Improves cache hit rate by normalizing similar queries to the same form
 */

/**
 * Normalize query for better cache hits
 * Converts query to canonical form:
 * - Lowercase
 * - Trim whitespace
 * - Collapse multiple spaces
 * - Remove special chars (keep alphanumeric + space + dot + dash)
 *
 * @param {string} query - Raw query text
 * @returns {string} - Normalized query
 *
 * @example
 * normalizeQuery("  CHROME_PROXY_PORT  ") === "chrome_proxy_port"
 * normalizeQuery("kernel  loop   20Hz") === "kernel loop 20hz"
 */
export function normalizeQuery(query) {
    return query
        .toLowerCase() // Case-insensitive
        .trim() // Remove leading/trailing whitespace
        .replace(/\s+/g, ' ') // Collapse multiple spaces to single space
        .replace(/[^\w\s.-]/g, ''); // Keep only alphanumeric + space + dot + dash
}

/**
 * Expand query with code-specific synonyms
 * Adds common variations and synonyms to improve semantic matching
 *
 * @param {string} query - Normalized query
 * @returns {string} - Expanded query with synonyms
 *
 * @example
 * expandQuery("function timeout") => "function func fn method timeout delay wait"
 */
export function expandQuery(query) {
    // Code-specific synonyms mapping
    const CODE_SYNONYMS = {
        function: ['func', 'fn', 'method'],
        class: ['interface', 'type', 'struct'],
        error: ['exception', 'err', 'failure'],
        config: ['configuration', 'settings', 'options'],
        async: ['asynchronous', 'promise', 'await'],
        timeout: ['delay', 'wait', 'timer'],
        retry: ['backoff', 'reattempt', 'repeat'],
        cache: ['memoize', 'store', 'buffer'],
        server: ['service', 'daemon', 'backend'],
        client: ['frontend', 'browser', 'user'],
        api: ['endpoint', 'route', 'handler'],
        database: ['db', 'storage', 'datastore'],
        test: ['spec', 'unittest', 'suite'],
    };

    const tokens = query.split(/\s+/);
    const expanded = new Set(tokens);

    // Add synonyms for each token
    for (const token of tokens) {
        if (CODE_SYNONYMS[token]) {
            CODE_SYNONYMS[token].forEach(syn => expanded.add(syn));
        }
    }

    return Array.from(expanded).join(' ');
}

/**
 * Full query processing pipeline: normalize + optionally expand
 * Use this for end-to-end query preprocessing
 *
 * @param {string} query - Raw query text
 * @param {object} options - Processing options
 * @param {boolean} [options.expand] - Whether to expand with synonyms (default: false)
 * @returns {string} - Processed query
 *
 * @example
 * processQuery("  Function TIMEOUT  ", { expand: true })
 * // => "function func fn method timeout delay wait timer"
 */
export function processQuery(query, options = {}) {
    const { expand = false } = options;

    let processed = normalizeQuery(query);

    if (expand) {
        processed = expandQuery(processed);
    }

    return processed;
}
