import { describe, expect, it } from 'vitest';
import { compareRemoteConfig, parseEnvFile } from '#copilot/mcp/cloudflare';
import { getCloudflareClient } from '../../../../src/copilot/mcp/cloudflare/remote-api.js';

/**
 * @returns {import('#copilot/mcp/cloudflare').CloudflareRemoteApiConfig}
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
            parseEnvFile(`
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
        const remote = /** @type {{ config: { hostnameRule?: { matchesExpectedOrigin?: boolean } } }} */ (result.remote);
        expect(remote.config.hostnameRule?.matchesExpectedOrigin).toBe(false);
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
        const remote = /** @type {{ config: { hostnameRule?: { matchesExpectedOrigin?: boolean } }; connections: { active: number } }} */ (
            result.remote
        );
        expect(remote.config.hostnameRule?.matchesExpectedOrigin).toBe(true);
        expect(remote.connections.active).toBe(1);
    });
});
