// @ts-check
/**
 * Plan-only desired Cloudflare edge policy for the Copilot MCP hostname.
 *
 * @module copilot/mcp/cloudflare/edge-policy-plan
 */

import { readCloudflareRemoteApiConfig } from './remote-api.js';

/**
 * @param {{ env?: NodeJS.ProcessEnv }} [options]
 * @returns {Promise<Record<string, unknown> & { ok: boolean }>}
 */
export async function buildCloudflareEdgePolicyPlan(options = {}) {
    const config = await readCloudflareRemoteApiConfig(options.env ?? process.env);
    const hostname = config.publicHostname;
    const hostExpression = `http.host eq "${hostname}"`;
    const mcpPathExpression = `starts_with(http.request.uri.path, "/mcp")`;
    const oauthPathExpression = `starts_with(http.request.uri.path, "/oauth/")`;
    const wellKnownPathExpression = `starts_with(http.request.uri.path, "/.well-known/")`;
    const healthPathExpression = `http.request.uri.path eq "/health"`;
    const dynamicPathsExpression = [
        mcpPathExpression,
        oauthPathExpression,
        wellKnownPathExpression,
        healthPathExpression,
    ].join(' or ');
    const dynamicExpression = `(${hostExpression} and (${dynamicPathsExpression}))`;
    const anonymousMcpExpression = `(${hostExpression} and ${mcpPathExpression} and not exists http.request.headers["authorization"][0])`;
    const oauthTokenExpression = `(${hostExpression} and http.request.uri.path eq "/oauth/token")`;

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
                name: 'MCP dynamic routes cache bypass',
                rationale: 'MCP, OAuth discovery, OAuth token and health responses must never be cached by the edge.',
                rules: [
                    {
                        description: 'Bypass cache for MCP/OAuth dynamic routes',
                        expression: dynamicExpression,
                        action: 'set_cache_settings',
                        actionParameters: {
                            cache: false,
                        },
                    },
                ],
            },
            {
                phase: 'http_ratelimit',
                name: 'MCP OAuth token endpoint protection',
                rationale:
                    'The token endpoint should be protected from bursts without creating friction for already-authenticated MCP calls.',
                rules: [
                    {
                        description: 'Moderate /oauth/token burst control',
                        expression: oauthTokenExpression,
                        action: 'block',
                        manualReviewRequired: true,
                        rateLimitDraft: {
                            periodSeconds: 60,
                            requestsPerPeriod: 120,
                            mitigationTimeoutSeconds: 60,
                        },
                    },
                ],
            },
            {
                phase: 'http_ratelimit',
                name: 'MCP anonymous request protection',
                rationale:
                    'Authenticated ChatGPT/Claude sessions should stay high-capacity; anonymous /mcp traffic can be bounded.',
                rules: [
                    {
                        description: 'Bound anonymous /mcp traffic',
                        expression: anonymousMcpExpression,
                        action: 'block',
                        manualReviewRequired: true,
                        rateLimitDraft: {
                            periodSeconds: 60,
                            requestsPerPeriod: 240,
                            mitigationTimeoutSeconds: 60,
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
            'Apply one ruleset phase at a time: cache bypass first, then token endpoint rate limit, then anonymous /mcp protection.',
            'After each phase, run make copilot-mcp-remote-audit, make copilot-mcp-edge-audit and make copilot-mcp-smoke-refresh.',
            'Keep this command plan-only until backup/diff/rollback tooling exists.',
        ],
    };
}
