// @ts-check

import {
    DEV_OAUTH_PROCESS_CONFIG_KIND,
    DEV_OAUTH_PROCESS_CONFIG_SCHEMA_VERSION,
    readDevOAuthProcessConfig,
    resolveDevOAuthProcessConfig,
} from '#copilot/mcp/public/auth';
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

describe('dev OAuth process configuration', () => {
    it('captures one deeply immutable generation without retaining the source environment', () => {
        /** @type {NodeJS.ProcessEnv} */
        const env = {
            COPILOT_MCP_DEV_OAUTH_ENABLED: 'true',
            COPILOT_MCP_DEV_OAUTH_SIGNING_ALG: 'RS256',
            COPILOT_MCP_DEV_OAUTH_ACCESS_TOKEN_TTL_SECONDS: '900',
            COPILOT_MCP_DEV_OAUTH_REFRESH_TOKEN_TTL_SECONDS: '7200',
            COPILOT_MCP_DEV_OAUTH_CLIENT_TTL_SECONDS: '10800',
            COPILOT_MCP_DEV_OAUTH_RATE_LIMIT_TOKEN_PER_WINDOW: '17',
            COPILOT_MCP_DEV_OAUTH_RATE_LIMIT_WINDOW_SECONDS: '9',
            COPILOT_MCP_DEV_OAUTH_TRUST_CLOUDFLARE_HEADERS: 'always',
            COPILOT_MCP_DEV_OAUTH_TRUST_X_FORWARDED_FOR: 'true',
            COPILOT_MCP_DEV_OAUTH_CORS_ORIGIN: 'https://chatgpt.com',
            COPILOT_MCP_DEV_OAUTH_KEY_FILE: '/tmp/dev-oauth-rs256.pem',
            COPILOT_MCP_DEV_OAUTH_ES256_KEY_FILE: '/tmp/dev-oauth-es256.pem',
            COPILOT_MCP_DEV_OAUTH_REFRESH_TOKEN_FILE: '/tmp/dev-oauth-refresh.json',
            COPILOT_MCP_DEV_OAUTH_CLIENT_FILE: '/tmp/dev-oauth-clients.json',
        };

        const config = readDevOAuthProcessConfig(env);
        env.COPILOT_MCP_DEV_OAUTH_SIGNING_ALG = 'ES256';
        env.COPILOT_MCP_DEV_OAUTH_RATE_LIMIT_TOKEN_PER_WINDOW = '999';
        env.COPILOT_MCP_DEV_OAUTH_CORS_ORIGIN = 'https://mutated.example.com';

        assert.equal(config.schemaVersion, DEV_OAUTH_PROCESS_CONFIG_SCHEMA_VERSION);
        assert.equal(config.kind, DEV_OAUTH_PROCESS_CONFIG_KIND);
        assert.equal(config.signing.algorithm, 'RS256');
        assert.equal(config.rateLimit.limits.token, 17);
        assert.equal(config.rateLimit.windowMs, 9_000);
        assert.equal(config.corsOrigin, 'https://chatgpt.com');
        assert.equal(config.proxyTrust.cloudflareHeaders, 'always');
        assert.equal(config.proxyTrust.xForwardedFor, true);
        assert.deepEqual(config.lifetimes, {
            accessTokenTtlSeconds: 900,
            refreshTokenTtlSeconds: 7_200,
            clientTtlSeconds: 10_800,
        });
        assert.equal(config.storageConfigKey.includes('/tmp/dev-oauth-rs256.pem'), true);
        assert.equal(config.persistenceConfigKey.includes('/tmp/dev-oauth-refresh.json'), true);

        for (const value of [
            config,
            config.dpop,
            config.signing,
            config.signing.keyFiles,
            config.lifetimes,
            config.persistence,
            config.rateLimit,
            config.rateLimit.limits,
            config.proxyTrust,
            config.trustedClients,
        ]) {
            assert.equal(Object.isFrozen(value), true);
        }
    });

    it('preserves normalized generation identity and safely normalizes hostile or invalid values', () => {
        const config = readDevOAuthProcessConfig({
            COPILOT_MCP_DEV_OAUTH_SIGNING_ALG: 'unknown',
            COPILOT_MCP_DEV_OAUTH_RATE_LIMIT_WINDOW_SECONDS: '-10',
            COPILOT_MCP_DEV_OAUTH_RATE_LIMIT_TOKEN_PER_WINDOW: '0',
            COPILOT_MCP_DEV_OAUTH_TRUST_CLOUDFLARE_HEADERS: 'unexpected',
            COPILOT_MCP_DEV_OAUTH_CORS_ORIGIN: `https://example.com${String.fromCharCode(10)}injected`,
        });

        assert.equal(resolveDevOAuthProcessConfig(config), config);
        assert.equal(config.signing.algorithm, 'ES256');
        assert.equal(config.rateLimit.windowMs, 60_000);
        assert.equal(config.rateLimit.limits.token, 60);
        assert.equal(config.proxyTrust.cloudflareHeaders, 'loopback');
        assert.equal(config.corsOrigin, '*');
        assert.equal('secrets' in config, false);
    });
});
