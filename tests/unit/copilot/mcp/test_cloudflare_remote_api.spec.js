import { describe, expect, it } from 'vitest';
import { compareRemoteConfig, parseEnvFile } from '../../../../src/copilot/mcp/cloudflare/remote-api.js';

describe('mcp/cloudflare/remote-api', () => {
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
            {
                tunnelName: 'workspace-mcp-dev',
                publicHostname: 'mcp.aurelin.org',
                expectedOriginUrl: 'http://127.0.0.1:3333',
                expectedPublicMcpUrl: 'https://mcp.aurelin.org/mcp',
                zone: 'aurelin.org',
                credentialSources: [],
            },
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
        expect(result.remote.config.hostnameRule?.matchesExpectedOrigin).toBe(false);
    });

    it('accepts the canonical permanent tunnel ingress', () => {
        const result = compareRemoteConfig(
            {
                tunnelName: 'workspace-mcp-dev',
                publicHostname: 'mcp.aurelin.org',
                expectedOriginUrl: 'http://127.0.0.1:3333',
                expectedPublicMcpUrl: 'https://mcp.aurelin.org/mcp',
                zone: 'aurelin.org',
                credentialSources: [],
            },
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
        expect(result.remote.config.hostnameRule?.matchesExpectedOrigin).toBe(true);
        expect(result.remote.connections.active).toBe(1);
    });
});
