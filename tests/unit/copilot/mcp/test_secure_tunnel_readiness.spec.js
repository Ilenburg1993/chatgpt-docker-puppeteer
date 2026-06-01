// @ts-check
/** Tests for OpenAI Secure MCP Tunnel readiness audit. */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { auditOpenAiSecureMcpTunnelReadiness } from '#copilot/mcp/openai';

describe('OpenAI Secure MCP Tunnel readiness audit', () => {
    it('reports blockers when tunnel credentials are absent', () => {
        const result = auditOpenAiSecureMcpTunnelReadiness({ env: {}, pathEnv: '' });

        assert.equal(result.success, true);
        assert.equal(result.ok, false);
        const readiness = /** @type {{ blockers: string[]; warnings: string[] }} */ (result.readiness);
        assert.ok(readiness.blockers.some((item) => item.includes('tunnel_id')));
        assert.ok(readiness.blockers.some((item) => item.includes('runtime credential')));
        assert.ok(readiness.warnings.some((item) => item.includes('tunnel-client')));
        assert.match(JSON.stringify(result.costPosture), /do-not-proceed-if-paid-or-plan-upgrade-required/u);
    });

    it('does not expose raw secret-like environment values', () => {
        const result = auditOpenAiSecureMcpTunnelReadiness({
            env: {
                OPENAI_MCP_TUNNEL_ID: 'tunnel_0123456789abcdef0123456789abcdef',
                CONTROL_PLANE_API_KEY: 'sk-test-secret-value',
                PATH: '',
            },
            pathEnv: '',
        });
        const text = JSON.stringify(result);

        assert.equal(result.ok, true);
        assert.doesNotMatch(text, /sk-test-secret-value/u);
        assert.doesNotMatch(text, /tunnel_0123456789abcdef0123456789abcdef/u);
    });
});
