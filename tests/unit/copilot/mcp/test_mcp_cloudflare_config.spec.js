// @ts-check
/**
 * Cloudflare Tunnel config helpers for the Copilot MCP endpoint.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
    buildManagedTunnelArgs,
    buildQuickTunnelArgs,
    buildTemporaryConnectorUrl,
    DEFAULT_CLOUDFLARE_PUBLIC_URL,
    DEFAULT_QUICK_TUNNEL_STALE_AFTER_MS,
    extractTryCloudflareUrl,
    normalizeOriginUrl,
    normalizePublicHostname,
    normalizeStaleAfterMs,
    normalizeStateFile,
    normalizeTransportProtocol,
    normalizeTunnelMode,
    readCloudflareTunnelConfig,
    validateConfiguredPublicUrl,
} from '#copilot/mcp/public/cloudflare/config';

describe('copilot MCP Cloudflare Tunnel config', () => {
    it('normalizes the MCP origin to a root HTTP URL', () => {
        assert.equal(
            normalizeOriginUrl('http://127.0.0.1:3333/mcp/', { originTransport: 'http' }),
            'http://127.0.0.1:3333',
        );
    });

    it('builds quick and remotely-managed cloudflared commands', () => {
        const config = readCloudflareTunnelConfig({
            CLOUDFLARE_TUNNEL_TOKEN: 'secret-token',
        });
        assert.equal(config.mode, 'named-permanent');
        assert.equal(config.tunnelName, 'workspace-mcp-dev');
        assert.equal(config.zone, 'aurelin.org');
        assert.equal(config.publicMcpUrl, DEFAULT_CLOUDFLARE_PUBLIC_URL);
        assert.equal(config.managedTunnelPidFile, 'src/copilot/.ai/cloudflare/cloudflared.pid');
        assert.equal(config.mcpHttpPidFile, 'src/copilot/.ai/cloudflare/mcp-http.pid');
        assert.equal(config.managedTunnelLogFile, 'src/copilot/.ai/cloudflare/cloudflared.log');
        assert.equal(config.mcpHttpLogFile, 'src/copilot/.ai/cloudflare/mcp-http.log');
        assert.equal(config.metricsAddr, '127.0.0.1:60123');
        assert.equal(config.loglevel, 'info');
        assert.deepEqual(buildQuickTunnelArgs(config), [
            'tunnel',
            '--no-autoupdate',
            '--loglevel',
            'info',
            '--protocol',
            'auto',
            '--metrics',
            '127.0.0.1:60123',
            '--origin-server-name',
            'mcp.aurelin.org',
            '--url',
            'https://127.0.0.1:3333',
        ]);
        assert.equal(config.transportProtocol, 'auto');
        assert.deepEqual(buildManagedTunnelArgs('secret-token', undefined, config), [
            'tunnel',
            '--no-autoupdate',
            '--loglevel',
            'info',
            '--protocol',
            'auto',
            '--metrics',
            '127.0.0.1:60123',
            '--origin-server-name',
            'mcp.aurelin.org',
            'run',
            '--token',
            'secret-token',
        ]);
        assert.deepEqual(
            buildManagedTunnelArgs(undefined, 'src/copilot/.ai/cloudflare/workspace-mcp-dev.token', config),
            [
                'tunnel',
                '--no-autoupdate',
                '--loglevel',
                'info',
                '--protocol',
                'auto',
                '--metrics',
                '127.0.0.1:60123',
                '--origin-server-name',
                'mcp.aurelin.org',
                'run',
                '--token-file',
                'src/copilot/.ai/cloudflare/workspace-mcp-dev.token',
            ],
        );
        assert.throws(() => buildManagedTunnelArgs(undefined), /CLOUDFLARE_TUNNEL_TOKEN/);
    });

    it('adds origin server name when the tunnel origin is HTTPS', () => {
        const config = readCloudflareTunnelConfig({
            COPILOT_MCP_ORIGIN_TRANSPORT: 'http2',
            COPILOT_MCP_CLOUDFLARE_ORIGIN_URL: 'https://127.0.0.1:3333',
            CLOUDFLARE_TUNNEL_TOKEN: 'secret-token',
        });

        assert.deepEqual(buildQuickTunnelArgs(config), [
            'tunnel',
            '--no-autoupdate',
            '--loglevel',
            'info',
            '--protocol',
            'auto',
            '--metrics',
            '127.0.0.1:60123',
            '--origin-server-name',
            'mcp.aurelin.org',
            '--url',
            'https://127.0.0.1:3333',
        ]);
        assert.deepEqual(buildManagedTunnelArgs('secret-token', undefined, config), [
            'tunnel',
            '--no-autoupdate',
            '--loglevel',
            'info',
            '--protocol',
            'auto',
            '--metrics',
            '127.0.0.1:60123',
            '--origin-server-name',
            'mcp.aurelin.org',
            'run',
            '--token',
            'secret-token',
        ]);
    });

    it('requires the public hostname to be the zone or a real subdomain', () => {
        assert.equal(normalizePublicHostname(undefined, 'workspace-mcp-dev', 'aurelin.org'), 'mcp.aurelin.org');
        assert.equal(
            normalizePublicHostname('https://mcp.aurelin.org/mcp', 'workspace-mcp-dev', 'aurelin.org'),
            'mcp.aurelin.org',
        );
        assert.equal(normalizePublicHostname('aurelin.org', 'workspace-mcp-dev', 'aurelin.org'), 'aurelin.org');
        assert.throws(
            () => normalizePublicHostname('evilaurelin.org', 'workspace-mcp-dev', 'aurelin.org'),
            /configured zone or a subdomain/,
        );
        assert.throws(
            () => normalizePublicHostname('mcp.aurelin.org.attacker.test', 'workspace-mcp-dev', 'aurelin.org'),
            /configured zone or a subdomain/,
        );
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
            COPILOT_MCP_CLOUDFLARE_PUBLIC_HOSTNAME: 'repo-mcp.example.com',
            COPILOT_MCP_CLOUDFLARE_ZONE: 'example.com',
        });
        assert.equal(config.publicMcpUrl, 'https://repo-mcp.example.com/mcp');
        assert.deepEqual(validateConfiguredPublicUrl(config), {
            ok: true,
            normalizedUrl: 'https://repo-mcp.example.com/mcp',
            resource: 'https://repo-mcp.example.com',
        });
    });

    it('extracts and normalizes temporary trycloudflare connector URLs', () => {
        const text = 'Your quick Tunnel has been created! Visit it at https://alpha-beta-gamma.trycloudflare.com';
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
        assert.equal(DEFAULT_QUICK_TUNNEL_STALE_AFTER_MS, 24 * 60 * 60 * 1000);
        assert.equal(normalizeStaleAfterMs(undefined), DEFAULT_QUICK_TUNNEL_STALE_AFTER_MS);
        assert.equal(normalizeStaleAfterMs('120000.4'), 120000);
        assert.equal(normalizeStaleAfterMs(String(24 * 60 * 60 * 1000)), 24 * 60 * 60 * 1000);
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
