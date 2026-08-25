import { compareRemoteConfig } from '#copilot/mcp/public/cloudflare/remote';
import { parseMcpEnvironmentFile } from '#copilot/mcp/public/process/environment';
import { getCloudflareClient } from '#copilot/testing/mcp/cloudflare/remote';
import { describe, expect, it } from 'vitest';
import { compactCloudflareRemoteAudit } from '../../../../src/copilot/mcp/tools/cloudflare-remote.js';

/**
 * @returns {import('#copilot/mcp/public/cloudflare/remote').CloudflareRemoteApiConfig}
 */
function testRemoteConfig() {
    return {
        apiToken: undefined,
        accountId: undefined,
        zoneId: undefined,
        tunnelId: undefined,
        tunnelName: 'workspace-mcp-dev',
        publicHostname: 'mcp.aurelin.org',
        expectedOriginUrl: 'http://127.0.0.1:3333',
        expectedPublicMcpUrl: 'https://mcp.aurelin.org/mcp',
        originServerName: undefined,
        enableHttp2Origin: false,
        zone: 'aurelin.org',
        credentialSources: [],
    };
}

describe('mcp/cloudflare/remote-api', () => {
    it('não colide clientes para tokens com mesmo tamanho, prefixo e sufixo', () => {
        const first = getCloudflareClient('same-edge-aaaaaaaa-different-middle-same-tail');
        const second = getCloudflareClient('same-edge-bbbbbbbb-different-middle-same-tail');

        expect(first).not.toBe(second);
        expect(getCloudflareClient('same-edge-aaaaaaaa-different-middle-same-tail')).toBe(first);
    });

    it('parses local env files without exposing comments', () => {
        expect(
            parseMcpEnvironmentFile(`
# comment
CLOUDFLARE_API_TOKEN="cfat_test"
CLOUDFLARE_ACCOUNT_ID='account'
INVALID-NAME=ignored
EMPTY=
`),
        ).toEqual({
            CLOUDFLARE_API_TOKEN: 'cfat_test',
            CLOUDFLARE_ACCOUNT_ID: 'account',
            EMPTY: '',
        });
    });

    it('marks localhost origin drift as critical', () => {
        const result = compareRemoteConfig(
            testRemoteConfig(),
            {
                id: '0e81ae66-b74d-44db-87ba-73102826ffdf',
                tunnel: {
                    id: '0e81ae66-b74d-44db-87ba-73102826ffdf',
                    name: 'workspace-mcp-dev',
                    status: 'healthy',
                    connections: [{ id: 'connection-1', is_pending_reconnect: false }],
                },
            },
            {
                source: 'cloudflare',
                version: 1,
                config: {
                    ingress: [
                        { hostname: 'mcp.aurelin.org', service: 'http://localhost:3333' },
                        { service: 'http_status:404' },
                    ],
                },
            },
        );

        expect(result.critical).toEqual([
            'Ingress service for mcp.aurelin.org is http://localhost:3333; expected http://127.0.0.1:3333.',
        ]);
        const remote = /** @type {{ config: { hostnameRule?: { matchesExpectedOrigin?: boolean } } }} */ (
            result.remote
        );
        expect(remote.config.hostnameRule?.matchesExpectedOrigin).toBe(false);
    });

    it('compacts remote MCP presentation without repeating the full desired origin profile', () => {
        const compact = compactCloudflareRemoteAudit({
            ok: true,
            success: true,
            mode: 'read-only',
            credentials: { apiTokenPresent: true },
            desired: {
                tunnelName: 'workspace-mcp-dev',
                publicHostname: 'mcp.aurelin.org',
                publicMcpUrl: 'https://mcp.aurelin.org/mcp',
                originService: 'https://127.0.0.1:3333',
                zone: 'aurelin.org',
                desiredOriginRequestProfile: { veryLargeRepeatedProfile: 'omit-me' },
            },
            remote: {
                tunnel: {
                    id: 'tunnel',
                    name: 'workspace-mcp-dev',
                    status: 'healthy',
                    source: 'cfd_tunnel',
                    connections: [
                        { coloName: 'gru20', isPendingReconnect: false, clientVersion: '2026.5.2' },
                        { coloName: 'gru21', isPendingReconnect: false, clientVersion: '2026.5.2' },
                    ],
                },
                config: {
                    source: 'cloudflare',
                    version: 3,
                    catchAllConfigured: true,
                    hostnameRule: {
                        hostname: 'mcp.aurelin.org',
                        service: 'https://127.0.0.1:3333',
                        matchesExpectedOrigin: true,
                        originRequest: { http2Origin: true, noTLSVerify: false, keepAliveConnections: 100 },
                        originRequestFindings: {
                            score: { explicitMatches: 9, explicitRecommendedCount: 9, explicitCoverage: 1 },
                            fieldFindings: [
                                { key: 'http2Origin', status: 'ok' },
                                {
                                    key: 'connectTimeout',
                                    status: 'warning',
                                    actualValue: '30s',
                                    recommendedValue: '5s',
                                    action: 'pin',
                                },
                            ],
                            critical: [],
                            warnings: ['one drift'],
                            desired: { repeated: 'omit-me' },
                        },
                    },
                },
            },
            dns: { checked: true, matchesExpectedTunnel: true, records: [], critical: [], warnings: [] },
            critical: [],
            warnings: [],
            nextActions: [],
        });

        expect(compact.tunnel.connections).toEqual({
            total: 2,
            active: 2,
            colos: ['gru20', 'gru21'],
            clientVersions: ['2026.5.2'],
        });
        expect(compact.config.hostnameRule.drift).toHaveLength(1);
        expect(JSON.stringify(compact)).not.toContain('veryLargeRepeatedProfile');
        expect(JSON.stringify(compact)).not.toContain('repeated');
    });

    it('accepts the canonical permanent tunnel ingress', () => {
        const result = compareRemoteConfig(
            testRemoteConfig(),
            {
                id: '0e81ae66-b74d-44db-87ba-73102826ffdf',
                tunnel: {
                    id: '0e81ae66-b74d-44db-87ba-73102826ffdf',
                    name: 'workspace-mcp-dev',
                    status: 'healthy',
                    connections: [{ id: 'connection-1', is_pending_reconnect: false }],
                },
            },
            {
                source: 'cloudflare',
                version: 2,
                config: {
                    ingress: [
                        { hostname: 'mcp.aurelin.org', service: 'http://127.0.0.1:3333' },
                        { service: 'http_status:404' },
                    ],
                },
            },
        );

        expect(result.critical).toEqual([]);
        expect(result.warnings).toEqual([]);
        const remote =
            /** @type {{ config: { hostnameRule?: { matchesExpectedOrigin?: boolean } }; connections: { active: number } }} */ (
                result.remote
            );
        expect(remote.config.hostnameRule?.matchesExpectedOrigin).toBe(true);
        expect(remote.connections.active).toBe(1);
    });
});
