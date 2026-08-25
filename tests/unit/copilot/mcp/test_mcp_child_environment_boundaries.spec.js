// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { buildCloudflareConnectorSmokeEnvironment } from '#copilot/mcp/public/cloudflare/environment';
import {
    buildTransportBenchmarkLaunchEnvironment,
    buildTransportBenchmarkSmokeEnvironment,
} from '#copilot/testing/mcp/cloudflare/transport-benchmark';
import {
    buildControlledReloadRunnerEnvironment,
    readMcpReloadProcessConfig,
} from '#copilot/testing/mcp/runtime/reload';

const parentEnv = /** @type {NodeJS.ProcessEnv} */ ({
    PATH: '/usr/local/bin:/usr/bin:/bin',
    LANG: 'en_US.UTF-8',
    COPILOT_MCP_PUBLIC_URL: 'https://mcp.example.test',
    COPILOT_MCP_CLOUDFLARE_PUBLIC_URL: 'https://mcp.example.test/mcp',
    COPILOT_MCP_CLOUDFLARE_METRICS_ADDR: '127.0.0.1:60123',
    COPILOT_MCP_OAUTH_EXPECTED_ISSUER: 'https://mcp.example.test',
    COPILOT_MCP_PROTOCOL_VERSION: '2026-07-28',
    COPILOT_MCP_STATEFUL_ENV_FILE: 'src/copilot/.ai/mcp/custom-stateful.env',
    COPILOT_MCP_STATIC_BEARER_TOKEN_ENABLED: 'true',
    COPILOT_MCP_STATIC_BEARER_TOKEN: 'ambient-static-bearer-secret',
    CLOUDFLARE_TUNNEL_TOKEN: 'ambient-cloudflare-secret',
    CLOUDFLARE_TUNNEL_TOKEN_FILE: 'src/copilot/.ai/cloudflare/private.token',
    FUTURE_PROVIDER_SUPER_SECRET: 'future-secret-that-must-not-cross',
});

describe('MCP child environment authority boundaries', () => {
    it('projects transport benchmark launch/smoke config without ambient credentials', () => {
        const launch = buildTransportBenchmarkLaunchEnvironment(parentEnv);
        const smoke = buildTransportBenchmarkSmokeEnvironment(parentEnv);

        for (const env of [launch, smoke]) {
            assert.equal(env['PATH'], parentEnv['PATH']);
            assert.equal(env['LANG'], parentEnv['LANG']);
            assert.equal(env['COPILOT_MCP_PUBLIC_URL'], parentEnv['COPILOT_MCP_PUBLIC_URL']);
            assert.equal(env['COPILOT_MCP_CLOUDFLARE_METRICS_ADDR'], '127.0.0.1:60123');
            assert.equal(env['COPILOT_MCP_OAUTH_EXPECTED_ISSUER'], 'https://mcp.example.test');
            assert.equal(env['COPILOT_MCP_PROTOCOL_VERSION'], '2026-07-28');
            assert.equal(env['COPILOT_MCP_AUTH_MODE'], 'oauth');
            assert.equal(env['COPILOT_MCP_AUTH_ENFORCEMENT'], 'all');
            assert.equal(env['COPILOT_MCP_STATIC_BEARER_TOKEN_ENABLED'], undefined);
            assert.equal(env['COPILOT_MCP_STATIC_BEARER_TOKEN'], undefined);
            assert.equal(env['CLOUDFLARE_TUNNEL_TOKEN'], undefined);
            assert.equal(env['CLOUDFLARE_TUNNEL_TOKEN_FILE'], undefined);
            assert.equal(env['FUTURE_PROVIDER_SUPER_SECRET'], undefined);
        }

        assert.equal(launch['COPILOT_MCP_SMOKE_COMPACT'], undefined);
        assert.equal(smoke['COPILOT_MCP_SMOKE_COMPACT'], '1');
    });

    it('uses the canonical Cloudflare connector-smoke projection without ambient credentials', () => {
        const env = buildCloudflareConnectorSmokeEnvironment(parentEnv, {
            compact: true,
            publicMcpUrl: 'https://override.example.test/mcp',
        });

        assert.equal(env['PATH'], parentEnv['PATH']);
        assert.equal(env['COPILOT_MCP_CLOUDFLARE_PUBLIC_URL'], 'https://override.example.test/mcp');
        assert.equal(env['COPILOT_MCP_PROTOCOL_VERSION'], '2026-07-28');
        assert.equal(env['COPILOT_MCP_AUTH_MODE'], 'oauth');
        assert.equal(env['COPILOT_MCP_AUTH_ENFORCEMENT'], 'all');
        assert.equal(env['COPILOT_MCP_SMOKE_COMPACT'], '1');
        assert.equal(env['COPILOT_MCP_STATIC_BEARER_TOKEN_ENABLED'], undefined);
        assert.equal(env['COPILOT_MCP_STATIC_BEARER_TOKEN'], undefined);
        assert.equal(env['CLOUDFLARE_TUNNEL_TOKEN'], undefined);
        assert.equal(env['CLOUDFLARE_TUNNEL_TOKEN_FILE'], undefined);
        assert.equal(env['FUTURE_PROVIDER_SUPER_SECRET'], undefined);
    });

    it('projects reload runner authority without inheriting Cloudflare/OAuth credentials', () => {
        const config = readMcpReloadProcessConfig(parentEnv);
        const env = config.runnerEnvironment;
        const entrypointProjection = buildControlledReloadRunnerEnvironment(parentEnv);

        assert.equal(config.currentProfile, 'quic');
        assert.equal(Object.isFrozen(config), true);
        assert.equal(Object.isFrozen(env), true);
        assert.deepEqual(entrypointProjection, env);
        assert.equal(env['PATH'], parentEnv['PATH']);
        assert.equal(env['LANG'], parentEnv['LANG']);
        assert.equal(env['COPILOT_MCP_STATEFUL_ENV_FILE'], 'src/copilot/.ai/mcp/custom-stateful.env');
        assert.equal(env['COPILOT_MCP_PUBLIC_URL'], undefined);
        assert.equal(env['COPILOT_MCP_STATIC_BEARER_TOKEN'], undefined);
        assert.equal(env['CLOUDFLARE_TUNNEL_TOKEN'], undefined);
        assert.equal(env['CLOUDFLARE_TUNNEL_TOKEN_FILE'], undefined);
        assert.equal(env['FUTURE_PROVIDER_SUPER_SECRET'], undefined);
    });
});
