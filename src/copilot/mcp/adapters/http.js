// @ts-check
/**
 * Streamable HTTP adapter for ChatGPT and MCP Inspector.
 *
 * @module copilot/mcp/adapters/http
 */

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from 'node:http';
import { buildChatGptConnectorProfile } from '../connection/profile.js';
import { logMcp } from '../control-plane/audit.js';
import { buildProtectedResourceMetadata, parseBearerToken, readMcpAuthConfig } from '../control-plane/auth.js';
import { handleBuiltInDevOAuthRequest } from '../control-plane/dev-oauth.js';
import { readMcpIndexAutoBuildState, startMcpIndexAutoBuildInBackground } from '../control-plane/index-auto-build.js';
import { readMcpMetricsSnapshot } from '../control-plane/metrics.js';
import { createCopilotMcpServer } from '../server.js';

const MCP_PATH = '/mcp';
const DEFAULT_ALLOWED_ORIGINS = [
    'https://chatgpt.com',
    'https://chat.openai.com',
    'https://platform.openai.com',
    'https://claude.ai',
    'https://www.claude.ai',
    'http://localhost',
    'http://127.0.0.1',
];

/**
 * @param {import('node:http').ServerResponse} res
 * @param {string | undefined} origin
 * @returns {void}
 */
function setCorsHeaders(res, origin) {
    const allowedOrigin = origin ? (isAllowedOrigin(origin) ? origin : undefined) : '*';
    if (allowedOrigin) res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
    res.setHeader(
        'Access-Control-Allow-Headers',
        [
            'accept',
            'authorization',
            'content-type',
            'mcp-session-id',
            'mcp-protocol-version',
            'x-requested-with',
        ].join(', '),
    );
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id, MCP-Protocol-Version, WWW-Authenticate');
    res.setHeader('Vary', 'Origin');
}

/**
 * @param {string | undefined} origin
 * @returns {boolean}
 */
function isAllowedOrigin(origin) {
    if (!origin) return true;
    const configured = String(process.env['COPILOT_MCP_ALLOWED_ORIGINS'] ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    const allowed = configured.length > 0 ? configured : DEFAULT_ALLOWED_ORIGINS;
    try {
        const parsed = new URL(origin);
        if ((parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') && /^https?:$/u.test(parsed.protocol)) {
            return allowed.some((candidate) => origin.startsWith(candidate));
        }
        return allowed.includes(origin);
    } catch {
        return false;
    }
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @returns {boolean}
 */
function rejectInvalidOrigin(req, res) {
    const originHeader = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin;
    if (originHeader && !isAllowedOrigin(originHeader)) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Origin is not allowed.' } }));
        return true;
    }
    return false;
}

/**
 * @param {string} pathname
 * @returns {boolean}
 */
function isCorsManagedRoute(pathname) {
    return (
        pathname === '/' ||
        pathname === '/health' ||
        pathname === MCP_PATH ||
        pathname === '/chatgpt-connector.json' ||
        pathname === '/.well-known/oauth-protected-resource' ||
        pathname === '/.well-known/oauth-protected-resource/mcp' ||
        pathname === '/.well-known/oauth-authorization-server' ||
        pathname === '/.well-known/openid-configuration' ||
        pathname === '/.well-known/oauth-client/codex-smoke.json' ||
        pathname.startsWith('/oauth/')
    );
}

/**
 * @param {{ host?: string; port?: number }} [opts]
 * @returns {Promise<import('node:http').Server>}
 */
export async function startHttpMcpServer(opts = {}) {
    const host = opts.host ?? process.env['COPILOT_MCP_HOST'] ?? '127.0.0.1';
    const port = opts.port ?? Number(process.env['COPILOT_MCP_PORT'] ?? 3333);

    const httpServer = createServer(async (req, res) => {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${host}:${port}`}`);
        const requestOrigin = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin;

        if (isCorsManagedRoute(url.pathname)) {
            setCorsHeaders(res, requestOrigin);
            if (rejectInvalidOrigin(req, res)) return;
        }

        if (req.method === 'OPTIONS' && isCorsManagedRoute(url.pathname)) {
            res.writeHead(204).end();
            return;
        }

        if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(
                JSON.stringify({
                    ok: true,
                    name: 'copilot-mcp',
                    mcpPath: MCP_PATH,
                    metrics: readMcpMetricsSnapshot(),
                    indexAutoBuild: readMcpIndexAutoBuildState(),
                }),
            );
            return;
        }

        if (req.method === 'GET' && url.pathname === '/chatgpt-connector.json') {
            const publicMcpUrl = url.searchParams.get('publicMcpUrl') ?? undefined;
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(
                JSON.stringify(
                    buildChatGptConnectorProfile(publicMcpUrl === undefined ? {} : { publicMcpUrl }),
                    null,
                    2,
                ),
            );
            return;
        }

        if (
            req.method === 'GET' &&
            (url.pathname === '/.well-known/oauth-protected-resource' ||
                url.pathname === '/.well-known/oauth-protected-resource/mcp')
        ) {
            const config = readMcpAuthConfig();
            const resource = url.pathname.endsWith('/mcp') ? `${config.resource}/mcp` : config.resource;
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify(buildProtectedResourceMetadata(config, { resource }), null, 2));
            return;
        }

        if (await handleBuiltInDevOAuthRequest(req, res, url, readMcpAuthConfig())) {
            return;
        }

        const mcpMethods = new Set(['POST', 'GET', 'DELETE']);
        if (url.pathname === MCP_PATH && req.method && mcpMethods.has(req.method)) {
            const authorizationHeader = Array.isArray(req.headers.authorization)
                ? req.headers.authorization[0]
                : req.headers.authorization;
            const server = createCopilotMcpServer({
                authContext: {
                    bearerToken: parseBearerToken(authorizationHeader),
                    headers: req.headers,
                },
            });
            const transport = new StreamableHTTPServerTransport(
                /** @type {import('@modelcontextprotocol/sdk/server/streamableHttp.js').StreamableHTTPServerTransportOptions} */ (
                    /** @type {unknown} */ ({
                        sessionIdGenerator: undefined,
                        enableJsonResponse: true,
                    })
                ),
            );
            res.on('close', () => {
                void transport.close();
                void server.close();
            });
            try {
                await server.connect(
                    /** @type {import('@modelcontextprotocol/sdk/shared/transport.js').Transport} */ (transport),
                );
                await transport.handleRequest(req, res);
            } catch (error) {
                logMcp('ERROR', 'Error handling MCP HTTP request.', {
                    error: error instanceof Error ? error.message : String(error),
                });
                if (!res.headersSent) {
                    res.writeHead(500).end('Internal server error');
                }
            }
            return;
        }

        res.writeHead(404).end('Not Found');
    });

    await new Promise((resolve) => {
        httpServer.listen(port, host, () => resolve(undefined));
    });
    logMcp('INFO', 'MCP HTTP server listening.', { url: `http://${host}:${port}${MCP_PATH}` });
    startMcpIndexAutoBuildInBackground({ reason: 'mcp-http-start' });
    return httpServer;
}
