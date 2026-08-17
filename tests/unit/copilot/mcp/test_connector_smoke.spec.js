// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { runCanonicalConnectorSmoke } from '#copilot/mcp/cloudflare/connector-smoke.js';

function healthyUnauthenticatedSmoke() {
    return {
        ok: true,
        connectorUrl: 'https://mcp.example.test/mcp',
        timings: { totalMs: 20 },
        health: { ok: true, status: 200, error: null },
        oauth: {
            ok: true,
            protectedResource: { ok: true, status: 200, error: null },
            authorizationServer: { ok: true, status: 200, error: null },
        },
        authChallenge: { ok: true, expected: true, status: 401, wwwAuthenticatePresent: true },
        criticalTools: { ok: true, expected: ['repo_status'], missing: [], unknownExpected: [] },
        tools: { ok: false, status: 401, toolCount: 0, toolNames: [] },
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
    return /** @type {any} */ ({
        publicMcpUrl: 'https://mcp.example.test/mcp',
        smokeStateFile: '/virtual/connector-smoke.json',
    });
}

describe('canonical connector smoke', () => {
    it('fails the canonical gate when authenticated OAuth fails even if the public challenge is healthy', async () => {
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
                writeState: async (path, state) => persisted.push({ path, state }),
            },
        });

        assert.equal(report.ok, false);
        assert.equal(report.authenticatedOAuthSmoke.ok, false);
        assert.equal(persisted.length, 1);
        assert.equal(persisted[0].state.ok, false);
        assert.equal(persisted[0].state.toolsList.ok, false);
    });

    it('persists authenticated tool-registry evidence instead of the expected unauthenticated 401 tools response', async () => {
        const persisted = [];
        const report = await runCanonicalConnectorSmoke({
            config: testConfig(),
            deps: {
                runUnauthenticatedSmoke: async () => healthyUnauthenticatedSmoke(),
                runOauthSmoke: async () => healthyOauthSmoke(),
                writeState: async (path, state) => persisted.push({ path, state }),
            },
        });

        assert.equal(report.ok, true);
        assert.equal(report.authenticatedOAuthSmoke.authenticatedToolsList.tools, 116);
        assert.equal(persisted.length, 1);
        assert.deepEqual(persisted[0].state.toolsList, {
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
        let release;
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
        assert.equal(report.ok, true);
        assert.equal(report.orchestrationTimings.strategy, 'parallel-unauthenticated-and-oauth');
    });
});
