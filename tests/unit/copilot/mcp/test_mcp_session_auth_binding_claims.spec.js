// @ts-check
/**
 * Tests for verified-claim MCP HTTP session bindings.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { buildMcpSessionAuthBindingFromVerifiedJwtPayload, readMcpAuthConfig } from '#copilot/mcp/public/auth';

describe('MCP session binding from verified JWT claims', () => {
    it('hashes actor identifiers and preserves only non-secret resource, audience and scopes', () => {
        const config = readMcpAuthConfig({
            ...process.env,
            COPILOT_MCP_PUBLIC_URL: 'https://mcp.aurelin.org',
            COPILOT_MCP_OAUTH_EXPECTED_ISSUER: 'https://mcp.aurelin.org',
            COPILOT_MCP_OAUTH_AUDIENCE: 'https://mcp.aurelin.org',
            COPILOT_MCP_OAUTH_ACCEPTED_AUDIENCES: 'https://mcp.aurelin.org,https://mcp.aurelin.org/mcp',
        });
        const binding = buildMcpSessionAuthBindingFromVerifiedJwtPayload(
            {
                iss: 'https://mcp.aurelin.org',
                sub: 'user-123',
                client_id: 'client-abc',
                aud: 'https://mcp.aurelin.org/mcp',
                resource: 'https://mcp.aurelin.org/mcp',
                scope: 'repo:write repo:read unknown:scope',
                scp: ['repo:validate'],
            },
            { config, resourceUrl: 'https://mcp.aurelin.org/mcp' },
        );

        assert.equal(binding.mode, 'oauth');
        assert.equal(binding.resource, 'https://mcp.aurelin.org/mcp');
        assert.equal(binding.audience, 'https://mcp.aurelin.org/mcp');
        assert.deepEqual(binding.scopes, ['repo:read', 'repo:validate', 'repo:write']);
        assert.notEqual(binding.issuerHash, 'https://mcp.aurelin.org');
        assert.notEqual(binding.subjectHash, 'user-123');
        assert.notEqual(binding.clientIdHash, 'client-abc');
        assert.equal(binding.issuerHash.length, 64);
        assert.equal(binding.subjectHash.length, 64);
        assert.equal(binding.clientIdHash.length, 64);
        assert.equal(JSON.stringify(binding).includes('user-123'), false);
        assert.equal(JSON.stringify(binding).includes('client-abc'), false);
    });
});
