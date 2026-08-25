// @ts-check
/**
 * Plan-only desired Cloudflare edge policy for the Copilot MCP hostname.
 *
 * @module copilot/mcp/cloudflare/edge-policy-plan
 */

import { readCloudflareRemoteApiConfig } from '../remote/public/runtime.js';
import {
    buildCloudflareCacheBypassRoutesExpression,
    buildCloudflareMcpCompressionBypassExpression,
    buildCloudflareOAuthTokenOrAnonymousMcpExpression,
    buildCloudflarePublicMetadataCacheExpression,
} from '../routes.js';

/**
 * @param {{ authority?: import('../environment-authority.js').CloudflareEnvironmentAuthority; env?: NodeJS.ProcessEnv }} [options]
 * @returns {Promise<Record<string, unknown> & { ok: boolean }>}
 */
export async function buildCloudflareEdgePolicyPlan(options = {}) {
    const config = await readCloudflareRemoteApiConfig(options);
    const hostname = config.publicHostname;
    const cacheBypassExpression = buildCloudflareCacheBypassRoutesExpression(hostname);
    const publicMetadataCacheExpression = buildCloudflarePublicMetadataCacheExpression(hostname);
    const mcpCompressionBypassExpression = buildCloudflareMcpCompressionBypassExpression(hostname);
    const constrainedRateLimitExpression = buildCloudflareOAuthTokenOrAnonymousMcpExpression(hostname);

    return {
        ok: true,
        success: true,
        mode: 'plan-only',
        appliesChanges: false,
        endpoint: {
            publicHostname: hostname,
            publicMcpUrl: config.expectedPublicMcpUrl,
            zone: config.zone,
        },
        desiredRulesets: [
            {
                phase: 'http_request_cache_settings',
                name: 'MCP cache policy',
                rationale:
                    'Bypass request-specific MCP/OAuth runtime traffic, but allow short edge TTL for public GET-only discovery metadata.',
                rules: [
                    {
                        description: 'Bypass cache for MCP runtime and OAuth token routes',
                        expression: cacheBypassExpression,
                        action: 'set_cache_settings',
                        actionParameters: {
                            cache: false,
                        },
                    },
                    {
                        description: 'Short-cache public MCP/OAuth discovery metadata',
                        expression: publicMetadataCacheExpression,
                        action: 'set_cache_settings',
                        actionParameters: {
                            cache: true,
                            edgeTtl: { mode: 'override_origin', default: 300 },
                            browserTtl: { mode: 'override_origin', default: 60 },
                        },
                        safety: {
                            requiresGetOnly: true,
                            excludes: ['/mcp', '/oauth/*', '/health'],
                        },
                    },
                ],
            },
            {
                phase: 'http_response_compression',
                name: 'MCP compression policy',
                rationale:
                    'Disable edge compression for /mcp JSON-RPC because identity transfer was materially faster and more stable for tools/list in benchmark data.',
                rules: [
                    {
                        description: 'Disable compression for MCP JSON-RPC responses',
                        expression: mcpCompressionBypassExpression,
                        action: 'compress_response',
                        actionParameters: {
                            algorithms: [],
                        },
                        safety: {
                            requiresPathOnly: ['/mcp', '/mcp/*'],
                            excludes: ['/.well-known/*', '/chatgpt-connector.json', '/oauth/*', '/health'],
                        },
                    },
                ],
            },
            {
                phase: 'http_ratelimit',
                name: 'MCP constrained rate limit policy',
                rationale:
                    'Cloudflare plan capacity allows one http_ratelimit rule here; protect /oauth/token and anonymous /mcp while authenticated MCP sessions stay high-capacity.',
                rules: [
                    {
                        description: 'Moderate /oauth/token and anonymous /mcp burst control',
                        expression: constrainedRateLimitExpression,
                        action: 'block',
                        manualReviewRequired: true,
                        ref: 'copilot-mcp-oauth-token-rate-limit-v1',
                        covers: ['/oauth/token', 'anonymous /mcp without Authorization header'],
                        rateLimitDraft: {
                            periodSeconds: 10,
                            requestsPerPeriod: 20,
                            mitigationTimeoutSeconds: 10,
                            equivalentPerMinute: 120,
                            characteristics: ['cf.colo.id', 'ip.src'],
                        },
                    },
                ],
            },
        ],
        nonInterferenceRules: [
            {
                category: 'waf',
                invariant: 'Do not add managed_challenge, js_challenge, challenge or broad block actions to /mcp.',
            },
            {
                category: 'access',
                invariant: 'Do not put interactive Cloudflare Access, mTLS or browser-only checks in front of /mcp.',
            },
            {
                category: 'transforms',
                invariant:
                    'Do not rewrite Authorization, WWW-Authenticate, Set-Cookie, Location, Content-Type, Cache-Control or CORS headers.',
            },
            {
                category: 'streaming',
                invariant: 'Do not transform Streamable HTTP responses in a way that buffers or changes MCP framing.',
            },
        ],
        recommendedSequence: [
            'Run make copilot-mcp-edge-audit and keep the JSON output as the actual state snapshot.',
            'Create or edit Cloudflare rules manually in dashboard/API only after confirming expressions against the current Cloudflare Ruleset syntax.',
            'Apply one ruleset phase at a time: cache bypass first, then the single constrained rate-limit rule covering /oauth/token plus anonymous /mcp.',
            'After each phase, run make copilot-mcp-remote-audit, make copilot-mcp-edge-audit and make copilot-mcp-smoke-refresh.',
            'Keep this command plan-only until backup/diff/rollback tooling exists.',
        ],
    };
}
