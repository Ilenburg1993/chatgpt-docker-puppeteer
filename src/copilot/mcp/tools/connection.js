// @ts-check
/**
 * ChatGPT / Claude connection MCP wire tools.
 *
 * Connector/OAuth/readiness authority belongs to the connection owner. This module owns wire schemas, annotations and
 * MCP result framing only.
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
import { okResult } from '#copilot/mcp/public/protocol/tools';
import { z } from 'zod';

const {
    minTimeoutMs: MIN_DIAGNOSTIC_TIMEOUT_MS,
    maxTimeoutMs: MAX_DIAGNOSTIC_TIMEOUT_MS,
    maxUrlLength: MAX_URL_LENGTH,
} = MCP_CONNECTION_DIAGNOSTIC_LIMITS;

/** @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition[]} */
export const connectionTools = [
    defineMcpRawTool({
        name: 'chatgpt_connector_profile',
        title: 'ChatGPT connector profile',
        description:
            'Return the canonical ChatGPT connector form values, tunnel checklist, OAuth posture, HTTP/2+ posture, and smoke prompts for this repo MCP server.',
        inputSchema: {
            publicMcpUrl: z
                .string()
                .optional()
                ['describe']('Optional public HTTPS /mcp URL from Cloudflare Tunnel or Secure MCP Tunnel.'),
        },

        handler: async ({ publicMcpUrl }, operationContext) =>
            okResult(
                readChatGptConnectorProfileReport({ publicMcpUrl }, requireMcpToolConnectionConfig(operationContext)),
            ),
    }),
    defineMcpRawTool({
        name: 'claude_connector_profile',
        title: 'Claude connector profile',
        description:
            'Return the canonical Claude custom connector form values, OAuth notes, Cloudflare HTTP/2+ checks and smoke prompts for this repo MCP server.',
        inputSchema: {
            publicMcpUrl: z
                .string()
                .optional()
                ['describe']('Optional public HTTPS /mcp URL. Defaults to the permanent Cloudflare hostname.'),
        },

        handler: async ({ publicMcpUrl }, operationContext) =>
            okResult(
                readClaudeConnectorProfileReport({ publicMcpUrl }, requireMcpToolConnectionConfig(operationContext)),
            ),
    }),
    defineMcpRawTool({
        name: 'chatgpt_connector_url_check',
        title: 'Check ChatGPT connector URL',
        description: 'Validate that a candidate ChatGPT connector URL is HTTPS, canonical and ends with /mcp.',
        inputSchema: {
            publicMcpUrl: z.string().min(1).max(MAX_URL_LENGTH)['describe']('Candidate public connector URL.'),
        },

        handler: async ({ publicMcpUrl }) => okResult(checkChatGptConnectorUrl(publicMcpUrl)),
    }),
    defineMcpRawTool({
        name: 'chatgpt_connector_current_url_status',
        title: 'Current ChatGPT connector URL status',
        description:
            'Return the currently saved ChatGPT connector URL, validation, tunnel age, OAuth readiness and HTTP/2+ posture without requiring the client to pass a public URL.',
        inputSchema: {},

        handler: async (_args, operationContext) =>
            okResult(await readChatGptConnectorCurrentUrlStatus(requireMcpToolConnectionConfig(operationContext))),
    }),
    defineMcpRawTool({
        name: 'mcp_auth_profile',
        title: 'MCP auth profile',
        description:
            'Return the current MCP auth mode, protected resource metadata, scopes, WWW-Authenticate challenge preview, environment templates and rollout gates.',
        inputSchema: {
            scopes: z
                .array(z.string().min(1).max(128))
                .max(16)
                .optional()
                ['describe']('Optional scopes to include in the challenge preview.'),
        },

        handler: async ({ scopes }, operationContext) => {
            const config = requireMcpToolConnectionConfig(operationContext);
            return okResult(readMcpConnectionAuthProfile({ scopes }, config.owner));
        },
    }),
    defineMcpRawTool({
        name: 'mcp_oauth_issuer_diagnostics',
        title: 'MCP OAuth issuer diagnostics',
        description:
            'Check OAuth authorization server well-known metadata readiness for ChatGPT/MCP without exposing secrets or fetching local/private hosts by default.',
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
    defineMcpRawTool({
        name: 'mcp_connection_readiness',
        title: 'MCP connection readiness',
        description:
            'Return one consolidated read-only readiness report for ChatGPT/Claude connector setup, OAuth metadata, Cloudflare tunnel state, HTTP/2+ posture and smoke gates.',
        inputSchema: {
            publicMcpUrl: z
                .string()
                .max(MAX_URL_LENGTH)
                .optional()
                ['describe']('Optional public HTTPS /mcp URL to validate instead of the configured/current URL.'),
        },

        handler: async ({ publicMcpUrl }, operationContext) =>
            okResult(
                await readMcpConnectionReadiness({ publicMcpUrl }, requireMcpToolConnectionConfig(operationContext)),
            ),
    }),
];
