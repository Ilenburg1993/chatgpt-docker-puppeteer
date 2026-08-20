// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { auditOriginRequestProfile, buildRecommendedOriginRequestPatch } from '#copilot/mcp/cloudflare';

describe('copilot MCP Cloudflare origin profile', () => {
    it('keeps origin h2 disabled by default', () => {
        assert.equal(buildRecommendedOriginRequestPatch({})['http2Origin'], false);
    });

    it('enables origin h2 only for explicit HTTPS rollout', () => {
        assert.equal(
            buildRecommendedOriginRequestPatch({
                originServiceUrl: 'https://127.0.0.1:3333',
                enableHttp2Origin: true,
            })['http2Origin'],
            true,
        );
        assert.equal(
            buildRecommendedOriginRequestPatch({
                originServiceUrl: 'https://127.0.0.1:3333',
                enableHttp2Origin: false,
            })['http2Origin'],
            false,
        );
    });

    it('keeps current HTTP origin protected from accidental h2 origin enablement', () => {
        const audit = auditOriginRequestProfile(
            { http2Origin: true },
            { hostnameRulePresent: true, originServiceUrl: 'http://127.0.0.1:3333', enableHttp2Origin: false },
        );
        assert.ok(audit.critical.some((item) => item.includes('http2Origin=true')));
    });

    it('accepts h2 origin when HTTPS origin and rollout flag are both selected', () => {
        const audit = auditOriginRequestProfile(
            { http2Origin: true },
            { hostnameRulePresent: true, originServiceUrl: 'https://127.0.0.1:3333', enableHttp2Origin: true },
        );
        assert.equal(audit.critical.length, 0);
        assert.equal(audit.applyPlan['http2Origin'], true);
    });
});
