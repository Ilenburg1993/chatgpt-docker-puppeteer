// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { readCloudflareTunnelConfig } from '#copilot/mcp/public/cloudflare/config';
import { buildCloudflareConnectorSmokeEnvironment } from '#copilot/mcp/public/cloudflare/environment';
import { runCanonicalConnectorSmoke } from '#copilot/mcp/public/cloudflare/observability';

/** @returns {Awaited<
    ReturnType<typeof import('#copilot/testing/mcp/cloudflare/observability').runCloudflareSmoke>
>} */
function healthyUnauthenticatedSmoke() {
    return {
        ok: true,
        connectorUrl: 'https://mcp.example.test/mcp',
        protocolVersion: '2025-06-18',
        authenticated: false,
        authMode: 'oauth',
        probePolicy: { attempts: 1, delayMs: 0 },
        timings: {
            strategy: 'parallel-health-resource-tools-then-auth-metadata',
            discoveryParallelMs: 10,
            authorizationServerMs: 5,
            totalMs: 20,
        },
        health: { ok: true, status: 200, error: null },
        oauth: {
            ok: true,
            protectedResource: { ok: true, status: 200, error: null },
            authorizationServer: { ok: true, status: 200, error: null },
        },
        authChallenge: { ok: true, expected: true, status: 401, wwwAuthenticatePresent: true, reason: null },
        criticalTools: { ok: true, expected: ['repo_status'], missing: [], unknownExpected: [] },
        tools: { ok: false, status: 401, toolCount: 0, toolNames: [], error: undefined },
    };
}

function healthyOauthSmoke() {
    return {
        ok: true,
        durationMs: 30,
        failedChecks: [],
        runtimeFlow: {
            identity: 'cimd',
            runtimeHealth: { ok: true, status: 200 },
            authenticatedToolsList: {
                ok: true,
                status: 200,
                tools: 116,
                expectedLocalTools: 116,
                toolsMatchLocalRegistry: true,
                missingLocalTools: [],
                unexpectedRemoteTools: [],
            },
            modernSubscription: { ok: true, status: 200, opened: true },
            legacy2025Compatibility: { enabled: false, ok: true, protocolVersion: '2025-11-25' },
        },
    };
}

function testSmokeEnvironment() {
    return buildCloudflareConnectorSmokeEnvironment(
        {
            PATH: '/usr/bin',
            COPILOT_MCP_PROTOCOL_VERSION: '2026-07-28',
            COPILOT_MCP_AUTH_MODE: 'oauth',
        },
        { publicMcpUrl: 'https://mcp.example.com/mcp' },
    );
}

const TEST_LOCAL_TOOL_NAMES = Object.freeze(['repo_status']);

function testConfig() {
    return readCloudflareTunnelConfig({
        COPILOT_MCP_CLOUDFLARE_MODE: 'named-permanent',
        COPILOT_MCP_CLOUDFLARE_ZONE: 'example.com',
        COPILOT_MCP_CLOUDFLARE_PUBLIC_HOSTNAME: 'mcp.example.com',
        COPILOT_MCP_CLOUDFLARE_PUBLIC_URL: 'https://mcp.example.com/mcp',
        COPILOT_MCP_ORIGIN_TRANSPORT: 'http',
        COPILOT_MCP_CLOUDFLARE_ORIGIN_URL: 'http://127.0.0.1:3008',
        COPILOT_MCP_CLOUDFLARE_SMOKE_STATE_FILE: '/virtual/connector-smoke.json',
    });
}

/**
 * @template T
 * @param {readonly T[]} values
 * @param {number} index
 * @param {string} label
 * @returns {T}
 */
function requireFixtureIndex(values, index, label) {
    const value = values[index];
    assert.notEqual(value, undefined, label);
    return /** @type {T} */ (value);
}

