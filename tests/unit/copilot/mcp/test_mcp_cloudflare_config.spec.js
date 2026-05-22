// @ts-check
/**
 * Cloudflare Tunnel config helpers for the Copilot MCP endpoint.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
    buildManagedTunnelArgs,
    buildQuickTunnelArgs,
    normalizeOriginUrl,
    normalizeTransportProtocol,
    readCloudflareTunnelConfig,
    validateConfiguredPublicUrl,
} from '../../../../src/copilot/mcp/cloudflare/config.js';

describe('copilot MCP Cloudflare Tunnel config', () => {
    it('normalizes the MCP origin to a root HTTP URL', () => {
        assert.equal(normalizeOriginUrl('http://127.0.0.1:3333/mcp/'), 'http://127.0.0.1:3333');
    });

    it('builds quick and remotely-managed cloudflared commands', () => {
        const config = readCloudflareTunnelConfig({
            COPILOT_MCP_CLOUDFLARE_ORIGIN_URL: 'http://127.0.0.1:3333',
            CLOUDFLARE_TUNNEL_TOKEN: 'secret-token',
        });
        assert.deepEqual(buildQuickTunnelArgs(config), [
            'tunnel',
            '--url',
            'http://127.0.0.1:3333',
            '--no-autoupdate',
        ]);
        assert.equal(config.transportProtocol, 'http2');
        assert.deepEqual(buildManagedTunnelArgs('secret-token'), [
            'tunnel',
            '--no-autoupdate',
            'run',
            '--token',
            'secret-token',
        ]);
        assert.throws(() => buildManagedTunnelArgs(undefined), /CLOUDFLARE_TUNNEL_TOKEN/);
    });

    it('validates configured ChatGPT public URLs', () => {
        const config = readCloudflareTunnelConfig({
            COPILOT_MCP_CLOUDFLARE_PUBLIC_URL: 'https://repo-mcp.example.com',
        });
        assert.equal(config.publicMcpUrl, 'https://repo-mcp.example.com/mcp');
        assert.deepEqual(validateConfiguredPublicUrl(config), { ok: true });
    });

    it('accepts official Cloudflare transport protocol overrides', () => {
        assert.equal(normalizeTransportProtocol('auto'), 'auto');
        assert.equal(normalizeTransportProtocol('quic'), 'quic');
        assert.throws(() => normalizeTransportProtocol('udp'), /auto, http2, or quic/);
    });
});
