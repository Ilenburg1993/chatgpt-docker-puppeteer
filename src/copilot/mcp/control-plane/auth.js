// @ts-check
/**
 * MCP auth metadata and scope planning.
 *
 * This module prepares Apps SDK/OAuth metadata without forcing auth in the current temporary-tunnel development mode.
 *
 * @module copilot/mcp/control-plane/auth
 */

/**
 * @typedef {'none-dev' | 'mixed-auth' | 'oauth' | 'secure-mcp-tunnel'} McpAuthMode
 *
 * @typedef {'repo:read' | 'repo:write' | 'repo:validate' | 'repo:admin'} McpAuthScope
 *
 * @typedef {object} McpAuthConfig
 * @property {McpAuthMode} mode
 * @property {string} resource
 * @property {string} protectedResourceMetadataUrl
 * @property {string[]} authorizationServers
 * @property {McpAuthScope[]} scopesSupported
 * @property {string} resourceDocumentation
 */

export const MCP_AUTH_SCOPES = /** @type {const} */ ({
    read: 'repo:read',
    write: 'repo:write',
    validate: 'repo:validate',
    admin: 'repo:admin',
});

/**
 * @param {string | undefined} value
 * @returns {McpAuthMode}
 */
export function normalizeMcpAuthMode(value) {
    const normalized = String(value ?? 'none-dev')
        .trim()
        .toLowerCase();
    if (normalized === 'oauth' || normalized === 'team-oauth') return 'oauth';
    if (normalized === 'mixed' || normalized === 'mixed-auth' || normalized === 'dev-mixed-auth') return 'mixed-auth';
    if (normalized === 'secure-mcp-tunnel') return 'secure-mcp-tunnel';
    return 'none-dev';
}

/**
 * @param {string | undefined} value
 * @returns {string}
 */
function normalizeResourceUrl(value) {
    const raw = String(value ?? 'https://<endpoint-do-tunel>')
        .trim()
        .replace(/\/+$/, '');
    return raw.endsWith('/mcp') ? raw.slice(0, -'/mcp'.length) : raw;
}

/**
 * @param {string | undefined} value
 * @returns {string[]}
 */
function splitCsv(value) {
    return String(value ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {McpAuthConfig}
 */
export function readMcpAuthConfig(env = process.env) {
    const mode = normalizeMcpAuthMode(env['COPILOT_MCP_AUTH_MODE'] ?? env['COPILOT_MCP_CHATGPT_AUTH_MODE']);
    const resource = normalizeResourceUrl(env['COPILOT_MCP_PUBLIC_URL'] ?? env['COPILOT_MCP_CLOUDFLARE_PUBLIC_URL']);
    const authorizationServers = splitCsv(
        env['COPILOT_MCP_OAUTH_AUTHORIZATION_SERVERS'] ?? env['COPILOT_MCP_OAUTH_ISSUER'],
    );
    return {
        mode,
        resource,
        protectedResourceMetadataUrl: `${resource}/.well-known/oauth-protected-resource`,
        authorizationServers,
        scopesSupported: [MCP_AUTH_SCOPES.read, MCP_AUTH_SCOPES.write, MCP_AUTH_SCOPES.validate, MCP_AUTH_SCOPES.admin],
        resourceDocumentation:
            env['COPILOT_MCP_RESOURCE_DOCUMENTATION'] ?? 'https://developers.openai.com/apps-sdk/build/auth',
    };
}

/**
 * @param {import('../registry.js').McpToolDefinition} tool
 * @returns {McpAuthScope[]}
 */
export function scopesForMcpTool(tool) {
    if (tool.name === 'job_cancel' || tool.name === 'repo_remove_file') return [MCP_AUTH_SCOPES.admin];
    if (tool.name.startsWith('run_') || tool.name.includes('validation') || tool.name.includes('validator')) {
        return [MCP_AUTH_SCOPES.validate];
    }
    if (tool.annotations.readOnlyHint === true) return [MCP_AUTH_SCOPES.read];
    return [MCP_AUTH_SCOPES.write];
}

/**
 * @param {import('../registry.js').McpToolDefinition} tool
 * @param {McpAuthConfig} [config]
 * @returns {({ type: 'noauth' } | { type: 'oauth2'; scopes: string[] })[]}
 */
export function securitySchemesForMcpTool(tool, config = readMcpAuthConfig()) {
    const oauth = { type: /** @type {const} */ ('oauth2'), scopes: scopesForMcpTool(tool) };
    if (config.mode === 'oauth') return [oauth];
    if (config.mode === 'mixed-auth') return [{ type: 'noauth' }, oauth];
    return [{ type: 'noauth' }];
}

/**
 * @param {McpAuthConfig} [config]
 * @returns {Record<string, unknown>}
 */
export function buildProtectedResourceMetadata(config = readMcpAuthConfig()) {
    return {
        resource: config.resource,
        authorization_servers: [...config.authorizationServers],
        scopes_supported: [...config.scopesSupported],
        resource_documentation: config.resourceDocumentation,
        token_endpoint_auth_methods_supported: ['none', 'private_key_jwt', 'client_secret_post', 'client_secret_basic'],
    };
}

/**
 * @param {string[]} scopes
 * @param {McpAuthConfig} [config]
 * @returns {string}
 */
export function buildWwwAuthenticateChallenge(scopes, config = readMcpAuthConfig()) {
    const scopeValue = scopes.filter(Boolean).join(' ');
    return `Bearer resource_metadata="${config.protectedResourceMetadataUrl}", scope="${scopeValue}"`;
}
