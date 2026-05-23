// @ts-check
/**
 * Cloudflare Tunnel config helpers for the Copilot MCP endpoint.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
    buildTemporaryConnectorUrl,
    DEFAULT_QUICK_TUNNEL_STALE_AFTER_MS,
    extractTryCloudflareUrl,
    buildManagedTunnelArgs,
    buildQuickTunnelArgs,
    DEFAULT_CLOUDFLARE_PUBLIC_URL,
    normalizeOriginUrl,
    normalizeStateFile,
    normalizeStaleAfterMs,
    normalizeTunnelMode,
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
        assert.equal(config.mode, 'named-permanent');
        assert.equal(config.tunnelName, 'workspace-mcp-dev');
        assert.equal(config.zone, 'aurelin.org');
        assert.equal(config.publicMcpUrl, DEFAULT_CLOUDFLARE_PUBLIC_URL);
        assert.equal(config.managedTunnelPidFile, 'src/copilot/.ai/cloudflare/cloudflared.pid');
        assert.equal(config.mcpHttpPidFile, 'src/copilot/.ai/cloudflare/mcp-http.pid');
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
        assert.deepEqual(buildManagedTunnelArgs(undefined, 'src/copilot/.ai/cloudflare/workspace-mcp-dev.token'), [
            'tunnel',
            '--no-autoupdate',
            'run',
            '--token-file',
            'src/copilot/.ai/cloudflare/workspace-mcp-dev.token',
        ]);
        assert.throws(() => buildManagedTunnelArgs(undefined), /CLOUDFLARE_TUNNEL_TOKEN/);
    });

    it('keeps temporary quick tunnel as an explicit fallback mode', () => {
        assert.equal(normalizeTunnelMode('temporary-quick'), 'temporary-quick');
        const config = readCloudflareTunnelConfig({
            COPILOT_MCP_CLOUDFLARE_MODE: 'temporary-quick',
        });
        assert.equal(config.mode, 'temporary-quick');
        assert.equal(config.publicMcpUrl, undefined);
    });

    it('validates configured ChatGPT public URLs', () => {
        const config = readCloudflareTunnelConfig({
            COPILOT_MCP_CLOUDFLARE_PUBLIC_URL: 'https://repo-mcp.example.com',
        });
        assert.equal(config.publicMcpUrl, 'https://repo-mcp.example.com/mcp');
        assert.deepEqual(validateConfiguredPublicUrl(config), { ok: true });
    });

    it('extracts and normalizes temporary trycloudflare connector URLs', () => {
        const text =
            'Your quick Tunnel has been created! Visit it at https://alpha-beta-gamma.trycloudflare.com';
        assert.equal(extractTryCloudflareUrl(text), 'https://alpha-beta-gamma.trycloudflare.com');
        assert.equal(
            buildTemporaryConnectorUrl('https://alpha-beta-gamma.trycloudflare.com'),
            'https://alpha-beta-gamma.trycloudflare.com/mcp',
        );
        assert.throws(() => buildTemporaryConnectorUrl('https://example.com'), /trycloudflare\.com/);
    });

    it('keeps the temporary tunnel state path configurable', () => {
        assert.equal(normalizeStateFile(undefined), 'src/copilot/.ai/cloudflare/quick-tunnel.json');
        assert.equal(normalizeStateFile('tmp/state.json'), 'tmp/state.json');
        assert.throws(() => normalizeStateFile('bad\0path'), /null bytes/);
    });

    it('normalizes the temporary tunnel stale window', () => {
        assert.equal(normalizeStaleAfterMs(undefined), DEFAULT_QUICK_TUNNEL_STALE_AFTER_MS);
        assert.equal(normalizeStaleAfterMs('120000.4'), 120000);
        assert.throws(() => normalizeStaleAfterMs('59999'), /stale window/);
        assert.throws(() => normalizeStaleAfterMs(String(8 * 24 * 60 * 60 * 1000)), /stale window/);
        assert.throws(() => normalizeStaleAfterMs('not-a-number'), /stale window/);
    });

    it('accepts official Cloudflare transport protocol overrides', () => {
        assert.equal(normalizeTransportProtocol('auto'), 'auto');
        assert.equal(normalizeTransportProtocol('quic'), 'quic');
        assert.throws(() => normalizeTransportProtocol('udp'), /auto, http2, or quic/);
    });
});
