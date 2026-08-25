// @ts-check
/** Pure transport argument policy for the executable MCP CLI. */

const VALID_TRANSPORTS = /** @type {const} */ (['http', 'http2', 'stdio']);

/** @typedef {'http' | 'http2' | 'stdio'} McpCliTransport */

/**
 * @param {string[]} argv
 * @returns {McpCliTransport}
 */
export function parseTransport(argv) {
    const explicitTransport = readTransportArgument(argv);
    if (explicitTransport) return normalizeTransport(explicitTransport);
    if (argv.includes('--stdio')) return 'stdio';
    if (argv.includes('--http2') || argv.includes('--h2')) return 'http2';
    if (argv.includes('--http')) return 'http';
    return 'http2';
}

/** @param {string[]} argv @returns {string | null} */
function readTransportArgument(argv) {
    const equalsArg = argv.find((arg) => arg.startsWith('--transport='));
    if (equalsArg) return equalsArg.slice('--transport='.length);
    const index = argv.indexOf('--transport');
    if (index < 0) return null;
    const value = argv[index + 1];
    if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --transport. Use http, http2, h2, or stdio.');
    }
    return value;
}

/** @param {string} value @returns {McpCliTransport} */
function normalizeTransport(value) {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'h2') return 'http2';
    if (VALID_TRANSPORTS.includes(/** @type {McpCliTransport} */ (normalized))) {
        return /** @type {McpCliTransport} */ (normalized);
    }
    throw new Error(`Invalid MCP transport "${value}". Use http, http2, h2, or stdio.`);
}
