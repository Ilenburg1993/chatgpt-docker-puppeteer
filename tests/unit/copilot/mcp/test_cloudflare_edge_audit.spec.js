import { analyzeEdgeRulesets } from '#copilot/mcp/public/cloudflare/edge';
import { describe, expect, it } from 'vitest';

describe('mcp/cloudflare/edge-audit', () => {
    it('accepts explicit cache bypass and rate-limit rules for the MCP hostname', () => {
        const result = analyzeEdgeRulesets(
            [
                {
                    id: 'rule-set-cache',
                    name: 'cache settings',
                    phase: 'http_request_cache_settings',
                    kind: 'zone',
                    version: '1',
                    lastUpdated: null,
                    rules: [
                        {
                            id: 'rule-cache',
                            ref: null,
                            description: 'Bypass MCP dynamic routes',
                            action: 'set_cache_settings',
                            expression:
                                '(http.host eq "mcp.aurelin.org" and starts_with(http.request.uri.path, "/mcp"))',
                            enabled: true,
                            actionParameterKeys: ['cache'],
                            cacheEnabled: false,
                            actionParameterHeaderNames: [],
                        },
                    ],
                },
                {
                    id: 'rule-set-rate',
                    name: 'rate limits',
                    phase: 'http_ratelimit',
                    kind: 'zone',
                    version: '1',
                    lastUpdated: null,
                    rules: [
                        {
                            id: 'rule-token',
                            ref: null,
                            description: 'OAuth token protection',
                            action: 'block',
                            expression: '(http.host eq "mcp.aurelin.org" and http.request.uri.path eq "/oauth/token")',
                            enabled: true,
                            actionParameterKeys: [],
                            cacheEnabled: null,
                            actionParameterHeaderNames: [],
                        },
                        {
                            id: 'rule-mcp',
                            ref: null,
                            description: 'Anonymous MCP protection',
                            action: 'block',
                            expression:
                                '(http.host eq "mcp.aurelin.org" and starts_with(http.request.uri.path, "/mcp"))',
                            enabled: true,
                            actionParameterKeys: [],
                            cacheEnabled: null,
                            actionParameterHeaderNames: [],
                        },
                    ],
                },
            ],
            { publicHostname: 'mcp.aurelin.org' },
        );

        expect(result.critical).toEqual([]);
        expect(result.findings['cacheBypassCandidateCount']).toBe(1);
        expect(result.findings['oauthTokenRateLimitCount']).toBe(1);
        expect(result.findings['mcpRateLimitCount']).toBe(1);
    });

    it('marks interactive challenge rules on /mcp as critical', () => {
        const result = analyzeEdgeRulesets(
            [
                {
                    id: 'rule-set-waf',
                    name: 'custom WAF',
                    phase: 'http_request_firewall_custom',
                    kind: 'zone',
                    version: '1',
                    lastUpdated: null,
                    rules: [
                        {
                            id: 'rule-challenge',
                            ref: null,
                            description: 'Browser challenge',
                            action: 'managed_challenge',
                            expression:
                                '(http.host eq "mcp.aurelin.org" and starts_with(http.request.uri.path, "/mcp"))',
                            enabled: true,
                            actionParameterKeys: [],
                            cacheEnabled: null,
                            actionParameterHeaderNames: [],
                        },
                    ],
                },
            ],
            { publicHostname: 'mcp.aurelin.org' },
        );

        expect(result.critical).toContain(
            'Detected 1 enabled Cloudflare WAF/block/challenge rule(s) that appear to target /mcp.',
        );
    });

    it('marks sensitive header transforms as critical', () => {
        const result = analyzeEdgeRulesets(
            [
                {
                    id: 'rule-set-transform',
                    name: 'response transforms',
                    phase: 'http_response_headers_transform',
                    kind: 'zone',
                    version: '1',
                    lastUpdated: null,
                    rules: [
                        {
                            id: 'rule-transform',
                            ref: null,
                            description: 'Bad auth transform',
                            action: 'rewrite',
                            expression:
                                '(http.host eq "mcp.aurelin.org" and starts_with(http.request.uri.path, "/mcp"))',
                            enabled: true,
                            actionParameterKeys: ['headers'],
                            cacheEnabled: null,
                            actionParameterHeaderNames: ['www-authenticate'],
                        },
                    ],
                },
            ],
            { publicHostname: 'mcp.aurelin.org' },
        );

        expect(result.critical).toContain(
            'Detected 1 enabled transform rule(s) mentioning sensitive MCP/OAuth headers.',
        );
    });
});