describe('canonical connector smoke', () => {
    it('fails the canonical gate when authenticated OAuth fails even if the public challenge is healthy', async () => {
        /** @type {{ state: import('#copilot/mcp/public/cloudflare/tunnel').ConnectorSmokeState }[]} */
        const persisted = [];
        const report = await runCanonicalConnectorSmoke({
            config: testConfig(),
            env: testSmokeEnvironment(),
            localToolNames: TEST_LOCAL_TOOL_NAMES,
            deps: {
                runUnauthenticatedSmoke: async () => healthyUnauthenticatedSmoke(),
                runOauthSmoke: async () => ({
                    ok: false,
                    durationMs: 25,
                    failedChecks: ['authenticated-tools-list'],
                    runtimeFlow: {
                        identity: 'cimd',
                        authenticatedToolsList: { ok: false, status: 500, tools: 0 },
                        modernSubscription: { ok: false, status: 500, opened: false },
                        legacy2025Compatibility: { enabled: false, ok: true, protocolVersion: '2025-11-25' },
                    },
                }),
                writeState: async (state) => {
                    persisted.push({ state });
                },
            },
        });

        assert.equal(report['ok'], false);
        assert.equal(report['authenticatedOAuthSmoke'].ok, false);
        assert.equal(persisted.length, 1);
        const persistedSmoke = requireFixtureIndex(persisted, 0, 'persisted smoke');
        assert.equal(persistedSmoke.state.ok, false);
        assert.equal(persistedSmoke.state.toolsList.ok, false);
    });

    it('persists authenticated tool-registry evidence instead of the expected unauthenticated 401 tools response', async () => {
        /** @type {{ state: import('#copilot/mcp/public/cloudflare/tunnel').ConnectorSmokeState }[]} */
        const persisted = [];
        const report = await runCanonicalConnectorSmoke({
            config: testConfig(),
            env: testSmokeEnvironment(),
            localToolNames: TEST_LOCAL_TOOL_NAMES,
            deps: {
                runUnauthenticatedSmoke: async () => healthyUnauthenticatedSmoke(),
                runOauthSmoke: async () => healthyOauthSmoke(),
                writeState: async (state) => {
                    persisted.push({ state });
                },
            },
        });

        assert.equal(report['ok'], true);
        assert.equal(report.authenticatedOAuthSmoke.authenticatedToolsList?.tools, 116);
        assert.equal(persisted.length, 1);
        assert.deepEqual(requireFixtureIndex(persisted, 0, 'persisted smoke').state.toolsList, {
            ok: true,
            status: 200,
            tools: 116,
            expectedLocalTools: 116,
            toolsMatchLocalRegistry: true,
            criticalToolsPresent: true,
            missingCriticalTools: [],
            missingLocalTools: [],
            unexpectedRemoteTools: [],
            authChallenge: true,
        });
    });

    it('passes one bounded environment snapshot to public/CIMD branches and disables DCR compatibility traffic', async () => {
        const parentEnv = /** @type {NodeJS.ProcessEnv} */ ({
            PATH: '/usr/bin',
            COPILOT_MCP_PROTOCOL_VERSION: '2026-07-28',
            COPILOT_MCP_AUTH_MODE: 'oauth',
            COPILOT_MCP_STATIC_BEARER_TOKEN: 'must-not-cross',
            CLOUDFLARE_TUNNEL_TOKEN: 'must-not-cross-either',
            FUTURE_SECRET: 'unknown-secret',
        });
        const env = buildCloudflareConnectorSmokeEnvironment(parentEnv, {
            publicMcpUrl: 'https://mcp.example.com/mcp',
        });
        /** @type {NodeJS.ProcessEnv | null} */
        let unauthEnv = null;
        /** @type {NodeJS.ProcessEnv | null} */
        let oauthEnv = null;

        const report = await runCanonicalConnectorSmoke({
            config: testConfig(),
            env,
            localToolNames: TEST_LOCAL_TOOL_NAMES,
            persistState: false,
            deps: {
                runUnauthenticatedSmoke: async (input) => {
                    unauthEnv = input?.env ?? null;
                    return healthyUnauthenticatedSmoke();
                },
                runOauthSmoke: async (options) => {
                    oauthEnv = /** @type {NodeJS.ProcessEnv | null} */ (options['env'] ?? null);
                    assert.equal(options.runDcrCompatibility, false);
                    assert.equal(options.runLegacyCompatibility, false);
                    assert.equal(options.runPrivateKeyJwt, false);
                    assert.equal(options.runNegativeResourceChecks, false);
                    return healthyOauthSmoke();
                },
            },
        });

        assert.equal(report['ok'], true);
        assert.equal(unauthEnv, oauthEnv);
        assert.deepEqual(unauthEnv, env);
        assert.equal(env['COPILOT_MCP_PROTOCOL_VERSION'], '2026-07-28');
        assert.equal(env['COPILOT_MCP_STATIC_BEARER_TOKEN'], undefined);
        assert.equal(env['CLOUDFLARE_TUNNEL_TOKEN'], undefined);
        assert.equal(env['FUTURE_SECRET'], undefined);
    });

    it('starts public and authenticated smoke branches concurrently', async () => {
        let unauthStarted = false;
        let oauthStarted = false;
        /** @type {(value?: void | PromiseLike<void>) => void} */
        let release = () => {};
        const barrier = new Promise((resolve) => {
            release = resolve;
        });
        const maybeRelease = () => {
            if (unauthStarted && oauthStarted) release();
        };

        const report = await runCanonicalConnectorSmoke({
            config: testConfig(),
            env: testSmokeEnvironment(),
            localToolNames: TEST_LOCAL_TOOL_NAMES,
            persistState: false,
            deps: {
                runUnauthenticatedSmoke: async () => {
                    unauthStarted = true;
                    maybeRelease();
                    await barrier;
                    return healthyUnauthenticatedSmoke();
                },
                runOauthSmoke: async () => {
                    oauthStarted = true;
                    maybeRelease();
                    await barrier;
                    return healthyOauthSmoke();
                },
            },
        });

        assert.equal(unauthStarted, true);
        assert.equal(oauthStarted, true);
        assert.equal(report['ok'], true);
        assert.equal(report['orchestrationTimings'].strategy, 'parallel-unauthenticated-and-oauth');
    });
});
