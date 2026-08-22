// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { readCloudflareTunnelConfig } from '#copilot/testing/mcp/cloudflare/config';
import { runCanonicalConnectorSmoke } from '#copilot/testing/mcp/cloudflare/connector-smoke';

/** @returns {Awaited<
    ReturnType<typeof import('../../../../src/copilot/mcp/cloudflare/cli-smoke.js').runCloudflareSmoke>
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
        dcrFlow: {
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
            authenticatedSse: { ok: true, status: 200 },
        },
    };
}

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
        /** @type {{ state: import('../../../../src/copilot/mcp/cloudflare/state.js').ConnectorSmokeState }[]} */
        const persisted = [];
        const report = await runCanonicalConnectorSmoke({
            config: testConfig(),
            deps: {
                runUnauthenticatedSmoke: async () => healthyUnauthenticatedSmoke(),
                runOauthSmoke: async () => ({
                    ok: false,
                    durationMs: 25,
                    failedChecks: ['authenticated-tools-list'],
                    dcrFlow: {
                        authenticatedToolsList: { ok: false, status: 500, tools: 0 },
                        authenticatedSse: { ok: false, status: 500 },
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
        /** @type {{ state: import('../../../../src/copilot/mcp/cloudflare/state.js').ConnectorSmokeState }[]} */
        const persisted = [];
        const report = await runCanonicalConnectorSmoke({
            config: testConfig(),
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
