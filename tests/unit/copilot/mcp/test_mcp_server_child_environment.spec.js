// @ts-check

import { MCP_RUNTIME_SOURCE_PROMOTION_ENV } from '#copilot/mcp/public/runtime/source-generation';
import { buildMcpServerChildEnvironment } from '#copilot/testing/mcp/composition/cloudflare-cli';
import { describe, expect, it } from 'vitest';

describe('MCP server child environment composition', () => {
    it('projects application authorities without inheriting unrelated or tunnel-lifecycle secrets', () => {
        const parentEnv = {
            PATH: '/usr/local/bin:/usr/bin',
            HOME: '/tmp/mcp-server-child-home',
            COPILOT_MCP_AUTH_MODE: 'oauth',
            COPILOT_MCP_STATIC_BEARER_TOKEN: 'mcp-server-secret',
            COPILOT_MCP_HTTP_SESSION_ID_HASH_SECRET: 'session-hash-secret',
            [MCP_RUNTIME_SOURCE_PROMOTION_ENV.requestId]: 'mcp-reload-cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            [MCP_RUNTIME_SOURCE_PROMOTION_ENV.sourceBarrierFingerprint]: 'd'.repeat(64),
            [MCP_RUNTIME_SOURCE_PROMOTION_ENV.sourceBarrierManifestPath]:
                'src/copilot/.ai/mcp/promotion/source-barrier.json',
            OPENAI_API_KEY: 'openai-provider-secret',
            ANTHROPIC_API_KEY: 'anthropic-provider-secret',
            COPILOT_CONNECTION_TOKEN: 'copilot-model-secret',
            CLOUDFLARE_API_TOKEN: 'cloudflare-remote-api-secret',
            CLOUDFLARE_ACCOUNT_ID: 'cloudflare-account',
            CLOUDFLARE_TUNNEL_TOKEN: 'must-stay-in-parent-tunnel-lifecycle',
            CLOUDFLARE_TUNNEL_TOKEN_FILE: '/tmp/cloudflared-token-file',
            DEVCONTAINER_ENABLE_NETWORK_CONTROL_PLANE_STATE: 'true',
            AURELIN_UNRELATED_SECRET: 'must-not-cross',
            FUTURE_UNKNOWN_SECRET: 'must-not-cross-either',
        };

        const child = buildMcpServerChildEnvironment(parentEnv, {
            COPILOT_MCP_PORT: '4444',
            COPILOT_MCP_ORIGIN_TRANSPORT: 'http2',
        });

        expect(child['PATH']).toBe(parentEnv.PATH);
        expect(child['COPILOT_MCP_AUTH_MODE']).toBe('oauth');
        expect(child['COPILOT_MCP_STATIC_BEARER_TOKEN']).toBe('mcp-server-secret');
        expect(child['COPILOT_MCP_HTTP_SESSION_ID_HASH_SECRET']).toBe('session-hash-secret');
        expect(child[MCP_RUNTIME_SOURCE_PROMOTION_ENV.requestId]).toBe(
            'mcp-reload-cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        );
        expect(child[MCP_RUNTIME_SOURCE_PROMOTION_ENV.sourceBarrierFingerprint]).toBe('d'.repeat(64));
        expect(child[MCP_RUNTIME_SOURCE_PROMOTION_ENV.sourceBarrierManifestPath]).toBe(
            'src/copilot/.ai/mcp/promotion/source-barrier.json',
        );
        expect(child['OPENAI_API_KEY']).toBe('openai-provider-secret');
        expect(child['ANTHROPIC_API_KEY']).toBe('anthropic-provider-secret');
        expect(child['COPILOT_CONNECTION_TOKEN']).toBe('copilot-model-secret');
        expect(child['CLOUDFLARE_API_TOKEN']).toBe('cloudflare-remote-api-secret');
        expect(child['CLOUDFLARE_ACCOUNT_ID']).toBe('cloudflare-account');
        expect(child['CLOUDFLARE_TUNNEL_TOKEN_FILE']).toBe('/tmp/cloudflared-token-file');
        expect(child['DEVCONTAINER_ENABLE_NETWORK_CONTROL_PLANE_STATE']).toBe('true');
        expect(child['COPILOT_MCP_PORT']).toBe('4444');
        expect(child['COPILOT_MCP_ORIGIN_TRANSPORT']).toBe('http2');

        expect(child['CLOUDFLARE_TUNNEL_TOKEN']).toBeUndefined();
        expect(child['AURELIN_UNRELATED_SECRET']).toBeUndefined();
        expect(child['FUTURE_UNKNOWN_SECRET']).toBeUndefined();
        expect(Object.isFrozen(child)).toBe(true);
    });

    it('applies explicit null overrides as revocation', () => {
        const child = buildMcpServerChildEnvironment(
            { PATH: '/usr/bin', COPILOT_MCP_AUTH_MODE: 'oauth' },
            { COPILOT_MCP_AUTH_MODE: null },
        );
        expect(child['COPILOT_MCP_AUTH_MODE']).toBeUndefined();
    });
});
