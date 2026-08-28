// @ts-check
/**
 * ChatGPT / Claude connection MCP wire tools.
 *
 * Local connector/readiness projections share one least-authority owner. OAuth issuer probing remains a separate
 * fixed-external tool so local readiness never inherits network authority.
 *
 * @module copilot/mcp/tools/connection
 */

import {
    MCP_CONNECTION_DIAGNOSTIC_LIMITS,
    checkChatGptConnectorUrl,
    diagnoseMcpOAuthIssuer,
    readChatGptConnectorCurrentUrlStatus,
    readChatGptConnectorProfileReport,
    readClaudeConnectorProfileReport,
    readMcpConnectionAuthProfile,
    readMcpConnectionReadiness,
    requireMcpToolConnectionConfig,
} from '#copilot/mcp/public/connection';
import { defineMcpRawTool } from '#copilot/mcp/public/protocol/catalog';
import { errorResult, okResult } from '#copilot/mcp/public/protocol/tools';
import { z } from 'zod';

const {
    minTimeoutMs: MIN_DIAGNOSTIC_TIMEOUT_MS,
    maxTimeoutMs: MAX_DIAGNOSTIC_TIMEOUT_MS,
    maxUrlLength: MAX_URL_LENGTH,
} = MCP_CONNECTION_DIAGNOSTIC_LIMITS;

/** @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition[]} */
export const connectionTools = [
    defineMcpRawTool({
        name: 'mcp_connection_readiness',
        title: 'MCP connection readiness',
        description:
            'Read one local connector projection: readiness, ChatGPT/Claude profile, URL validation, current URL state, or OAuth auth profile. Does not perform external probes.',
        inputSchema: {
            view: z
                .enum(['readiness', 'profile', 'url-check', 'current-url', 'auth-profile'])
                .optional()
                ['describe']('Local connection projection. Default: readiness.'),
            client: z.enum(['chatgpt', 'claude']).optional()['describe']('view=profile only. Default: chatgpt.'),
            publicMcpUrl: z
                .string()
                .max(MAX_URL_LENGTH)
                .optional()
                ['describe']('view=readiness|profile|url-check: optional/candidate public HTTPS /mcp URL.'),
            scopes: z
                .array(z.string().min(1).max(128))
                .max(16)
                .optional()
                ['describe']('view=auth-profile only: scopes for the challenge preview.'),
        },

        handler: async ({ view, client, publicMcpUrl, scopes }, operationContext) => {
            const projection = view ?? 'readiness';
            const config = requireMcpToolConnectionConfig(operationContext);
            if (projection === 'profile') {
                if (scopes !== undefined) {
                    return errorResult('scopes is valid only with view=auth-profile.', {
                        code: 'ERR_CONNECTION_VIEW_FIELDS',
                        view: projection,
                    });
                }
                const input = publicMcpUrl === undefined ? {} : { publicMcpUrl };
                return okResult(
                    (client ?? 'chatgpt') === 'claude'
                        ? readClaudeConnectorProfileReport(input, config)
                        : readChatGptConnectorProfileReport(input, config),
                );
            }
            if (projection === 'url-check') {
                if (client !== undefined || scopes !== undefined) {
                    return errorResult('client/scopes are not valid with view=url-check.', {
                        code: 'ERR_CONNECTION_VIEW_FIELDS',
                        view: projection,
                    });
                }
                if (typeof publicMcpUrl !== 'string' || publicMcpUrl.trim().length === 0) {
                    return errorResult('view=url-check requires publicMcpUrl.', {
                        code: 'ERR_CONNECTION_URL_REQUIRED',
                    });
                }
                return okResult(checkChatGptConnectorUrl(publicMcpUrl));
            }
            if (projection === 'current-url') {
                if (client !== undefined || publicMcpUrl !== undefined || scopes !== undefined) {
                    return errorResult('client/publicMcpUrl/scopes are not valid with view=current-url.', {
                        code: 'ERR_CONNECTION_VIEW_FIELDS',
                        view: projection,
                    });
                }
                return okResult(await readChatGptConnectorCurrentUrlStatus(config));
            }
            if (projection === 'auth-profile') {
                if (client !== undefined || publicMcpUrl !== undefined) {
                    return errorResult('client/publicMcpUrl are not valid with view=auth-profile.', {
                        code: 'ERR_CONNECTION_VIEW_FIELDS',
                        view: projection,
                    });
                }
                return okResult(readMcpConnectionAuthProfile({ scopes }, config.owner));
            }
            if (client !== undefined || scopes !== undefined) {
                return errorResult('client/scopes require view=profile or view=auth-profile.', {
                    code: 'ERR_CONNECTION_VIEW_FIELDS',
                    view: projection,
                });
            }
            return okResult(await readMcpConnectionReadiness({ publicMcpUrl }, config));
        },
    }),
    defineMcpRawTool({
        name: 'mcp_oauth_issuer_diagnostics',
        title: 'MCP OAuth issuer diagnostics',
        description:
            'Probe OAuth authorization-server well-known metadata readiness without exposing secrets or fetching local/private hosts by default.',
        inputSchema: {
            issuer: z
                .string()
                .max(MAX_URL_LENGTH)
                .optional()
                ['describe'](
                    'Optional HTTPS OAuth issuer base URL. Defaults to COPILOT_MCP_OAUTH_EXPECTED_ISSUER or COPILOT_MCP_OAUTH_ISSUER.',
                ),
            timeoutMs: z
                .number()
                .int()
                .min(MIN_DIAGNOSTIC_TIMEOUT_MS)
                .max(MAX_DIAGNOSTIC_TIMEOUT_MS)
                .optional()
                ['describe']('Per-request timeout in milliseconds.'),
        },

        handler: async ({ issuer, timeoutMs }, operationContext) => {
            const config = requireMcpToolConnectionConfig(operationContext);
            return okResult(await diagnoseMcpOAuthIssuer({ issuer, timeoutMs }, config.owner));
        },
    }),
];
